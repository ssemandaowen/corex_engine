"use strict";

const logger = require('@utils/logger');
const { INTENTS, SIDES, DEFAULT_STRATEGY_CONFIG, PERFORMANCE } = require("@config/constants");
const math = require('mathjs');
const indicators = require('technicalindicators');
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const {
    StrategyDataManager,
    StrategySignalUtils,
    StrategyDevHelpers,
    StrategyPositionManager,
    StrategyParamUtils,
    StrategyRuntimeUtils,
    RuleChain
} = require("./strategy");

const SignalHelpers = {
    entryLong(params = {}) {
        const signal = this._createSignal(this.INTENT.ENTER, this.SIDE.LONG, params);
        if (signal) {
            const qty = Number.isFinite(params.quantity)
                ? params.quantity
                : this.sizePosition({
                    symbol: signal.symbol,
                    price: signal.price,
                    riskPct: this.params?.riskPct ?? 1,
                    minQty: this.params?.minQty ?? 0,
                    maxQty: this.params?.maxQty,
                    step: this.params?.qtyStep,
                    fallbackQty: 1
                });
            this.positions.open(signal.symbol, "long", qty, signal.price);
            signal.quantity = qty;
        }
        return signal;
    },
    entryShort(params = {}) {
        const signal = this._createSignal(this.INTENT.ENTER, this.SIDE.SHORT, params);
        if (signal) {
            const qty = Number.isFinite(params.quantity)
                ? params.quantity
                : this.sizePosition({
                    symbol: signal.symbol,
                    price: signal.price,
                    riskPct: this.params?.riskPct ?? 1,
                    minQty: this.params?.minQty ?? 0,
                    maxQty: this.params?.maxQty,
                    step: this.params?.qtyStep,
                    fallbackQty: 1
                });
            this.positions.open(signal.symbol, "short", qty, signal.price);
            signal.quantity = qty;
        }
        return signal;
    },
    exitLong(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.LONG, params);
        if (signal) this.positions.close(signal.symbol, signal.price);
        return signal;
    },
    exitShort(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.SHORT, params);
        if (signal) this.positions.close(signal.symbol, signal.price);
        return signal;
    },
    exitAll(params = {}) {
        const signal = this._createSignal(this.INTENT.EXIT, this.SIDE.FLAT, params);
        if (signal) this.positions.close(signal.symbol, signal.price);
        return signal;
    },

    /**
     * Flip helpers: exit now, enter opposite side on next bar.
     * Note: true same-bar flip isn't supported by grademark's exitRule.
     */
    flipToLong(params = {}) {
        this._flipNext = { side: this.SIDE.LONG, params };
        return this.exitAll(params);
    },

    flipToShort(params = {}) {
        this._flipNext = { side: this.SIDE.SHORT, params };
        return this.exitAll(params);
    },

    applyFlip(symbol) {
        if (!this._flipNext) return null;
        const next = this._flipNext;
        this._flipNext = null;
        const signal = next.side === this.SIDE.LONG
            ? this.entryLong({ symbol, ...next.params })
            : this.entryShort({ symbol, ...next.params });
        if (signal) {
            this.positions.open(symbol, next.side === this.SIDE.LONG ? "long" : "short", next.params?.quantity || 1, signal.price);
        }
        return signal;
    }
};

/**
 * BaseStrategy – Pure Signal Generator
 * Focuses on efficiency, statistical access, and logical rule-chaining.
 */
