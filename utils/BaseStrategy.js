"use strict";

const logger = require('@utils/logger');
const math = require('mathjs');
const indicators = require('technicalindicators');
const {
    StrategyDataManager,
    StrategySignalUtils,
    StrategyPositionManager
} = require("./strategy");

/**
 * @enum {Object}
 * Standardized strategy constants
 */
const STRAT_ENUMS = {
    INTENT: { ENTER: 'ENTER', EXIT: 'EXIT', NONE: 'NONE' },
    SIDE: { LONG: 'long', SHORT: 'short', FLAT: 'flat' }
};

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
        this.symbols = Array.isArray(config.symbols) ? [...config.symbols] : [];
        if (this.symbols.length === 0) {
            throw new Error("BaseStrategy requires at least one symbol");
        }

        this.lookback = Math.max(10, config.lookback || 100);
        this.candleBased = config.candleBased !== false;
        this.timeframe = config.timeframe || "1m";

        this.max_data_history = Math.min(
            config.max_data_history || 5000,
            Math.max(500, this.lookback * 3)
        );

        // Expose enums & dependencies
        this.INTENT = STRAT_ENUMS.INTENT;
        this.SIDE = STRAT_ENUMS.SIDE;
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

    _applyDefaults() {
        for (const [key, spec] of Object.entries(this.schema)) {
            this.params[key] = spec.default !== undefined ? spec.default : null;
        }
    }

    /** * Statistical Helper: Get array of values for indicators 
     */
    series(symbol, field = 'close') {
        const window = this.dataManager.getLookbackWindow(symbol || this.symbols[0]);
        return window.map(b => b[field]);
    }

    updateParams(newParams = {}) {
        if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) return;

        let changed = false;
        for (const [key, raw] of Object.entries(newParams)) {
            let spec = this.schema[key];
            if (!spec && this.params && Object.prototype.hasOwnProperty.call(this.params, key)) {
                const current = this.params[key];
                spec = { type: Number.isInteger(current) ? 'integer' : typeof current };
            }
            if (!spec) continue;

            let val = raw;
            let valid = true;

            switch ((spec.type || 'string').toLowerCase()) {
                case 'boolean': val = this._coerceBoolean(raw); if (val === null) valid = false; break;
                case 'integer': val = this._coerceNumber(raw, true); if (val === null) valid = false; break;
                case 'number':
                case 'float': val = this._coerceNumber(raw, false); if (val === null) valid = false; break;
            }

            if (valid && ['number', 'float', 'integer'].includes(spec.type)) {
                if (typeof spec.min === 'number' && val < spec.min) valid = false;
                if (typeof spec.max === 'number' && val > spec.max) valid = false;
            }

            if (valid) {
                const prev = this.params[key];
                if (prev !== val && !(Number.isNaN(prev) && Number.isNaN(val))) {
                    this.params[key] = val;
                    changed = true;
                }
            }
        }
        if (changed) this.log?.info('Strategy parameters updated', { id: this.id });
    }

    _coerceBoolean(v) {
        if (typeof v === 'boolean') return v;
        return (v === 'true' || v === '1' || v === 1) ? true : (v === 'false' || v === '0' || v === 0) ? false : null;
    }

    _coerceNumber(v, integer = false) {
        const n = Number(v);
        if (!Number.isFinite(n) || v === '' || v == null) return null;
        return integer ? Math.trunc(n) : n;
    }

    _getTFMs() {
        const tf = this.timeframe.toLowerCase().replace('min', 'm');
        const match = tf.match(/^(\d+)([smhd])$/);
        if (!match) return 60000;
        const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        return (parseInt(match[1], 10) || 1) * (units[match[2]] || 60000);
    }

    onTick(tick) {
        if (!tick?.symbol || typeof tick.time !== 'number') return null;
        this.lastTick = tick;
        const result = this.dataManager.updateTick({
            symbol: tick.symbol,
            time: tick.time,
            price: tick.price ?? tick.close,
            volume: tick.volume ?? 0
        }, this._getTFMs());

        return (this.candleBased && !result.closed) ? null : this.next(tick);
    }

    /**
 * Core execution wrapper.
 * Ingests data and handles the lifecycle of a signal, 
 * including automatic same-bar flip recovery.
 */
