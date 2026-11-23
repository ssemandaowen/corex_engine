"use strict";

const Frame = require("../kernel/Frame");

const SOURCE_FIELDS = Object.freeze({
    open: "o", high: "h", low: "l", close: "c",
    volume: "v", hl2: "hl2", hlc3: "hlc3", ohlc4: "ohlc4"
});

class BaseIndicator {
    constructor({ source = "close" } = {}) {
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        this.count = 0;
        this.setSource(source);
    }

    setSource(source = "close") {
        const field = SOURCE_FIELDS[source];
        if (!field) throw new TypeError("Unsupported indicator source '" + source + "'");
        this.source = source;
        this.sourceField = field;
        return this;
    }

    update(frame) {
        if (!(frame instanceof Frame)) return NaN;
        this.prev = this.value;
        this.onFrame(frame);
        this.count += 1;
        if (!this.ready) this.value = NaN;
        return this.value;
    }

    onFrame() {
        throw new Error("BaseIndicator.onFrame must be implemented by subclasses");
    }

    readSource(frame) {
        return frame[this.sourceField];
    }

    onReset() {}

    reset() {
        this.onReset();
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        this.count = 0;
        return this;
    }

    reseed(store, scratchFrame) {
        if (!store || !scratchFrame || !(scratchFrame instanceof Frame) ||
            !store.time || !store.open || !store.high || !store.low || !store.close || !store.volume) {
            throw new TypeError("BaseIndicator.reseed requires a CandleStore and scratch Frame");
        }
        this.reset();
        const start = store.time.start;
        const end = store.time.end;
        const time = store.time.buf;
        const open = store.open.buf;
        const high = store.high.buf;
        const low = store.low.buf;
        const close = store.close.buf;
        const volume = store.volume.buf;
        for (let i = start; i < end; i++) {
            scratchFrame.loadValues(time[i], open[i], high[i], low[i], close[i], volume[i]);
            this.update(scratchFrame);
        }
        return this;
    }

    reconfigure(params = {}, store, scratchFrame) {
        if (params.source !== undefined) this.setSource(params.source);
        if (params.period !== undefined && params.period !== this.period) {
            if (typeof this.setPeriod === "function") this.setPeriod(params.period);
            else {
                this.period = params.period;
                this.reset();
            }
        } else {
            this.reset();
        }
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        this.count = 0;
        if (store && scratchFrame) this.reseed(store, scratchFrame);
        return this;
    }

    get isReady() {
        return this.ready;
    }
}

BaseIndicator.SOURCE_FIELDS = SOURCE_FIELDS;
module.exports = BaseIndicator;