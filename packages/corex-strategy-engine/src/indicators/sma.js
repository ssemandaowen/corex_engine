"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingMean = require("../kernel/math/SlidingMean");

class SMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];
    static meta = Object.freeze({ version: 1 });

    constructor(period, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) {
            throw new TypeError("SMA period must be a positive integer");
        }
        this.period = period;
        this._mean = new SlidingMean(period);
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        this._mean.push(price);
        this.ready = this._mean.length >= this.period;
        this.value = this._mean.mean;
    }

    onReset() {
        this._mean = new SlidingMean(this.period);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) {
            throw new TypeError("SMA period must be a positive integer");
        }
        this.period = period;
        this._mean = new SlidingMean(period);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        return this;
    }
}

module.exports = SMA;
