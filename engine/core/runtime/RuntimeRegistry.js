"use strict";

/**
 * Plot broadcaster cadence. Floor-clamped and resolved once at module load so a
 * bad env value cannot degrade into a sub-second loop per registered runtime.
 */
const PLOT_INTERVAL_MS = Math.max(1000, Number(process.env.COREX_WS_PLOT_INTERVAL_MS || 2000));

/**
 * CoreX Runtime Registry
 *
 * THE authoritative owner of runtime identity. Every answer to "does this
 * runtime exist, who owns it, what state is it in" comes from this module —
 * there is no second registry.
 *
 * Three ledgers live here:
 *
 *   _runtimes         — fully initialized, active runtimes. An entry exists here
 *                       only while a strategy is actually running. Removed by
 *                       terminate()/delete().
 *   _reservations     — in-progress creations (see reserve()). A reservation is an
 *                       ownership claim that is NOT yet a runtime: it blocks
 *                       duplicate/competing creation of the same identity while
 *                       asynchronous initialization runs.
 *   _deletionClaims   — in-progress strategy deletions (see
 *                       claimStrategyDeletion()). Blocks new reservations for
 *                       that strategy so a delete cannot race a creation.
 *
 * Reservations have no expiry. They live in this process's memory, so a
 * reservation disappears when the process exits; a slow boot must therefore
 * never be mistaken for a dead one. Every claim is released by its owner
 * (commit, rollback, abort or explicit release) or by process exit.
 *
 * Every claim carries a fencing token. Registry mutations that could destroy
 * another owner's work (commit, release, delete) require the matching token, so
 * a stale boot can never delete or release a newer owner's entry.
 *
 * Entry shape:
 * {
 *   runtimeId:    string,   "userId::strategyName::SYMBOL::MODE"
 *   instance:     object,   BaseStrategy subclass instance (live)
 *   broker:       object,   BaseBroker subclass instance (live)
 *   symbol:       string,
 *   mode:         string,   'PAPER' | 'LIVE' | 'BACKTEST'
 *   userId:       string,
 *   strategyName: string,
 *   actualState:  string,   'ACTIVE' | 'PAUSED' | 'STOPPING' | 'STOPPED'
 *   params:       object,
 *   startedAt:    number,   ms timestamp
 *   ownerToken:   string,   fencing token of the boot that registered this entry
 * }
 *
 * Reservation shape:
 * {
 *   runtimeId, userId, accountId, strategyName, symbol, mode,
 *   token:        string,   ownership token required to commit/release
 *   owner:        string,   diagnostic label (caller)
 *   createdAt:    number,
 *   abortRequested: boolean
 * }
 */

class RuntimeRegistry {
    constructor() {
        this._runtimes = new Map();
        this._reservations = new Map();
        this._deletionClaims = new Map();
    }

