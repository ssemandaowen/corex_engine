"use strict";

const BaseIndicator = require("./BaseIndicator");
const SlidingWma = require("../kernel/math/SlidingWma");

class HullMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];
    static meta = Object.freeze({ version: 2 });

    constructor(period = 14, options = {}) {
        super(options);
        if (!period || period < 1) throw new Error("HMA period must be >= 1");
        this.period = period;
        this._halfPeriod = Math.floor(period / 2);
        this._sqrtPeriod = Math.floor(Math.sqrt(period));
        if (this._halfPeriod < 1) throw new Error("HMA period must be >= 2 for half period");
        this._wmaHalf = new SlidingWma(this._halfPeriod);
        this._wmaFull = new SlidingWma(this.period);
        this._diffWma = new SlidingWma(this._sqrtPeriod);
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        this._wmaHalf.push(price);
        this._wmaFull.push(price);
        if (this._wmaHalf.length >= this._halfPeriod && this._wmaFull.length >= this.period) {
            const diff = 2 * this._wmaHalf.wma - this._wmaFull.wma;
            this._diffWma.push(diff);
            if (this._diffWma.length >= this._sqrtPeriod) {
                this.value = this._diffWma.wma;
                this.ready = true;
            }
        }
        return this.value;
    }

    onReset() {
        this._wmaHalf = new SlidingWma(this._halfPeriod);
        this._wmaFull = new SlidingWma(this.period);
        this._diffWma = new SlidingWma(this._sqrtPeriod);
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    setPeriod(period) {
        if (!period || period < 1) throw new Error("HMA period must be >= 1");
        this.period = period;
        this._halfPeriod = Math.floor(period / 2);
        this._sqrtPeriod = Math.floor(Math.sqrt(period));
        if (this._halfPeriod < 1) throw new Error("HMA period must be >= 2 for half period");
        this._wmaHalf = new SlidingWma(this._halfPeriod);
        this._wmaFull = new SlidingWma(this.period);
        this._diffWma = new SlidingWma(this._sqrtPeriod);
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        return this;
    }
}

module.exports = HullMA;