"use strict";

/**
 * CoreX Runtime Lifecycle
 *
 * Owns the boot and terminate phases of a strategy runtime.
 *
 * boot()      - receives a pre-instantiated strategy instance from strategyLoader.startStrategy()
 *               creates the broker, registers in RuntimeRegistry
 *
 * terminate() - destroys instance + broker, removes from RuntimeRegistry, emits stop event
 *
 * The bootloader is responsible for creating instances.
 * RuntimeLifecycle is responsible for connecting them to brokers and managing their lifespan.
 */

const runtimeRegistry    = require("./RuntimeRegistry");
const { RuntimeBrokerFactory } = require("corex-broker-contract");
const { MarketFeed: marketFeed } = require("@data");
const { DataProviderFactory } = require("@data");
const stateManager       = require("@utils/stateController");
const pgStore            = require("@core/services/pgStore");
const { bus, EVENTS }    = require("@events/bus");
const logger             = require("@utils/logger");

const log = logger.createModuleLogger("LIFECYCLE");

/**
 * In-flight terminations, keyed by runtimeId. Lifecycle operations on one
 * identity are serialized through this map; nothing here is a lock file, a
 * database lock or a delay.
 */
const _terminations = new Map();

class RuntimeLifecycle {
    /**
     * Boot a runtime workspace.
     *
     * Creation is one controlled operation: the identity is reserved first, the
     * broker is initialized while the reservation blocks competitors, and the
     * runtime is registered only after initialization succeeded. Any failure
     * releases the reservation and destroys the partially built broker, so a
     * failed boot leaves no phantom runtime and does not block a later retry.
     *
     * @param {object} config
     * @param {string} config.runtimeId        - Composite ID "userId::strategy::SYMBOL::MODE"
     * @param {object} config.strategyInstance - Pre-instantiated BaseStrategy subclass
     * @param {object} config.profile          - Runtime profile (mode, symbol, userId, etc.)
     */
    async boot({ runtimeId, strategyInstance, profile }) {
        if (!runtimeId)        throw new Error("[RuntimeLifecycle] runtimeId is required");
        if (!strategyInstance) throw new Error("[RuntimeLifecycle] strategyInstance is required");
        if (!profile)          throw new Error("[RuntimeLifecycle] profile is required");

        const accountId = profile.accountId || profile.userId || "system";
        const symbol = profile.symbol;
        const mode = profile.mode;

        // ── Claim ownership before any asynchronous work ──────────────────────
        // Rejects duplicate creation of this identity, an already-registered
        // runtime, and the one-runtime-per-account/symbol/mode rule.
        const token = runtimeRegistry.reserve({
            runtimeId,
            userId:       profile.userId,
            accountId,
            strategyName: profile.strategyName,
            symbol,
            mode,
            owner:        "RuntimeLifecycle.boot",
        });

        let broker = null;
        let registered = false;

        log.info(`Booting runtime: ${runtimeId}`);

        try {
            // ── Load persisted account settings (paper/live only) ──────────────
            // Settings saved via PATCH /api/settings/account/:mode while no
            // runtime was active live here — this is where they take effect.
            let brokerConfig = {};
            let persistedInitialCash = null;
            const modeUpper = String(profile.mode || "").toUpperCase();
            if (modeUpper === "PAPER" || modeUpper === "LIVE") {
                try {
                    const persisted = await pgStore.getBrokerSettingsForUser(profile.userId, profile.mode);
                    if (persisted) {
                        brokerConfig = persisted.config || {};
                        if (persisted.initialCash > 0) persistedInitialCash = persisted.initialCash;
                    }
                } catch (e) {
                    log.warn(`[BOOT:${runtimeId}] Failed to load persisted broker settings: ${e.message}`);
                }
            }

            // ── Create broker ────────────────────────────────────────────────
            broker = RuntimeBrokerFactory.createBroker(profile.mode, {
                runtimeId:     profile.runtimeId || runtimeId,
                symbol:        profile.symbol,
                userId:        profile.userId,
                initialCash:   profile.initialCash ?? persistedInitialCash,
                connectorType: profile.connectorType,
                brokerConfig,
            });

            // ── Initialize broker (sets up metrics accumulator, marks ready) ──
            await broker.initialize({
                runtimeId:   profile.runtimeId || runtimeId,
                mode:        profile.mode,
                symbol:      profile.symbol,
                initialCash: profile.initialCash ?? persistedInitialCash,
            });

            // ── Live mode: reconcile positions from broker history ────────────
            if (profile.mode.toUpperCase() === "LIVE" && broker.connector?.fetchTransactionalHistory) {
                try {
                    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const history = await broker.connector.fetchTransactionalHistory(since);
                    await broker.reconcilePositionsFromHistory(history);
                } catch (e) {
                    log.warn(`[BOOT:${runtimeId}] Position reconciliation failed: ${e.message}`);
                }
            }

            // ── A terminate() during initialization abandons this boot ─────────
            if (runtimeRegistry.isAbortRequested(token)) {
                throw abortError(runtimeId);
            }

            // ── Register workspace (atomic: reservation → live entry) ─────────
            // The entry is stamped with this boot's token; every later step that
            // removes it must present that token.
            runtimeRegistry.commitReservation(token, {
                instance:     strategyInstance,
                broker,
                symbol:       profile.symbol,
                mode:         profile.mode.toUpperCase(),
                userId:       profile.userId,
                accountId:    profile.accountId || profile.userId,
                strategyName: profile.strategyName,
                actualState:  "ACTIVE",
                params:       profile.params || {},
                startedAt:    Date.now(),
            });
            registered = true;

            // ── Wire broker + env into strategy instance ──────────────────────
            // Must happen after runtimeRegistry.set() so any tick that
            // arrives during warmup sees a fully wired instance.
            if (typeof strategyInstance._attachRuntime === "function") {
                strategyInstance._attachRuntime({
                    broker,
                    mode:      profile.mode,
                    runtimeId,
                    symbol:    profile.symbol,
                });
            }

            // ── Wire persistent state flush callback ──────────────────────────
            if (strategyInstance.state && typeof strategyInstance.state.setFlushCallback === "function") {
                strategyInstance.state.setFlushCallback(async (id, data) => {
                    try {
                        const db = require("@core/services/postgres");
                        if (!db.hasDbConfig()) return;
                        await db.query(
                            `UPDATE strategies SET runtime_state_data = $1, updated_at = NOW() WHERE name = $2`,
                            [JSON.stringify(data), profile.strategyName]
                        );
                    } catch (_) { /* non-fatal */ }
                });
            }

            // ── Warmup + live feed subscription (PAPER/LIVE only) ──────────────
            // BACKTEST runtimes are driven entirely by the backtest worker
            // (historical data already loaded by the job) — no live feed needed.
            let coldStart = false;
            const mode = profile.mode.toUpperCase();
            if (mode === "PAPER" || mode === "LIVE") {
                try {
                    stateManager.commit(runtimeId, "WARMING_UP", { reason: "lifecycle_boot_warmup" });
                } catch (e) {
                    log.warn(`[BOOT:${runtimeId}] stateManager.commit(WARMING_UP) failed: ${e.message}`);
                }

                coldStart = !(await this._warmup(strategyInstance, profile));
                if (coldStart) {
                    log.warn(`[BOOT:${runtimeId}] Warmup incomplete — starting in cold-start mode (awaiting live ticks).`);
                }

                try {
                    marketFeed.subscribe(runtimeId, profile.symbol);
                } catch (e) {
                    log.warn(`[BOOT:${runtimeId}] MarketFeed subscribe failed: ${e.message}`);
                }
            }

            // ── State tracking ───────────────────────────────────────────────
            try {
                stateManager.commit(runtimeId, "ACTIVE", {
                    reason: coldStart ? "Cold-start active: awaiting market data" : "lifecycle_boot"
                });
            } catch (e) {
                log.warn(`[BOOT:${runtimeId}] stateManager.commit failed: ${e.message}`);
            }

            bus.emit(EVENTS.SYSTEM.STRATEGY_START, {
                runtimeId,
                strategyId: profile.strategyName || runtimeId,
                mode:       profile.mode,
                symbol:     profile.symbol,
            }, { userId: profile.userId, ts: Date.now() });

            log.info(`Runtime booted: ${runtimeId}`);
            return true;

        } catch (error) {
            log.error(`[BOOT:${runtimeId}] Failed: ${error.message}`);
            await this._rollbackBoot({ runtimeId, token, broker, strategyInstance, profile, registered });
            throw error;
        }
    }

