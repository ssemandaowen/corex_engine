"use strict";

class KAMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.fast || 2), Number(indDef.slow || 30)];

    constructor(period = 14, nFast = 2, nSlow = 30) {
        if (!period || period < 1) throw new Error("KAMA period must be >= 1");
        if (!nFast || nFast < 1) throw new Error("KAMA nFast must be >= 1");
        if (!nSlow || nSlow < 1) throw new Error("KAMA nSlow must be >= 1");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._prices = [];
        this._er = 0;
        this._smooth = 0;
        this._sc = 0;
    }

    update(price) {
        this.prev = this.value;
        this._prices.push(price);
        if (this._prices.length > this.period + 1) {
            this._prices.shift();
        }

        if (this._prices.length < this.period + 1) {
            return this.value;
        }

        const direction = Math.abs(price - this._prices[0]);
        let volatility = 0;
        for (let i = 1; i < this._prices.length; i++) {
            volatility += Math.abs(this._prices[i] - this._prices[i - 1]);
        }

        if (volatility === 0) {
            this._er = 1;
        } else {
            this._er = direction / volatility;
        }

        const fastestSC = 2 / (this.nFast + 1);
        const slowestSC = 2 / (this.nSlow + 1);
        this._smooth = Math.pow(this._er * (fastestSC - slowestSC) + slowestSC, 2);
        this._sc = this._smooth;

        if (!this.ready) {
            let sum = 0;
            for (let i = 0; i < this.period; i++) {
                sum += this._prices[i];
            }
            this.value = sum / this.period;
            this.ready = true;
        } else {
            this.value = this.value + this._sc * (price - this.value);
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._prices = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }

    get er() {
        return this._er;
    }

    get smooth() {
        return this._smooth;
    }
}

module.exports = KAMA;