    /**
     * Register an active runtime workspace.
     * Both instance and broker must be provided.
     */
    set(runtimeId, entry) {
        if (!runtimeId || typeof runtimeId !== "string") {
            throw new Error("[RuntimeRegistry] runtimeId is required");
        }
        if (!entry.instance || !entry.broker) {
            throw new Error(
                `[RuntimeRegistry] Registration failed for '${runtimeId}': ` +
                "both instance and broker are required"
            );
        }

        // A live entry is never overwritten: two callers reaching set() for the
        // same identity would silently orphan the loser's instance and broker.
        const existing = this._runtimes.get(runtimeId);
        if (existing && existing.instance && existing.broker && existing.actualState !== "STOPPED") {
            throw new Error(
                `[RuntimeRegistry] Registration failed for '${runtimeId}': already registered ` +
                `(actualState=${existing.actualState}). Terminate it first.`
            );
        }
        if (this._reservations.has(runtimeId)) {
            throw new Error(
                `[RuntimeRegistry] Registration failed for '${runtimeId}': a creation reservation ` +
                "is still pending. Commit or release it before registering."
            );
        }

        // Clear any existing interval for this runtimeId if re-registering
        if (existing && existing.plotInterval) {
            clearInterval(existing.plotInterval);
        }

        const { bus, EVENTS } = require("@events/bus");

        const plotInterval = setInterval(() => {
            const ent = this._runtimes.get(runtimeId);
            if (!ent || !ent.instance || typeof ent.instance.getPlotDelta !== "function") return;
            try {
                const delta = ent.instance.getPlotDelta();
                if (delta && ((delta.series && Object.keys(delta.series).length > 0) || (delta.marks && delta.marks.length > 0))) {
                    bus.emit(EVENTS.STRATEGY.PLOT_UPDATE, {
                        runtimeId,
                        series: delta.series || {},
                        marks: delta.marks || [],
                        ts: Date.now()
                    }, { userId: ent.userId, ts: Date.now() });
                }
            } catch (e) {
                // non-fatal
            }
        }, PLOT_INTERVAL_MS);
        if (plotInterval && typeof plotInterval.unref === "function") {
            plotInterval.unref();
        }

        this._runtimes.set(runtimeId, {
            runtimeId,
            instance:     entry.instance,
            broker:       entry.broker,
            symbol:       String(entry.symbol || "").toUpperCase(),
            mode:         String(entry.mode   || "PAPER").toUpperCase(),
            userId:       entry.userId       || "system",
            accountId:    entry.accountId    || entry.userId || "system",
            strategyName: entry.strategyName || runtimeId,
            actualState:  entry.actualState  || "ACTIVE",
            params:       entry.params       || {},
            startedAt:    entry.startedAt    || Date.now(),
            plotInterval,
        });
    }

    /**
     * Check if an active runtime already exists for the given account/user, symbol, and mode.
     */
    hasActiveForAccountSymbolMode({ accountId, userId, symbol, mode, excludeRuntimeId = null }) {
        if (!symbol || !mode) return false;
        const canonicalSymbol = String(symbol).toUpperCase();
        const canonicalMode = String(mode).toUpperCase();
        const identifier = String(accountId || userId || "system");

        for (const entry of this._runtimes.values()) {
            if (entry.runtimeId === excludeRuntimeId) continue;
            if (!isLiveEntry(entry)) continue;
            if (entry.actualState === "ACTIVE" &&
                entry.symbol === canonicalSymbol &&
                entry.mode === canonicalMode &&
                (entry.userId === identifier || entry.accountId === identifier)) {
                return entry;
            }
        }
        return null;
    }

    // ── Ownership: reservations ───────────────────────────────────────────────

