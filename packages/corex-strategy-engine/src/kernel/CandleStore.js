"use strict";

const SlidingWindow = require("./SlidingWindow");
const Frame = require("./Frame");

/**
 * Structure-of-arrays candle history backed by six SlidingWindows.
 * pushFrame is the single ingestion operation; it copies an already
 * normalised Frame into the typed-array windows.
 */
class CandleStore {
    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new TypeError("CandleStore capacity must be a positive integer");
        }
        this.capacity = capacity;
        this.time = new SlidingWindow(capacity);
        this.open = new SlidingWindow(capacity);
        this.high = new SlidingWindow(capacity);
        this.low = new SlidingWindow(capacity);
        this.close = new SlidingWindow(capacity);
        this.volume = new SlidingWindow(capacity);
    }

    get size() {
        return this.time.length;
    }

    pushFrame(frame) {
        if (!(frame instanceof Frame)) throw new TypeError("CandleStore.pushFrame requires a normalised Frame");
        this.time.push(frame.t);
        this.open.push(frame.o);
        this.high.push(frame.h);
        this.low.push(frame.l);
        this.close.push(frame.c);
        this.volume.push(frame.v);
        return this;
    }

    _read(index) {
        return {
            time: this.time.at(index),
            open: this.open.at(index),
            high: this.high.at(index),
            low: this.low.at(index),
            close: this.close.at(index),
            volume: this.volume.at(index)
        };
    }

    get(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.size) return null;
        return this._read(index);
    }

    last(n = 1) {
        const count = Math.min(Math.max(0, Math.trunc(n)), this.size);
        if (count <= 0) return [];
        const result = new Array(count);
        const start = this.size - count;
        for (let i = 0; i < count; i++) result[i] = this._read(start + i);
        return result;
    }

    toArray() {
        return this.last(this.size);
    }

    getFieldSlice(field, n = this.size) {
        const window = this[field];
        if (!(window instanceof SlidingWindow)) throw new Error("[CandleStore] Invalid field: " + field);
        const count = Math.min(Math.max(0, Math.trunc(n)), this.size);
        const result = new Float64Array(count);
        result.set(window.view(count));
        return result;
    }

    getCloses(n) { return this.getFieldSlice("close", n); }
    getOpens(n) { return this.getFieldSlice("open", n); }
    getHighs(n) { return this.getFieldSlice("high", n); }
    getLows(n) { return this.getFieldSlice("low", n); }
    getVolumes(n) { return this.getFieldSlice("volume", n); }
    getTimes(n) { return this.getFieldSlice("time", n); }
}

module.exports = CandleStore;