    /**
     * Undo a boot that did not reach the "registered and running" state.
     *
     * Cleanup is a success/failure operation, not a best-effort sequence:
     *
     *   - the entry (or the reservation, when the boot never committed) is moved to
     *     STOPPING and stripped of whatever has been destroyed so far;
     *   - completed steps are recorded (`cleanupDone`) so a retry never repeats a
     *     successful destroy;
     *   - on any failure the collaborators that could not be destroyed stay on the
     *     entry/reservation, ownership is retained, and nothing is released or
     *     removed, so `terminate(runtimeId)` can finish the job later;
     *   - ownership is fenced by the boot's token, so a boot that lost its claim
     *     can neither delete nor release another owner's state.
     */
    async _rollbackBoot({ runtimeId, token, broker, strategyInstance, profile, registered }) {
        const entry = runtimeRegistry.get(runtimeId);
        const ownsEntry = Boolean(entry) && runtimeRegistry.isOwnedBy(runtimeId, token);

        if (registered && !ownsEntry) {
            log.error(
                `[ROLLBACK:${runtimeId}] Registry entry is no longer owned by this boot — ` +
                "leaving it untouched (a newer owner holds the identity)"
            );
            // Do not release a claim that is not ours to release either.
            runtimeRegistry.releaseReservation(token);
            return false;
        }

        if (ownsEntry) {
            runtimeRegistry.transition(
                runtimeId,
                ["ACTIVE", "PAUSED", "WARMING_UP", "STOPPING"],
                "STOPPING"
            );
        }

        // Before commit the reservation is the only place to park a failed cleanup.
        const reservation = ownsEntry ? null : runtimeRegistry.getReservation(runtimeId);
        if (!ownsEntry && reservation && reservation.token !== token) {
            log.error(`[ROLLBACK:${runtimeId}] Reservation is owned by another boot — nothing released`);
            return false;
        }

        const holder = ownsEntry ? entry : reservation;
        if (!holder) {
            log.warn(`[ROLLBACK:${runtimeId}] No entry or reservation to clean up`);
            return false;
        }

        const failures = await this._runCleanup({
            runtimeId,
            holder,
            entry: ownsEntry ? entry : null,
            broker,
            strategyInstance,
            profile,
            reason: "ROLLBACK",
        });

        if (failures.length > 0) {
            // Park the still-live collaborators on the holder so a later
            // terminate() can retry without needing this boot's stack.
            if (!ownsEntry && reservation) {
                reservation.pendingBroker = broker || null;
                reservation.pendingInstance = strategyInstance || null;
                reservation.pendingProfile = profile || null;
            }
            log.error(
                `[ROLLBACK:${runtimeId}] Cleanup incomplete — ownership retained: ${failures.join("; ")}`
            );
            return false;
        }

        // All required cleanup succeeded: remove our own entry (fenced) and release.
        const removed = ownsEntry ? runtimeRegistry.delete(runtimeId, { token }) : false;
        const released = runtimeRegistry.releaseReservation(token);

        log.warn(
            `[ROLLBACK:${runtimeId}] Boot rolled back — ` +
            `entry removed: ${removed}, claim released: ${released}`
        );
        return true;
    }

