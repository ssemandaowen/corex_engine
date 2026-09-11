"use strict";

const { DEFAULT_STRATEGY_CONFIG } = require("@config/constants");
const SoACandleStore = require("./SoACandleStore");

class StrategyDataManager {
    constructor({ symbols = [], maxHistory = DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY } = {}) {
        this.maxHistory = maxHistory;
        this.data = new Map();
        symbols.forEach(s => this.ensureSymbol(s));
    }

    ensureSymbol(symbol) {
        let store = this.data.get(symbol);
        if (!store) {
            store = {
                candles: new SoACandleStore(this.maxHistory),
                activeCandle: null
            };
            this.data.set(symbol, store);
        }
        return store;
    }

    /**
     * updateTick: Optimized to update active candle by reference.
     * No object spreading used here to keep GC low.
     */
    updateTick({ symbol, time, price, volume = 0 }, tfMs) {
        const store = this.ensureSymbol(symbol);
        const candleStart = Math.floor(time / tfMs) * tfMs;

        if (!store.activeCandle || store.activeCandle.time !== candleStart) {
            // Only a *previous* candle closing counts as "closed". The very
            // first tick for a symbol (or the first tick after ingestBar()
            // reset activeCandle to null) just opens the first candle — it
            // hasn't closed anything yet.
            const hadPrevious = !!store.activeCandle;
            if (hadPrevious) {
                store.candles.push(store.activeCandle);
            }
            // Create new candle object
            store.activeCandle = {
                time: candleStart,
                open: price, high: price, low: price, close: price,
                volume
            };
            return { closed: hadPrevious };
        }

        const c = store.activeCandle;
        if (price > c.high) c.high = price;
        if (price < c.low) c.low = price;
        c.close = price;
        c.volume += volume;

        return { closed: false };
    }

    /**
     * Direct ingestion of completed bars (e.g., from History API)
     */
    ingestBar(bar) {
        const store = this.ensureSymbol(bar.symbol);
        store.candles.push(bar); 
        store.activeCandle = null;
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

    // Quick access to the most recent completed candle
    getLatest(symbol) {
        const store = this.data.get(symbol);
        return store ? store.candles.get(store.candles.size - 1) : null;
    }
}

module.exports = StrategyDataManager;
