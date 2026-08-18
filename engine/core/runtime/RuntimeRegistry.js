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

        this._runtimes.set(runtimeId, {
            runtimeId,
            instance:     entry.instance,
            broker:       entry.broker,
            symbol:       String(entry.symbol || "").toUpperCase(),
            mode:         String(entry.mode   || "PAPER").toUpperCase(),
            userId:       entry.userId       || "system",
            strategyName: entry.strategyName || runtimeId,
            actualState:  entry.actualState  || "ACTIVE",
            params:       entry.params       || {},
            startedAt:    entry.startedAt    || Date.now(),
        });
    }

    get(runtimeId) {
        return this._runtimes.get(runtimeId) || null;
    }

    has(runtimeId) {
        return this._runtimes.has(runtimeId);
    }

    delete(runtimeId) {
        this._runtimes.delete(runtimeId);
    }

    clear() {
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