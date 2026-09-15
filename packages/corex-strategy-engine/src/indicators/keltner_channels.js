"use strict";

const IncrementalATR = require("./atr");
const IncrementalSMA = require("./sma");

class KeltnerChannels {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20), Number(indDef.multiplier || 2)];

    constructor(period = 20, multiplier = 2) {
        if (!period || period < 1) throw new Error("KeltnerChannels period must be >= 1");
        this.period = period;
        this.multiplier = multiplier;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
        this._atr = new IncrementalATR(period);
        this._ma = new IncrementalSMA(period);
    }

    update(high, low, close) {
        this.prev = this.value;

        this._atr.update(high, low, close);
        this._ma.update(close);

        if (this._atr.ready && this._ma.ready) {
            const ma = this._ma.value;
            const atr = this._atr.value;
            this.value = ma;
            this.upper = ma + this.multiplier * atr;
            this.lower = ma - this.multiplier * atr;
            this.ready = true;
        }

        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
        this._atr = new IncrementalATR(this.period);
        this._ma = new IncrementalSMA(this.period);
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = KeltnerChannels;