onBar(bar) {
    // 1. Validation & Ingestion
    if (!bar?.symbol || typeof bar.time !== 'number') return null;
    
    // Update internal state before running logic
    this.dataManager.ingestBar(bar);
    this.currentBar = bar;
    const symbol = bar.symbol;

    // 2. Execute User Logic
    // We call next() which contains the user's crossover/rule logic
    let signal = this.next(bar);

    // 3. Automatic Same-Bar Flip Recovery
    // If the user's next() returned null (because the position is now flat),
    // but a flip was triggered in the previous pass of this same bar:
    if (!signal && this._flipNext) {
        // applyFlip() is a BaseStrategy method that converts the 
        // pending flip state into a concrete ENTER signal.
        signal = this.applyFlip(symbol);
    }

    // 4. Final Signal Cleanup
    // Ensure the signal has the required metadata for the adapter/backtester
    if (signal) {
        signal.symbol = symbol;
        signal.time = bar.time;
    }

    return signal;
}

    next(data) { return null; }

    buy(params) { return this.entryLong(params); }
    sell(params) { return this.entryShort(params); }
    exit(params) { return this.exitAll(params); }

    _createSignal(intent, side, params = {}) {
        const symbol = params.symbol || this.symbols[0];
        return {
            intent,
            side,
            symbol,
            price: this._resolveCurrentPrice(params),
            strategyId: this.id,
            timestamp: this.lastTick?.time || this.currentBar?.time || Date.now(),
            barTime: this.currentBar?.time,
            tf: this.timeframe,
            ...params
        };
    }

    isWarmedUp(symbol) {
        return this.dataManager.isWarmedUp(symbol || this.symbols[0], this.lookback);
    }

    _resolveCurrentPrice(params) {
        if (params.price != null) return params.price;
        const symbol = params.symbol || this.symbols[0];
        const store = this.dataManager.data.get(symbol);
        return (this.lastTick?.price ?? store?.activeCandle?.close ?? this.currentBar?.close ?? 0);
    }

    /**
     * Broker snapshot helper (paper/live when available).
     */
    getAccountSnapshot() {
        const broker = this.executionContext?.broker;
        if (broker && typeof broker.getAccountSnapshot === 'function') {
            return broker.getAccountSnapshot();
        }
        return null;
    }

    /**
     * Position sizing helper (risk-based).
     * Returns a quantity based on equity percentage and current price.
     */
    sizePosition({ price, symbol, riskPct = 1, minQty = 0, maxQty, step, fallbackQty = 1 } = {}) {
        const px = Number(price ?? this._resolveCurrentPrice({ symbol }));
        if (!Number.isFinite(px) || px <= 0) return fallbackQty;

        const snapshot = this.getAccountSnapshot();
        const equity = Number(snapshot?.equity ?? snapshot?.balance);
        if (!Number.isFinite(equity) || equity <= 0) return fallbackQty;

        const pct = Math.max(0, Number(riskPct) || 0);
        if (pct <= 0) return fallbackQty;

        let qty = (equity * (pct / 100)) / px;
        if (Number.isFinite(minQty)) qty = Math.max(minQty, qty);
        if (Number.isFinite(maxQty)) qty = Math.min(maxQty, qty);

        const stepSize = Number(step);
        if (Number.isFinite(stepSize) && stepSize > 0) {
            qty = Math.floor(qty / stepSize) * stepSize;
        }

        if (!Number.isFinite(qty) || qty <= 0) return fallbackQty;
        return qty;
    }

    getLookbackWindow(symbol) { return this.dataManager.getLookbackWindow(symbol); }

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

/**
 * RuleChain – Fluent interface for strategy logic
 */
class RuleChain {
    constructor(strategy, ctx = {}) {
        this.strategy = strategy;
        this._matched = false;
        this._signal = null;
        this._barTime = ctx.barTime || strategy.currentBar?.time || strategy.lastTick?.time;
    }

    when(condition) {
        this._current = Boolean(condition);
        return this;
    }

    whenPos(state, symbol) {
        this._current = this.strategy.pos(state, symbol);
        return this;
    }

    whenCrossUp(a, b, key = "default") {
        this._current = this.strategy.crossover(a, b, { key, barTime: this._barTime });
        return this;
    }

    whenCrossDown(a, b, key = "default") {
        this._current = this.strategy.crossunder(a, b, { key, barTime: this._barTime });
        return this;
    }

    _commit(signal) {
        if (!this._matched && this._current) {
            this._signal = signal;
            this._matched = true;
        }
        return this;
    }

    enterLong(params) { return this._commit(this.strategy.entryLong(params)); }
    enterShort(params) { return this._commit(this.strategy.entryShort(params)); }
    exitLong(params) { return this._commit(this.strategy.exitLong(params)); }
    exitShort(params) { return this._commit(this.strategy.exitShort(params)); }
    exitAll(params) { return this._commit(this.strategy.exitAll(params)); }
    flipToLong(params) { return this._commit(this.strategy.flipToLong(params)); }
    flipToShort(params) { return this._commit(this.strategy.flipToShort(params)); }

    end() { return this._signal; }
    value() { return this._signal; }
    valueOf() { return this._signal; }
}

Object.assign(BaseStrategy.prototype, SignalHelpers);
Object.assign(BaseStrategy.prototype, StrategySignalUtils);

module.exports = BaseStrategy;
