"use strict";

/**
 * CoreX Runtime Registry
 *
 * Stores ONLY active running strategy workspaces.
 * An entry exists here only while a strategy is running.
 * When stopStrategy() is called, the entry is removed.
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
 * }
 */
class RuntimeRegistry {
    constructor() {
        this._runtimes = new Map();
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

        // Clear any existing interval for this runtimeId if re-registering
        const existing = this._runtimes.get(runtimeId);
        if (existing && existing.plotInterval) {
            clearInterval(existing.plotInterval);
        }

        const { bus, EVENTS } = require("@events/bus");
        const PLOT_INTERVAL_MS = Number(process.env.COREX_WS_PLOT_INTERVAL_MS || 2000);

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
            if (entry.actualState === "ACTIVE" &&
                entry.symbol === canonicalSymbol &&
                entry.mode === canonicalMode &&
                (entry.userId === identifier || entry.accountId === identifier)) {
                return entry;
            }
        }
        return null;
    }

    get(runtimeId) {
        return this._runtimes.get(runtimeId) || null;
    }

    has(runtimeId) {
        return this._runtimes.has(runtimeId);
    }

    delete(runtimeId) {
        const entry = this._runtimes.get(runtimeId);
        if (entry && entry.plotInterval) {
            clearInterval(entry.plotInterval);
        }
        this._runtimes.delete(runtimeId);
    }

    clear() {
        for (const entry of this._runtimes.values()) {
            if (entry.plotInterval) {
                clearInterval(entry.plotInterval);
            }
        }
        this._runtimes.clear();
    }

    /**
     * All ACTIVE runtimes trading a given symbol.
     */
    forSymbol(symbol) {
        if (!symbol) return [];
        const canonical = symbol.toUpperCase();
        const result = [];
        for (const entry of this._runtimes.values()) {
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
            if (entry.strategyName === strategyName) result.push(entry);
        }
        return result;
    }

    /**
     * All entries as an array. Used for status broadcasts.
     */
    all() {
        return Array.from(this._runtimes.values());
    }

    get size() {
        return this._runtimes.size;
    }
}

module.exports = new RuntimeRegistry();