    /**
     * Run the required cleanup steps for one runtime identity and record progress.
     *
     * Steps already recorded in `holder.cleanupDone` are skipped, so a retry only
     * repeats what previously failed. Every unresolved step leaves its collaborator
     * on the holder (registry entry or reservation) and is reported in the returned
     * failure list; nothing is released or removed by this method.
     *
     * @returns {Promise<string[]>} failure descriptions (empty when cleanup is complete)
     */
    async _runCleanup({ runtimeId, holder, entry, broker, strategyInstance, profile, reason }) {
        holder.cleanupDone = holder.cleanupDone || {};
        holder.cleanupFailures = [];

        const failures = [];
        const mode = String(profile?.mode || holder.mode || "").toUpperCase();
        const symbol = profile?.symbol || holder.symbol;

        const entryBroker = entry ? entry.broker : broker;
        const entryInstance = entry ? entry.instance : strategyInstance;

        // ── Feed subscription (PAPER/LIVE only) ───────────────────────────────
        if ((mode === "PAPER" || mode === "LIVE") && !holder.cleanupDone.unsubscribe) {
            try {
                marketFeed.unsubscribe(runtimeId, symbol);
                holder.cleanupDone.unsubscribe = true;
            } catch (e) {
                failures.push(`marketFeed.unsubscribe: ${e.message}`);
            }
        }

        // ── Strategy instance ─────────────────────────────────────────────────
        if (entryInstance && !holder.cleanupDone.strategy) {
            if (typeof entryInstance.destroy === "function") {
                try {
                    await entryInstance.destroy();
                    holder.cleanupDone.strategy = true;
                    if (entry) entry.instance = null;
                } catch (e) {
                    failures.push(`strategy.destroy: ${e.message}`);
                }
            } else {
                holder.cleanupDone.strategy = true;
                if (entry) entry.instance = null;
            }
        }

        // ── Broker ────────────────────────────────────────────────────────────
        if (entryBroker && !holder.cleanupDone.broker) {
            const brokerFailure = await destroyQuietly(entryBroker, runtimeId, reason);
            if (brokerFailure) failures.push(brokerFailure);
            else {
                holder.cleanupDone.broker = true;
                if (entry) entry.broker = null;
            }
        }

        holder.cleanupFailures = failures;
        return failures;
    }

