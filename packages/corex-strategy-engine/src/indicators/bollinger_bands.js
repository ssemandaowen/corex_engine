"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingMean = require("../kernel/math/SlidingMean");
const StandardDeviation = require("./stddev");

class BollingerBands extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 2 });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20), Number(indDef.multiplier || 2)];

    constructor(period = 20, stdDevMultiplier = 2, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("BollingerBands period must be a positive integer");
        this.period = period;
        this.stdDevMultiplier = stdDevMultiplier;
        this._sma = new SlidingMean(period);
        this._stddev = new StandardDeviation(period, { source: this.source });
        this.upper = 0;
        this.lower = 0;
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this._sma.push(price);
        this._stddev.update(frame);

        if (this._stddev.ready) {
            const mean = this._sma.mean;
            const sigma = this._stddev.value;
            this.value = mean;
            this.upper = mean + this.stdDevMultiplier * sigma;
            this.lower = mean - this.stdDevMultiplier * sigma;
            this.ready = true;
        } else {
            this.value = NaN;
            this.upper = 0;
            this.lower = 0;
            this.ready = false;
        }
    }

    onReset() {
        this._sma = new SlidingMean(this.period);
        this._stddev = new StandardDeviation(this.period, { source: this.source });
        this.upper = 0;
        this.lower = 0;
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("BollingerBands period must be a positive integer");
        this.period = period;
        return this.reset();
    }
}

module.exports = BollingerBands;
