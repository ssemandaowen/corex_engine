"use strict";

const IncrementalSMA = require("./sma");
const StandardDeviation = require("./stddev");

class BollingerBands {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20), Number(indDef.multiplier || 2)];

    constructor(period = 20, stdDevMultiplier = 2) {
        if (!period || period < 1) throw new Error("BollingerBands period must be >= 1");
        this.period = period;
        this.stdDevMultiplier = stdDevMultiplier;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
        this._sma = new IncrementalSMA(period);
        this._stddev = new StandardDeviation(period);
    }

    update(price) {
        this.prev = this.value;

        this._sma.update(price);
        this._stddev.update(price);

        if (this._sma.ready && this._stddev.ready) {
            const smaVal = this._sma.value;
            const stdVal = this._stddev.value;
            this.value = smaVal;
            this.upper = smaVal + this.stdDevMultiplier * stdVal;
            this.lower = smaVal - this.stdDevMultiplier * stdVal;
            this.ready = true;
        }

        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
        this._sma = new IncrementalSMA(this.period);
        this._stddev = new StandardDeviation(this.period);
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = BollingerBands;