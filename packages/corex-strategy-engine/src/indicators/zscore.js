"use strict";

const IncrementalSMA = require("./sma");
const StandardDeviation = require("./stddev");

class ZScore {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20) {
        if (!period || period < 1) throw new Error("ZScore period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._sma = new IncrementalSMA(period);
        this._stddev = new StandardDeviation(period);
    }

    update(price) {
        this.prev = this.value;

        this._sma.update(price);
        this._stddev.update(price);

        if (this._sma.ready && this._stddev.ready) {
            if (this._stddev.value === 0) {
                this.value = 0;
            } else {
                this.value = (price - this._sma.value) / this._stddev.value;
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._sma = new IncrementalSMA(this.period);
        this._stddev = new StandardDeviation(this.period);
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = ZScore;