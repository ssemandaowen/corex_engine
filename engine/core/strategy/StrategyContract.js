"use strict";

const REQUIRED_METHODS = ["generateSignal"];
const OPTIONAL_METHODS = ["init", "onMarketData", "teardown", "getStateSnapshot"];

class StrategyContract {
    constructor(config = {}) {
        this.id = String(config.id || config.name || `strategy_${Date.now()}`);
        this.name = String(config.name || this.id);
        this.symbols = Array.isArray(config.symbols) ? config.symbols : [];
        this.timeframe = config.timeframe || "1m";
        this.mode = String(config.mode || "PAPER").toUpperCase();
    }

    async init(_context = {}) {
        return true;
    }

    onMarketData(_packet, _context = {}) {
        return null;
    }

    generateSignal(_packet, _context = {}) {
        throw new Error("StrategyContract.generateSignal must be implemented");
    }

    async teardown(_context = {}) {
        return true;
    }

    getStateSnapshot() {
        return {
            id: this.id,
            name: this.name,
            symbols: this.symbols,
            timeframe: this.timeframe,
            mode: this.mode
        };
    }

    static validate(instance) {
        if (!instance || typeof instance !== "object") {
            return { ok: false, reason: "INVALID_INSTANCE" };
        }

        for (const method of REQUIRED_METHODS) {
            if (typeof instance[method] !== "function") {
                return { ok: false, reason: `MISSING_METHOD:${method}` };
            }
        }

        const hasSymbols = Array.isArray(instance.symbols) && instance.symbols.length > 0;
        const hasLegacySymbol = typeof instance.symbol === "string" && instance.symbol.trim().length > 0;
        if (!hasSymbols && !hasLegacySymbol) {
            return { ok: false, reason: "MISSING_SYMBOLS" };
        }

        return {
            ok: true,
            capabilities: {
                required: [...REQUIRED_METHODS],
                optional: OPTIONAL_METHODS.filter((m) => typeof instance[m] === "function")
            }
        };
    }

    static adapt(instance) {
        if (!instance || typeof instance !== "object") return instance;

        if (typeof instance.generateSignal !== "function") {
            instance.generateSignal = function generateSignal(packet, ctx = {}) {
                if (typeof this.onMarketData === "function") {
                    const signal = this.onMarketData(packet, ctx);
                    if (signal) return signal;
                }
                if (typeof this.onTick === "function") {
                    return this.onTick(packet, !!ctx.isWarmup);
                }
                if (typeof this.onBar === "function") {
                    return this.onBar(packet);
                }
                if (typeof this.next === "function") {
                    return this.next(packet);
                }
                return null;
            };
        }

        if (typeof instance.onMarketData !== "function") {
            instance.onMarketData = function onMarketData(packet, ctx = {}) {
                return this.generateSignal(packet, ctx);
            };
        }

        if (typeof instance.getStateSnapshot !== "function") {
            instance.getStateSnapshot = function getStateSnapshot() {
                return {
                    id: this.id || this.name,
                    name: this.name || this.id,
                    symbols: Array.isArray(this.symbols) ? this.symbols : [],
                    timeframe: this.timeframe || "1m",
                    mode: String(this.mode || "PAPER").toUpperCase()
                };
            };
        }

        return instance;
    }
}

module.exports = {
    StrategyContract,
    REQUIRED_METHODS,
    OPTIONAL_METHODS
};