    /**
     * Fetch historical bars for the runtime's symbol/timeframe and ingest
     * them into the strategy's dataManager, so it isn't starting "cold"
     * (no lookback window) when live ticks begin arriving.
     *
     * @returns {Promise<boolean>} true if warmup succeeded (bars ingested)
     */
    async _warmup(strategyInstance, profile) {
        const symbol = profile.symbol;
        const timeframe = strategyInstance.timeframe || "1m";
        const lookback = Math.max(1, Number(strategyInstance.lookback || 100));

        try {
            const bars = await DataProviderFactory.fetchHistorical({
                symbol,
                interval: timeframe,
                outputsize: lookback,
                max_candles: lookback
            });

            if (!Array.isArray(bars) || bars.length === 0) return false;

            for (const bar of bars) {
                if (!bar || !Number.isFinite(Number(bar.time))) continue;
                strategyInstance.dataManager.ingestBar({
                    symbol,
                    time: Number(bar.time),
                    open: Number(bar.open),
                    high: Number(bar.high),
                    low: Number(bar.low),
                    close: Number(bar.close),
                    volume: Number(bar.volume || 0)
                });
            }

            return true;
        } catch (e) {
            log.warn(`[WARMUP:${symbol}] failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Terminate a runtime workspace.
     * Destroys strategy instance and broker, removes from registry, emits stop event.
     *
     * Idempotent: terminating a runtime that is already gone (or whose creation
     * never committed) is safe and reports "nothing to terminate". Repeated
     * calls on the same identity converge on the same end state.
     *
     * Returns false — and leaves the entry in the registry marked STOPPING with
     * `cleanupFailures` — when a required cleanup step failed, so callers never
     * report a successful stop for a runtime that still holds resources.
     *
     * @param {string} runtimeId
     * @returns {boolean} true if terminated, false if not found or cleanup failed
     */
    async terminate(runtimeId) {
        // One termination per identity at a time. A concurrent caller joins the
        // running cleanup instead of racing it (no timers, no sleeps).
        const inFlight = _terminations.get(runtimeId);
        if (inFlight) return inFlight;

        const running = this._terminate(runtimeId);
        _terminations.set(runtimeId, running);
        try {
            return await running;
        } finally {
            _terminations.delete(runtimeId);
        }
    }

    async _terminate(runtimeId) {
        const reservation = runtimeRegistry.getReservation(runtimeId);
        const entry = runtimeRegistry.get(runtimeId);

        // ── Creation still in flight, or a rollback that could not finish ──────
        // No entry exists, so the reservation (when the boot committed nothing) is
        // the only owner. If an earlier cleanup recorded failures, retry exactly
        // those steps; otherwise abandon the creation. The reservation is released
        // only by the boot that owns it or by a completed retry.
        if (!entry && reservation) {
            if (reservation.cleanupFailures && reservation.cleanupFailures.length > 0) {
                const pendingBroker = reservation.pendingBroker || null;
                const pendingInstance = reservation.pendingInstance || null;
                const pendingProfile = reservation.pendingProfile || null;

                const failures = await this._runCleanup({
                    runtimeId,
                    holder: reservation,
                    entry: null,
                    broker: pendingBroker,
                    strategyInstance: pendingInstance,
                    profile: pendingProfile,
                    reason: "TERMINATE_RETRY",
                });

                if (failures.length > 0) {
                    log.error(
                        `[TERMINATE:${runtimeId}] Cleanup still incomplete: ${failures.join("; ")}`
                    );
                    return false;
                }

                reservation.pendingBroker = null;
                reservation.pendingInstance = null;
                runtimeRegistry.releaseReservation(reservation.token);
                log.warn(`[TERMINATE:${runtimeId}] Completed deferred rollback cleanup — claim released`);
                return true;
            }

            runtimeRegistry.requestAbortReservation(reservation.token);
            log.warn(`[TERMINATE:${runtimeId}] Cancelled pending creation (no runtime was registered)`);
            return false;
        }

        if (!entry) {
            log.warn(`[TERMINATE] Runtime '${runtimeId}' not found — nothing to terminate`);
            return false;
        }

        // ── Claim the transition. A losing caller must not tear down state it
        //    does not own; an entry already STOPPING is cleaned up again below
        //    (idempotent retry after a partial cleanup).
        if (entry.actualState !== "STOPPING") {
            const claimed = runtimeRegistry.transition(
                runtimeId,
                ["ACTIVE", "PAUSED", "WARMING_UP"],
                "STOPPING"
            );
            if (!claimed) {
                log.warn(`[TERMINATE:${runtimeId}] Rejected transition from '${entry.actualState}' to STOPPING`);
                return false;
            }
        }
        entry.stoppingSince = entry.stoppingSince || Date.now();

        log.info(`Terminating runtime: ${runtimeId}`);

        // ── Required cleanup. Completed steps are recorded on the entry, so a
        //    retry after a failure does not destroy anything twice.
        const failures = await this._runCleanup({
            runtimeId,
            holder: entry,
            entry,
            broker: null,
            strategyInstance: null,
            profile: { mode: entry.mode, symbol: entry.symbol },
            reason: "TERMINATE",
        });

        if (failures.length > 0) {
            // Keep the entry (marked STOPPING) so the failure is inspectable and
            // a later terminate() can retry the steps that still hold resources.
            log.error(`[TERMINATE:${runtimeId}] Cleanup incomplete: ${failures.join("; ")}`);
            return false;
        }

        // Null remaining runtime references before removal
        entry.params = null;
        entry.cleanupFailures = [];

        // ── Remove from registry (fenced by the entry's owner token) ─────────
        const removed = runtimeRegistry.delete(runtimeId, { token: entry.ownerToken });
        if (!removed) {
            // The entry is no longer the one this termination claimed: report
            // failure rather than a successful stop.
            entry.cleanupFailures = [`registry.delete: ownership changed during termination`];
            log.error(`[TERMINATE:${runtimeId}] Registry entry is no longer owned — stop not confirmed`);
            return false;
        }

        // ── State and event ──────────────────────────────────────────────────
        try {
            stateManager.commit(runtimeId, "STOPPED", { reason: "lifecycle_terminate" });
        } catch (_) {}

        try {
            bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, {
                runtimeId,
                strategyId: entry.strategyName || runtimeId,
                reason:     "lifecycle_terminate",
            }, { ts: Date.now() });
        } catch (e) {
            log.warn(`[TERMINATE:${runtimeId}] emit stop event failed: ${e.message}`);
        }

        log.info(`Runtime terminated: ${runtimeId}`);
        return true;
    }
}

/**
 * Destroy a broker, preferring destroy() and falling back to cleanup().
 * Failures are logged and returned (never swallowed) so the caller can decide
 * whether termination succeeded.
 *
 * @returns {Promise<string|null>} failure description, or null on success
 */
async function destroyQuietly(broker, runtimeId, phase) {
    if (!broker) return null;
    const method = typeof broker.destroy === "function" ? "destroy"
        : typeof broker.cleanup === "function" ? "cleanup"
        : null;
    if (!method) return null;
    try {
        await broker[method]();
        return null;
    } catch (e) {
        log.warn(`[${phase}:${runtimeId}] broker.${method}() threw: ${e.message}`);
        return `broker.${method}: ${e.message}`;
    }
}

function abortError(runtimeId) {
    const error = new Error(
        `[RuntimeLifecycle] Boot aborted for '${runtimeId}': termination was requested during initialization`
    );
    error.code = "RUNTIME_ABORTED";
    return error;
}

module.exports = RuntimeLifecycle;