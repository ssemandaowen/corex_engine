"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingWma = require("../kernel/math/SlidingWma");

class WeightedMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];
    static meta = Object.freeze({ version: 1 });

    constructor(period, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) {
            throw new TypeError("WMA period must be a positive integer");
        }
        this.period = period;
        this._wma = new SlidingWma(period);
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        this._wma.push(price);
        this.ready = this._wma.length >= this.period;
        this.value = this.ready ? this._wma.wma : 0;
    }

    onReset() {
        this._wma = new SlidingWma(this.period);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) {
            throw new TypeError("WMA period must be a positive integer");
        }
        this.period = period;
        this._wma = new SlidingWma(period);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        return this;
    }
}

module.exports = WeightedMA;