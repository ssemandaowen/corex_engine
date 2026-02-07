"use strict";

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

    last(n = 1) {
        if (this.size === 0) return [];
        if (n === 1) {
            return [this.buffer[(this.writeIndex - 1 + this.capacity) % this.capacity]];
        }
        const count = Math.min(n, this.size);
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(this.buffer[(this.writeIndex - count + i + this.capacity) % this.capacity]);
        }
        return result;
    }

    toArray() {
        return this.last(this.size);
    }
}

class StrategyDataManager {
    constructor({ symbols = [], maxHistory = 5000 } = {}) {
        this.maxHistory = maxHistory;
        this.data = new Map();
        symbols.forEach((symbol) => {
            this.data.set(symbol, {
                candles: new CircularBuffer(this.maxHistory),
                activeCandle: null
            });
        });
    }

    ensureSymbol(symbol) {
        if (!this.data.has(symbol)) {
            this.data.set(symbol, {
                candles: new CircularBuffer(this.maxHistory),
                activeCandle: null
            });
        }
        return this.data.get(symbol);
    }

    updateTick({ symbol, time, price, volume = 0 }, tfMs) {
        const store = this.ensureSymbol(symbol);
        const candleStart = Math.floor(time / tfMs) * tfMs;

        if (!store.activeCandle || store.activeCandle.time !== candleStart) {
            if (store.activeCandle) {
                store.candles.push({ ...store.activeCandle });
            }
            store.activeCandle = {
                time: candleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume
            };
            return { closed: true };
        }

        store.activeCandle.high = Math.max(store.activeCandle.high, price);
        store.activeCandle.low = Math.min(store.activeCandle.low, price);
        store.activeCandle.close = price;
        store.activeCandle.volume += volume;
        return { closed: false };
    }

    ingestBar(bar) {
        const store = this.ensureSymbol(bar.symbol);
        store.candles.push({ ...bar });
        store.activeCandle = null;
    }

    getLookbackWindow(symbol) {
        const store = this.data.get(symbol);
        if (!store || !store.candles) return [];
        const history = store.candles.toArray();
        return Array.isArray(history) ? history : [];
    }

    isWarmedUp(symbol, lookback) {
        const store = this.data.get(symbol);
        if (!store) return false;
        return store.candles.size >= lookback;
    }
}

module.exports = StrategyDataManager;
