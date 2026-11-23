"use strict";

const BaseIndicator = require("./BaseIndicator");
const SMA = require("./sma");
const SlidingWindow = require("../kernel/SlidingWindow");

class DPO extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];
    static meta = Object.freeze({ version: 2, aliases: [], cost: "O(1)" });

    constructor(period = 20, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("DPO period must be a positive integer");
        this.period = period;
        this.halfPeriod = Math.floor(period / 2) + 1;
        this._buffer = new SlidingWindow(period);
        this._sma = new SMA(period, options);
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this._sma.update(frame);
        this._buffer.push(price);

        if (!this._sma.ready) {
            this.ready = false;
            this.value = NaN;
            return;
        }

        const shiftedIndex = this._buffer.length - 1 - this.halfPeriod;
        this.value = shiftedIndex >= 0
            ? this._buffer.at(shiftedIndex) - this._sma.value
            : price - this._sma.value;
        this.ready = true;
    }

    onReset() {
        this._buffer = new SlidingWindow(this.period);
        this._sma = new SMA(this.period, { source: this.source });
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("DPO period must be a positive integer");
        this.period = period;
        this.halfPeriod = Math.floor(period / 2) + 1;
        return this.reset();
    }
}

module.exports = DPO;