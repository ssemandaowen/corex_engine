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
const RuntimeBrokerFactory = require("./RuntimeBrokerFactory");
const marketFeed         = require("./MarketFeed");
const DataProviderFactory = require("@data/src/DataProviderFactory");
const stateManager       = require("@utils/stateController");
const pgStore            = require("@core/services/pgStore");
const { bus, EVENTS }    = require("@events/bus");
const logger             = require("@utils/logger");

const log = logger.createModuleLogger("LIFECYCLE");

class RuntimeLifecycle {
    /**
     * Boot a runtime workspace.
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

        if (runtimeRegistry.has(runtimeId)) {
            throw new Error(
                `[RuntimeLifecycle] Collision: runtime '${runtimeId}' is already registered. ` +
                "Call terminate() before booting again."
            );
        }

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
            const broker = RuntimeBrokerFactory.createBroker(profile.mode, {
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

            // ── Register workspace ───────────────────────────────────────────
            runtimeRegistry.set(runtimeId, {
                instance:     strategyInstance,
                broker,
                symbol:       profile.symbol,
                mode:         profile.mode.toUpperCase(),
                userId:       profile.userId,
                strategyName: profile.strategyName,
                actualState:  "ACTIVE",
                params:       profile.params || {},
                startedAt:    Date.now(),
            });

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
            // Ensure nothing is left half-registered
            runtimeRegistry.delete(runtimeId);
            throw error;
        }
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
     * @param {string} runtimeId
     * @returns {boolean} true if terminated, false if not found
     */
    async terminate(runtimeId) {
        const entry = runtimeRegistry.get(runtimeId);
        if (!entry) {
            log.warn(`[TERMINATE] Runtime '${runtimeId}' not found — nothing to terminate`);
            return false;
        }

        log.info(`Terminating runtime: ${runtimeId}`);
        entry.actualState = "STOPPING";

        // ── Unsubscribe from live market feed (PAPER/LIVE only) ────────────
        if (entry.mode === "PAPER" || entry.mode === "LIVE") {
            try {
                marketFeed.unsubscribe(runtimeId, entry.symbol);
            } catch (e) {
                log.warn(`[TERMINATE:${runtimeId}] MarketFeed unsubscribe failed: ${e.message}`);
            }
        }

        // ── Destroy strategy instance ────────────────────────────────────────
        if (entry.instance) {
            if (typeof entry.instance.destroy === "function") {
                try { entry.instance.destroy(); }
                catch (e) { log.warn(`[TERMINATE:${runtimeId}] strategy.destroy() threw: ${e.message}`); }
            }
            // Null the reference immediately so GC can reclaim
            entry.instance = null;
        }

        // ── Destroy broker ───────────────────────────────────────────────────
        if (entry.broker) {
            if (typeof entry.broker.destroy === "function") {
                try { await entry.broker.destroy(); }
                catch (e) { log.warn(`[TERMINATE:${runtimeId}] broker.destroy() threw: ${e.message}`); }
            } else if (typeof entry.broker.cleanup === "function") {
                try { await entry.broker.cleanup(); }
                catch (e) { log.warn(`[TERMINATE:${runtimeId}] broker.cleanup() threw: ${e.message}`); }
            }
            entry.broker = null;
        }

        // Null remaining runtime references before removal
        entry.params = null;

        // ── Remove from registry ─────────────────────────────────────────────
        runtimeRegistry.delete(runtimeId);

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

module.exports = RuntimeLifecycle;