    /**
     * Claim a runtime identity before asynchronous initialization starts.
     *
     * The claim is the ownership decision: it rejects duplicate creation of the
     * same identity, a strategy whose deletion is in progress, and enforces
     * one-active-runtime-per-account/symbol/mode against both live runtimes and
     * other in-flight reservations.
     *
     * Claims do not expire. A slow boot keeps exclusive ownership of its
     * identity until it commits, rolls back or the process exits.
     *
     * @returns {string} ownership token (required by commitReservation/releaseReservation)
     * @throws Error code RUNTIME_ALREADY_OWNED | RUNTIME_EXCLUSIVITY_VIOLATION |
     *         RUNTIME_DELETION_IN_PROGRESS
     */
    reserve({ runtimeId, userId, accountId, strategyName, symbol, mode, owner }) {
        if (!runtimeId || typeof runtimeId !== "string") {
            throw new Error("[RuntimeRegistry] reserve(): runtimeId is required");
        }

        if (this._runtimes.has(runtimeId) || this._reservations.has(runtimeId)) {
            throw ownershipError(
                "RUNTIME_ALREADY_OWNED",
                `[RuntimeRegistry] Runtime '${runtimeId}' is already owned ` +
                "(registered or reserved). One owner per runtime identity."
            );
        }

        const canonicalSymbol = String(symbol || "").toUpperCase();
        const canonicalMode = String(mode || "PAPER").toUpperCase();
        const identifier = String(accountId || userId || "system");
        const canonicalStrategy = strategyName || runtimeId;

        const deletion = this._deletionClaims.get(canonicalStrategy);
        if (deletion) {
            throw ownershipError(
                "RUNTIME_DELETION_IN_PROGRESS",
                `[RuntimeRegistry] Strategy '${canonicalStrategy}' is being deleted; ` +
                "new runtimes cannot be created for it."
            );
        }

        for (const entry of this._runtimes.values()) {
            if (!isLiveEntry(entry) || entry.actualState !== "ACTIVE") continue;
            if (entry.symbol === canonicalSymbol &&
                entry.mode === canonicalMode &&
                (entry.userId === identifier || entry.accountId === identifier)) {
                throw ownershipError(
                    "RUNTIME_EXCLUSIVITY_VIOLATION",
                    `[RuntimeRegistry] Exclusivity Violation: Symbol '${canonicalSymbol}' is already actively ` +
                    `traded by strategy '${entry.strategyName}' for account '${identifier}' in mode ` +
                    `'${canonicalMode}'. Only one runtime per symbol is allowed per account and mode.`
                );
            }
        }

        for (const reservation of this._reservations.values()) {
            if (reservation.symbol === canonicalSymbol &&
                reservation.mode === canonicalMode &&
                (reservation.userId === identifier || reservation.accountId === identifier)) {
                throw ownershipError(
                    "RUNTIME_EXCLUSIVITY_VIOLATION",
                    `[RuntimeRegistry] Exclusivity Violation: Symbol '${canonicalSymbol}' is already being ` +
                    `started by strategy '${reservation.strategyName}' for account '${identifier}' in mode ` +
                    `'${canonicalMode}'.`
                );
            }
        }

        const token = `${runtimeId}#${Date.now().toString(36)}#${Math.random().toString(36).slice(2, 10)}`;
        this._reservations.set(runtimeId, {
            runtimeId,
            userId:         userId || "system",
            accountId:      accountId || userId || "system",
            strategyName:   canonicalStrategy,
            symbol:         canonicalSymbol,
            mode:           canonicalMode,
            owner:          owner || "unknown",
            token,
            createdAt:      Date.now(),
            abortRequested: false,
        });
        return token;
    }

    /**
     * The reservation for an identity, regardless of how long its boot has been
     * running (reservations never expire in-process).
     */
    getReservation(runtimeId) {
        return this._reservations.get(runtimeId) || null;
    }

    isReserved(runtimeId) {
        return this.getReservation(runtimeId) !== null;
    }

    /**
     * Does any owner (live entry or pending reservation) hold this identity?
     * This — not has() — is the gate for "can I create this runtime?".
     */
    isOwned(runtimeId) {
        return this.has(runtimeId) || this.isReserved(runtimeId);
    }

    /**
     * Ask an in-flight creation to abandon its claim. The boot path observes
     * this and rolls back instead of registering a runtime nobody is waiting for.
     */
    requestAbortReservation(token) {
        const reservation = this._findReservationByToken(token);
        if (!reservation) return false;
        reservation.abortRequested = true;
        return true;
    }

    isAbortRequested(token) {
        const reservation = this._findReservationByToken(token);
        return reservation ? reservation.abortRequested === true : false;
    }

    /**
     * Atomically convert a reservation into a registered runtime.
     * The reservation is released first, so a concurrent identity claim can only
     * succeed after this entry exists. The entry is stamped with the caller's
     * fencing token, which every later ownership-checked mutation requires.
     */
    commitReservation(token, entry) {
        const reservation = this._findReservationByToken(token);
        if (!reservation) {
            throw ownershipError(
                "RUNTIME_RESERVATION_LOST",
                `[RuntimeRegistry] commit() failed: no reservation for token '${token}'`
            );
        }
        this._reservations.delete(reservation.runtimeId);
        this.set(reservation.runtimeId, { ...entry, runtimeId: reservation.runtimeId });
        const committed = this._runtimes.get(reservation.runtimeId);
        if (committed) committed.ownerToken = token;
        return committed;
    }

