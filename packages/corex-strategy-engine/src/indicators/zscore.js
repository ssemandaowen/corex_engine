"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingMean = require("../kernel/math/SlidingMean");
const StandardDeviation = require("./stddev");

class ZScore extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 2 });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("ZScore period must be a positive integer");
        this.period = period;
        this._sma = new SlidingMean(period);
        this._stddev = new StandardDeviation(period, { source: this.source });
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this._sma.push(price);
        this._stddev.update(frame);

        if (this._stddev.ready) {
            const mean = this._sma.mean;
            const sigma = this._stddev.value;
            this.value = sigma === 0 ? 0 : (price - mean) / sigma;
            this.ready = true;
        } else {
            this.value = NaN;
            this.ready = false;
        }
    }

    onReset() {
        this._sma = new SlidingMean(this.period);
        this._stddev = new StandardDeviation(this.period, { source: this.source });
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("ZScore period must be a positive integer");
        this.period = period;
        return this.reset();
    }
}

module.exports = ZScore;
