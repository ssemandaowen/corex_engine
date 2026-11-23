"use strict";

const BaseIndicator = require("./BaseIndicator");

class McGinleyDynamic extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.k || 0.6)];
    static meta = Object.freeze({ version: 2 });

    constructor(period = 14, k = 0.6, options = {}) {
        super(options);
        if (!period || period < 1) throw new Error("McGinley period must be >= 1");
        if (!(k > 0)) throw new Error("McGinley k must be > 0");
        this.period = period;
        this.k = k;
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        if (!this.ready) {
            this._seedSum += price;
            this._priceCount++;
            if (this._priceCount === this.period) {
                this.value = this._seedSum / this.period;
                this.ready = true;
            }
            return this.value;
        }
        const prior = this.value;
        if (!Number.isFinite(prior) || prior === 0) return this.value;
        const ratio = price / prior;
        const denom = this.k * this.period * Math.pow(ratio, 4);
        if (!Number.isFinite(denom) || denom === 0) return this.value;
        this.value = prior + (price - prior) / denom;
        return this.value;
    }

    onReset() {
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    setPeriod(period, k) {
        if (!period || period < 1) throw new Error("McGinley period must be >= 1");
        if (!(k > 0)) throw new Error("McGinley k must be > 0");
        this.period = period;
        this.k = k;
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        return this;
    }
}

module.exports = McGinleyDynamic;