    /**
     * Release a reservation without registering anything.
     * @returns {boolean} true when the reservation was released by this caller
     */
    releaseReservation(token) {
        const reservation = this._findReservationByToken(token);
        if (!reservation) return false;
        return this._reservations.delete(reservation.runtimeId);
    }

    /**
     * Who owns this identity's registration? Used by rollback to prove it is
     * removing its own entry and not a newer boot's.
     */
    isOwnedBy(runtimeId, token) {
        const entry = this._runtimes.get(runtimeId);
        if (!entry || !token) return false;
        return entry.ownerToken === token;
    }

    /**
     * Compare-and-set the lifecycle state of a registered entry.
     * Rejects transitions from states the caller did not expect, so a second
     * lifecycle operation cannot silently move an entry it does not own.
     */
    transition(runtimeId, fromStates, toState) {
        const entry = this._runtimes.get(runtimeId);
        if (!entry) return false;
        const allowed = Array.isArray(fromStates) ? fromStates : [fromStates];
        if (!allowed.includes(entry.actualState)) return false;
        entry.actualState = toState;
        return true;
    }

    // ── Ownership: strategy deletion claims ───────────────────────────────────

    /**
     * Claim exclusive right to delete a strategy, before its database row is
     * touched. While the claim is held, `reserve()` refuses new runtimes for
     * that strategy, so a creation cannot land between the ownership check and
     * the DELETE.
     *
     * @returns {string} deletion token (required by releaseStrategyDeletion)
     * @throws Error code STRATEGY_DELETE_IN_PROGRESS | STRATEGY_OWNED_BY_RUNTIME
     */
    claimStrategyDeletion({ strategyName, userId }) {
        if (!strategyName || typeof strategyName !== "string") {
            throw new Error("[RuntimeRegistry] claimStrategyDeletion(): strategyName is required");
        }

        const pending = this._deletionClaims.get(strategyName);
        if (pending) {
            throw ownershipError(
                "STRATEGY_DELETE_IN_PROGRESS",
                `[RuntimeRegistry] Strategy '${strategyName}' is already being deleted.`
            );
        }

        // A runtime or an in-flight creation still owns the strategy: refuse.
        if (this.findOwnedByStrategy(strategyName).length > 0) {
            throw ownershipError(
                "STRATEGY_OWNED_BY_RUNTIME",
                `[RuntimeRegistry] Strategy '${strategyName}' still owns a runtime or a pending creation.`
            );
        }

        const token = `delete:${strategyName}#${Date.now().toString(36)}#${Math.random().toString(36).slice(2, 10)}`;
        this._deletionClaims.set(strategyName, {
            strategyName,
            userId: userId || "system",
            token,
            createdAt: Date.now()
        });
        return token;
    }

    getDeletionClaim(strategyName) {
        return this._deletionClaims.get(strategyName) || null;
    }

    isDeletionClaimed(strategyName) {
        return this._deletionClaims.has(strategyName);
    }

    /**
     * Release a deletion claim. Token-scoped, so a stale request cannot release
     * another request's claim.
     *
     * @returns {boolean} true when the claim was released by this caller
     */
    releaseStrategyDeletion(token) {
        for (const [strategyName, claim] of this._deletionClaims) {
            if (claim.token === token) return this._deletionClaims.delete(strategyName);
        }
        return false;
    }

    get pendingSize() {
        return this._reservations.size;
    }

    get deletionClaimCount() {
        return this._deletionClaims.size;
    }

    _findReservationByToken(token) {
        if (!token) return null;
        for (const reservation of this._reservations.values()) {
            if (reservation.token === token) return reservation;
        }
        return null;
    }

    get(runtimeId) {
        return this._runtimes.get(runtimeId) || null;
    }

    has(runtimeId) {
        return this._runtimes.has(runtimeId);
    }