class BaseStrategy {
    /**
     * @param {Object} config
     */
    constructor(config = {}) {
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || "BaseStrategy";
        this.__corexStandardized = true;
        this.symbols = Array.isArray(config.symbols) ? [...config.symbols] : [];
        if (this.symbols.length === 0) {
            throw new Error("BaseStrategy requires at least one symbol");
        }

        this.lookback = Math.max(10, config.lookback || 100);
        this.candleBased = config.candleBased !== false;
        this.timeframe = config.timeframe || "1m";

        this.max_data_history = Math.min(
            config.max_data_history || DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY,
            Math.max(500, this.lookback * PERFORMANCE.WARMUP_MULTIPLIER)
        );
        this.tfMs = this._getTFMs(this.timeframe);

        // Expose enums & dependencies
        this.INTENT = INTENTS;
        this.SIDE = SIDES;
        this.log = logger;
        this.math = math;
        this.indicators = indicators;

        // Parameter system
        this.schema = this.defineSchema ? this.defineSchema() : {};
        this.params = {};
        this._applyDefaults();

        // Data stores
        this.dataManager = new StrategyDataManager({
            symbols: this.symbols,
            maxHistory: this.max_data_history
        });

        this.lastTick = null;
        this.currentBar = null;
        this._signalState = {}; // Used by StrategySignalUtils for cross-logic
        this._flipNext = null;
        this.positions = new StrategyPositionManager();
    }

    /** * Statistical Helper: Get array of values for indicators 
     */
    series(symbol, field = 'close') {
        const window = this.dataManager.getLookbackWindow(symbol || this.symbols[0]);
        return window.map(b => b[field]);
    }

    _processData(packet, meta = {}) {
        const source = meta.source || meta.type || "tick";
        const isBar = source === "bar";

        if (!packet?.symbol || typeof packet.time !== 'number') return null;

        const symbol = packet.symbol;

        if (isBar) {
            this.dataManager.ingestBar(packet);
            this.currentBar = packet;
        } else {
            this.lastTick = packet;
            const result = this.dataManager.updateTick({
                symbol,
                time: packet.time,
                price: packet.price ?? packet.close,
                volume: packet.volume ?? 0
            }, this.tfMs);
            if (this.candleBased && !result.closed) return null;
        }

        let signal = this.next(packet);

        if (!signal && this._flipNext) {
            signal = this.applyFlip(symbol);
        }

        if (signal) {
            signal.symbol = symbol;
            signal.time = packet.time;
            signal.barTime = this.currentBar?.time;
            signal.tf = this.timeframe;
        }

        return signal;
    }

    onTick(tick) {
        return this._processData(tick, { source: "tick" });
    }

    onBar(bar) {
        return this._processData(bar, { source: "bar" });
    }

    onMarketData(packet, context = {}) {
        if (context?.source === "bar") return this.onBar(packet);
        return this.onTick(packet);
    }

    generateSignal(packet, context = {}) {
        return this.onMarketData(packet, context);
    }

    next(data) { return null; }

    buy(params) { return this.entryLong(params); }
    sell(params) { return this.entryShort(params); }
    exit(params) { return this.exitAll(params); }
    long(params) { return this.entryLong(params); }
    short(params) { return this.entryShort(params); }
    close(params) { return this.exitAll(params); }

    rule(bar) {
        const ctx = bar && bar.time ? { barTime: bar.time } : {};
        return new RuleChain(this, ctx);
    }

    /**
     * Position helper. If set=true, update position state.
     */
    pos(state, symbol, set = false) {
        const sym = symbol || this.symbols[0];
        if (set) {
            if (state === "flat") {
                this.positions.close(sym, this._resolveCurrentPrice({ symbol: sym }));
            } else {
                this.positions.open(sym, state, 1, this._resolveCurrentPrice({ symbol: sym }));
            }
            return true;
        }
        return this.positions.is(sym, state);
    }
}
Object.assign(BaseStrategy.prototype, SignalHelpers);
Object.assign(BaseStrategy.prototype, StrategySignalUtils);
Object.assign(BaseStrategy.prototype, StrategyDevHelpers);
Object.assign(BaseStrategy.prototype, StrategyParamUtils);
Object.assign(BaseStrategy.prototype, StrategyRuntimeUtils);
StrategyContract.adapt(BaseStrategy.prototype);

module.exports = BaseStrategy;
