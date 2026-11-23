"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingVariance = require("../kernel/math/SlidingVariance");

class StandardDeviation extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 1 });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("StandardDeviation period must be a positive integer");
        this.period = period;
        this._sv = new SlidingVariance(period);
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this._sv.push(price);
        const n = this._sv.length;
        if (n < this.period) {
            this.value = NaN;
            this.ready = false;
            return;
        }
        const sampleVar = this._sv.variance;
        const popVar = sampleVar * (n - 1) / n;
        this.value = Math.sqrt(Math.max(popVar, 0));
        this.ready = true;
    }

    onReset() {
        this._sv = new SlidingVariance(this.period);
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("StandardDeviation period must be a positive integer");
        this.period = period;
        return this.reset();
    }
}

module.exports = StandardDeviation;
