"use strict";

/**
 * CoreX Strategy Contract
 *
 * Defines the interface every strategy instance must satisfy before it
 * can enter the runtime pipeline.
 *
 * USAGE RULE: always call adapt() before validate(). They can be called
 * separately but adapt() is always first. validateAndAdapt() does both
 * in the correct order.
 *
 * Required methods (after adapt is applied):
 *   generateSignal(packet, ctx) → signal | null
 *
 * Required properties:
 *   symbols: string[]   (or legacy: symbol: string)
 *
 * Optional methods (checked for capabilities report):
 *   init, onMarketData, teardown, getStateSnapshot
 */

const REQUIRED_METHODS = ["generateSignal"];
const OPTIONAL_METHODS = ["init", "onMarketData", "teardown", "getStateSnapshot", "destroy", "resetState", "defineSchema"];

// Properties that must never appear on a strategy instance.
// Catching these prevents prototype pollution attacks from strategy code.
const FORBIDDEN_PROPERTIES = new Set([
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
]);

class StrategyContract {
    constructor(config = {}) {
        this.id        = String(config.id   || config.name || `strategy_${Date.now()}`);
        this.name      = String(config.name || this.id);
        this.symbols   = Array.isArray(config.symbols) ? config.symbols : [];
        this.timeframe = config.timeframe || "1m";
        this.mode      = String(config.mode || "PAPER").toUpperCase();
    }

    async init(_context = {}) { return true; }

    onMarketData(_packet, _context = {}) { return null; }

    generateSignal(_packet, _context = {}) {
        throw new Error("StrategyContract.generateSignal must be implemented by the strategy");
    }

    async teardown(_context = {}) { return true; }

    getStateSnapshot() {
        return {
            id:        this.id,
            name:      this.name,
            symbols:   this.symbols,
            timeframe: this.timeframe,
            mode:      this.mode,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Static API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Validate AND adapt in the correct order.
     * This is the safe single-call entry point for the compiler and bootloader.
     *
     * @param {object} instance
     * @returns {{ ok, reason, capabilities }}
     */
    static validateAndAdapt(instance) {
        if (!instance || typeof instance !== "object") {
            return { ok: false, reason: "INVALID_INSTANCE" };
        }

        // Security: check for prototype pollution on the instance
        const pollutionCheck = StrategyContract._checkPrototypePollution(instance);
        if (!pollutionCheck.ok) {
            return { ok: false, reason: pollutionCheck.reason };
        }

        // Adapt first — adds shims for missing methods
        StrategyContract.adapt(instance);

        // Then validate
        return StrategyContract.validate(instance);
    }

    /**
     * Add shims for methods that user strategies may not have implemented.
     * Maps legacy method names (next, onBar, onTick) to the canonical generateSignal.
     *
     * @param {object} instance
     * @returns {object} the same instance (mutated)
     */
    static adapt(instance) {
        if (!instance || typeof instance !== "object") return instance;

        // generateSignal: primary contract method
        if (typeof instance.generateSignal !== "function") {
            instance.generateSignal = function generateSignal(packet, ctx = {}) {
                if (typeof this.onMarketData === "function") {
                    const s = this.onMarketData(packet, ctx);
                    if (s) return s;
                }
                if (typeof this.next === "function")  return this.next(packet);
                if (typeof this.onBar === "function") return this.onBar(packet);
                if (typeof this.onTick === "function") return this.onTick(packet, !!ctx.isWarmup);
                return null;
            };
        }

        // onMarketData: optional convenience alias
        if (typeof instance.onMarketData !== "function") {
            instance.onMarketData = function onMarketData(packet, ctx = {}) {
                return this.generateSignal(packet, ctx);
            };
        }

        // getStateSnapshot: for status reporting
        if (typeof instance.getStateSnapshot !== "function") {
            instance.getStateSnapshot = function getStateSnapshot() {
                return {
                    id:        this.id   || this.name,
                    name:      this.name || this.id,
                    symbols:   Array.isArray(this.symbols) ? this.symbols : [],
                    timeframe: this.timeframe || "1m",
                    mode:      String(this.mode || "PAPER").toUpperCase(),
                };
            };
        }

        // Normalize legacy symbol → symbols
        if (
            (!instance.symbols || !Array.isArray(instance.symbols) || instance.symbols.length === 0) &&
            typeof instance.symbol === "string" &&
            instance.symbol.trim().length > 0
        ) {
            instance.symbols = [instance.symbol.trim().toUpperCase()];
        }

        if (!instance.__corexApi) {
            try {
                const { getStrategyApi } = require("@utils/strategy/StrategyIntrospection");
                instance.__corexApi = Object.freeze(getStrategyApi(instance));
            } catch (_) {
                instance.__corexApi = [];
            }
        }

        return instance;
    }

    /**
     * Validate that an instance satisfies the contract.
     * Call adapt() before this.
     *
     * @param {object} instance
     * @returns {{ ok, reason, capabilities }}
     */
    static validate(instance) {
        if (!instance || typeof instance !== "object") {
            return { ok: false, reason: "INVALID_INSTANCE" };
        }

        // Required method check
        for (const method of REQUIRED_METHODS) {
            if (typeof instance[method] !== "function") {
                return { ok: false, reason: `MISSING_METHOD:${method}` };
            }
        }

        // Required symbols
        const hasSymbols     = Array.isArray(instance.symbols) && instance.symbols.length > 0;
        const hasLegacySymbol = typeof instance.symbol === "string" && instance.symbol.trim().length > 0;
        if (!hasSymbols && !hasLegacySymbol) {
            return { ok: false, reason: "MISSING_SYMBOLS" };
        }

        return {
            ok: true,
            capabilities: {
                required: [...REQUIRED_METHODS],
                optional: OPTIONAL_METHODS.filter(m => typeof instance[m] === "function"),
            },
        };
    }

    /**
     * Check for prototype pollution on a strategy instance.
     * Rejects instances that have forbidden property names set directly on them.
     * This catches attempts to use strategy constructor to pollute Object.prototype.
     *
     * @param {object} instance
     * @returns {{ ok, reason }}
     * @private
     */
    static _checkPrototypePollution(instance) {
        for (const key of FORBIDDEN_PROPERTIES) {
            if (Object.prototype.hasOwnProperty.call(instance, key)) {
                return { ok: false, reason: `PROTOTYPE_POLLUTION_ATTEMPT:${key}` };
            }
        }

        // Also check for any keys in the schema or params that use forbidden names
        if (instance.params && typeof instance.params === "object") {
            for (const key of Object.keys(instance.params)) {
                if (FORBIDDEN_PROPERTIES.has(key)) {
                    return { ok: false, reason: `FORBIDDEN_PARAM_KEY:${key}` };
                }
            }
        }

        return { ok: true };
    }
}

module.exports = { StrategyContract, REQUIRED_METHODS, OPTIONAL_METHODS };