    /**
     * Remove a runtime entry.
     *
     * When a token is supplied the entry is only removed if that token still
     * owns it. This is the fence that stops a stale boot from deleting a newer
     * boot's registration during rollback.
     *
     * @param {string} runtimeId
     * @param {{token?: string}} [options]
     * @returns {boolean} true when this call removed the entry
     */
    delete(runtimeId, options = {}) {
        const token = options && options.token;
        const entry = this._runtimes.get(runtimeId);
        if (token && (!entry || entry.ownerToken !== token)) return false;

        if (entry && entry.plotInterval) {
            clearInterval(entry.plotInterval);
        }
        this._runtimes.delete(runtimeId);
        this._reservations.delete(runtimeId);
        return true;
    }

    clear() {
        for (const entry of this._runtimes.values()) {
            if (entry.plotInterval) {
                clearInterval(entry.plotInterval);
            }
        }
        this._runtimes.clear();
        this._reservations.clear();
        this._deletionClaims.clear();
    }

    /**
     * All ACTIVE runtimes trading a given symbol.
     */
    forSymbol(symbol) {
        if (!symbol) return [];
        const canonical = symbol.toUpperCase();
        const result = [];
        for (const entry of this._runtimes.values()) {
            if (!isLiveEntry(entry)) continue;
            if (entry.symbol === canonical && entry.actualState === "ACTIVE") {
                result.push(entry);
            }
        }
        return result;
    }

    /**
     * All runtimes belonging to a user.
     */
    forUser(userId) {
        const result = [];
        for (const entry of this._runtimes.values()) {
            if (entry.userId === userId) result.push(entry);
        }
        return result;
    }

    /**
     * All runtimes for a given strategy name.
     */
    forStrategy(strategyName) {
        const result = [];
        for (const entry of this._runtimes.values()) {
            if (!isLiveEntry(entry)) continue;
            if (entry.strategyName === strategyName) result.push(entry);
        }
        return result;
    }

    /**
     * Ownership query for the deletion path: every live or pending runtime of a
     * strategy, in any phase. A strategy may only be deleted when this is empty.
     *
     * @param {string} strategyName - scoped strategy id ("userId::strategyName")
     * @returns {Array<{runtimeId: string, phase: "registered"|"reserved", userId: string}>}
     */
    findOwnedByStrategy(strategyName) {
        if (!strategyName) return [];
        const owned = [];
        for (const entry of this._runtimes.values()) {
            // Deliberately not filtered by liveness: an entry that is still
            // STOPPING with an incomplete cleanup still owns the identity, and
            // reporting it as absent would let a deletion orphan it.
            if (entry.strategyName === strategyName) {
                owned.push({ runtimeId: entry.runtimeId, phase: "registered", userId: entry.userId });
            }
        }
        for (const reservation of this._reservations.values()) {
            if (reservation.strategyName === strategyName) {
                owned.push({ runtimeId: reservation.runtimeId, phase: "reserved", userId: reservation.userId });
            }
        }
        return owned;
    }

    /**
     * All entries as an array. Used for status broadcasts.
     *
     * Entries that have already been torn down (instance and broker released but
     * not yet removed) are not runtimes and must not be reported as such.
     */
    all() {
        return Array.from(this._runtimes.values()).filter(isLiveEntry);
    }

    /**
     * Every registered entry, including entries that are still tearing down
     * (STOPPING, resources released but cleanup incomplete). Lifecycle
     * operations use this; status queries use all().
     */
    registeredEntries() {
        return Array.from(this._runtimes.values());
    }

    get size() {
        return this._runtimes.size;
    }

    get reservationCount() {
        return this._reservations.size;
    }
}

/**
 * A registry entry is only a live runtime while it still holds its collaborators.
 * Used by every "is anything running?" query so a half-torn-down entry can never
 * be mistaken for an active runtime.
 */
function isLiveEntry(entry) {
    return Boolean(entry && entry.instance && entry.broker);
}

function ownershipError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

module.exports = new RuntimeRegistry();