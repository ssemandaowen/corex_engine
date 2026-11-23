"use strict";

const { DEFAULT_STRATEGY_CONFIG } = require("@config/constants");
const CandleStore = require("./kernel/CandleStore");
const Frame = require("./kernel/Frame");

const TICK_NOT_CLOSED = Object.freeze({ closed: false });
const TICK_IGNORED = Object.freeze({ closed: false, ignored: true });

class StrategyDataManager {
    constructor({ symbols = [], maxHistory = DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY } = {}) {
        this.maxHistory = maxHistory;
        this.data = new Map();
        this._scratchFrame = new Frame();
        symbols.forEach(symbol => this.ensureSymbol(symbol));
    }

    ensureSymbol(symbol) {
        let store = this.data.get(symbol);
        if (!store) {
            store = { candles: new CandleStore(this.maxHistory), activeCandle: null };
            this.data.set(symbol, store);
        }
        return store;
    }

    updateTick(frame, tfMs) {
        if (!(frame instanceof Frame)) throw new TypeError("StrategyDataManager.updateTick requires a Frame");
        const symbol = frame.symbol;
        const time = frame.t;
        const price = frame.price;
        const volume = frame.v;
        const store = this.ensureSymbol(symbol);
        const candleStart = Math.floor(time / tfMs) * tfMs;
        const active = store.activeCandle;

        if (!active || active.time !== candleStart) {
            if (active && candleStart < active.time) return TICK_IGNORED;
            const hadPrevious = !!active;
            const closedCandle = hadPrevious ? { ...active } : null;
            if (hadPrevious) {
                this._scratchFrame.loadValues(active.time, active.open, active.high, active.low, active.close, active.volume);
                store.candles.pushFrame(this._scratchFrame);
            }
            store.activeCandle = {
                time: candleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume
            };
            return hadPrevious
                ? { closed: true, candle: closedCandle, activeCandle: store.activeCandle }
                : TICK_NOT_CLOSED;
        }

        if (price > active.high) active.high = price;
        if (price < active.low) active.low = price;
        active.close = price;
        active.volume += volume;
        return TICK_NOT_CLOSED;
    }

    ingestBar(frame) {
        if (!(frame instanceof Frame)) throw new TypeError("StrategyDataManager.ingestBar requires a Frame");
        const store = this.ensureSymbol(frame.symbol);
        store.candles.pushFrame(frame);
        store.activeCandle = null;
        return frame.toCandle();
    }

    getLookbackWindow(symbol, n) {
        const store = this.data.get(symbol);
        if (!store) return [];
        return n ? store.candles.last(n) : store.candles.toArray();
    }

    isWarmedUp(symbol, lookback) {
        const store = this.data.get(symbol);
        return store ? store.candles.size >= lookback : false;
    }

    getLatest(symbol) {
        const store = this.data.get(symbol);
        return store ? store.candles.get(store.candles.size - 1) : null;
    }
}

module.exports = StrategyDataManager;