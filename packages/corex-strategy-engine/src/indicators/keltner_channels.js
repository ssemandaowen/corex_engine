"use strict";

const BaseIndicator = require("./BaseIndicator");
const ATR = require("./atr");
const SlidingMean = require("../kernel/math/SlidingMean");

class KeltnerChannels extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 1 });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20), Number(indDef.multiplier || 2)];

    constructor(period = 20, multiplier = 2, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("KeltnerChannels period must be a positive integer");
        this.period = period;
        this.multiplier = multiplier;
        this._atr = new ATR(period);
        this._ma = new SlidingMean(period);
        this.upper = 0;
        this.lower = 0;
    }

    onFrame(frame) {
        this._atr.update(frame);
        this._ma.push(this.readSource(frame));

        if (this._atr.ready && this._ma.length >= this.period) {
            const ma = this._ma.mean;
            const atr = this._atr.value;
            this.value = ma;
            this.upper = ma + this.multiplier * atr;
            this.lower = ma - this.multiplier * atr;
            this.ready = true;
        } else {
            this.value = NaN;
            this.upper = 0;
            this.lower = 0;
            this.ready = false;
        }
    }

    onReset() {
        this._atr = new ATR(this.period);
        this._ma = new SlidingMean(this.period);
        this.upper = 0;
        this.lower = 0;
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("KeltnerChannels period must be a positive integer");
        this.period = period;
        return this.reset();
    }
}

module.exports = KeltnerChannels;
