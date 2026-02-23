"use strict";

const { DEFAULT_STRATEGY_CONFIG } = require("@config/constants");

/**
 * Optimized CircularBuffer: Uses a fixed-size array to prevent 
 * V8 re-indexing and avoids unnecessary allocations.
 */
class CircularBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.size = 0;
        this.writeIndex = 0;
    }

    push(value) {
        this.buffer[this.writeIndex] = value;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    // Returns the element at index i (0 = oldest, size-1 = newest)
    get(i) {
        if (i < 0 || i >= this.size) return null;
        const idx = (this.writeIndex - this.size + i + this.capacity) % this.capacity;
        return this.buffer[idx];
    }

    // Returns the N most recent items without creating a full array copy
    last(n = 1) {
        const count = Math.min(n, this.size);
        if (count <= 0) return [];
        
        const result = new Array(count);
        for (let i = 0; i < count; i++) {
            const idx = (this.writeIndex - count + i + this.capacity) % this.capacity;
            result[i] = this.buffer[idx];
        }
        return result;
    }

    toArray() {
        return this.last(this.size);
    }
}



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
                candles: new CircularBuffer(this.maxHistory),
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
            // Push the completed candle (no spread, we trust the previous ref is finished)
            if (store.activeCandle) {
                store.candles.push(store.activeCandle);
            }
            // Create new candle object
            store.activeCandle = {
                time: candleStart,
                open: price, high: price, low: price, close: price,
                volume
            };
            return { closed: true };
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
        // Ensure we don't hold a reference to the source object if it might change
        store.candles.push({ ...bar }); 
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
