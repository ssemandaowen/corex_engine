"use strict";

/**
 * Struct-of-Arrays (SoA) Typed-Array Candle Store
 * Replaces object-array CircularBuffer with parallel Float64Arrays for OHLCV + time.
 * Provides O(1) writes, zero-allocation updates on the hot path, and contiguous
 * Float64Array slices for indicator calculations.
 */
class SoACandleStore {
    constructor(capacity) {
        this.capacity = capacity;
        this.time   = new Float64Array(capacity);
        this.open   = new Float64Array(capacity);
        this.high   = new Float64Array(capacity);
        this.low    = new Float64Array(capacity);
        this.close  = new Float64Array(capacity);
        this.volume = new Float64Array(capacity);
        
        this.size = 0;
        this.writeIndex = 0;
    }

    push(candleOrTime, open, high, low, close, volume) {
        let t, o, h, l, c, v;
        if (typeof candleOrTime === "object" && candleOrTime !== null) {
            t = candleOrTime.time;
            o = candleOrTime.open;
            h = candleOrTime.high;
            l = candleOrTime.low;
            c = candleOrTime.close;
            v = candleOrTime.volume || 0;
        } else {
            t = candleOrTime;
            o = open;
            h = high;
            l = low;
            c = close;
            v = volume || 0;
        }

        const idx = this.writeIndex;
        this.time[idx]   = t;
        this.open[idx]   = o;
        this.high[idx]   = h;
        this.low[idx]    = l;
        this.close[idx]  = c;
        this.volume[idx] = v;

        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    // Returns candle object at logical index i (0 = oldest, size-1 = newest)
    get(i) {
        if (i < 0 || i >= this.size) return null;
        const idx = (this.writeIndex - this.size + i + this.capacity) % this.capacity;
        return {
            time:   this.time[idx],
            open:   this.open[idx],
            high:   this.high[idx],
            low:    this.low[idx],
            close:  this.close[idx],
            volume: this.volume[idx]
        };
    }

    // Returns the N most recent items as an array of candle objects (backwards compatibility)
    last(n = 1) {
        const count = Math.min(n, this.size);
        if (count <= 0) return [];
        
        const result = new Array(count);
        for (let i = 0; i < count; i++) {
            const idx = (this.writeIndex - count + i + this.capacity) % this.capacity;
            result[i] = {
                time:   this.time[idx],
                open:   this.open[idx],
                high:   this.high[idx],
                low:    this.low[idx],
                close:  this.close[idx],
                volume: this.volume[idx]
            };
        }
        return result;
    }

    toArray() {
        return this.last(this.size);
    }

    // Contiguous Float64Array slice for a specific field (e.g. "close", "high", etc.)
    // Returns a Float64Array of length count (oldest to newest)
    getFieldSlice(field, n = this.size) {
        const count = Math.min(n, this.size);
        if (count <= 0) return new Float64Array(0);

        const sourceArray = this[field];
        if (!sourceArray) throw new Error(`[SoACandleStore] Invalid field: ${field}`);

        const out = new Float64Array(count);
        for (let i = 0; i < count; i++) {
            const idx = (this.writeIndex - count + i + this.capacity) % this.capacity;
            out[i] = sourceArray[idx];
        }
        return out;
    }

    getCloses(n) { return this.getFieldSlice("close", n); }
    getOpens(n)  { return this.getFieldSlice("open", n); }
    getHighs(n)  { return this.getFieldSlice("high", n); }
    getLows(n)   { return this.getFieldSlice("low", n); }
    getVolumes(n){ return this.getFieldSlice("volume", n); }
    getTimes(n)  { return this.getFieldSlice("time", n); }
}

module.exports = SoACandleStore;
