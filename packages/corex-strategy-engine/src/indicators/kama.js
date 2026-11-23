"use strict";

const BaseIndicator = require("./BaseIndicator");

class KAMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.fast || 2), Number(indDef.slow || 30)];
    static meta = Object.freeze({ version: 2 });

    constructor(period = 14, nFast = 2, nSlow = 30, options = {}) {
        super(options);
        if (!period || period < 1) throw new Error("KAMA period must be >= 1");
        if (!nFast || nFast < 1) throw new Error("KAMA nFast must be >= 1");
        if (!nSlow || nSlow < 1) throw new Error("KAMA nSlow must be >= 1");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this._fastestSC = 2 / (nFast + 1);
        this._slowestSC = 2 / (nSlow + 1);
        this._size = period + 1;
        this._window = new Array(this._size);
        this._wlen = 0;
        this._wstart = 0;
        this._volSum = 0;
        this._lastPrice = null;
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        const size = this._size;

        if (this._lastPrice !== null) {
            const evicting = this._wlen === size;
            let removed = 0;
            if (evicting) {
                const oldest = this._window[this._wstart];
                const second = this._window[(this._wstart + 1) % size];
                removed = Math.abs(second - oldest);
            }
            this._volSum = this._volSum - removed + Math.abs(price - this._lastPrice);
            this._window[(this._wstart + this._wlen) % size] = price;
            if (evicting) this._wstart = (this._wstart + 1) % size;
            else this._wlen++;
        }
        this._lastPrice = price;

        if (!this.ready) {
            this._seedSum += price;
            this._priceCount++;
            if (this._priceCount === this.period) {
                this.value = this._seedSum / this.period;
                this.ready = true;
            }
            return this.value;
        }

        if (this._wlen < size) return this.value;

        const direction = Math.abs(price - this._window[this._wstart]);
        const volatility = this._volSum;
        const er = volatility === 0 ? 1 : direction / volatility;
        const sc = Math.pow(er * (this._fastestSC - this._slowestSC) + this._slowestSC, 2);
        this.value = this.value + sc * (price - this.value);
        return this.value;
    }

    onReset() {
        this._window = new Array(this._size);
        this._wlen = 0;
        this._wstart = 0;
        this._volSum = 0;
        this._lastPrice = null;
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    setPeriod(period, nFast, nSlow) {
        if (!period || period < 1) throw new Error("KAMA period must be >= 1");
        if (!nFast || nFast < 1) throw new Error("KAMA nFast must be >= 1");
        if (!nSlow || nSlow < 1) throw new Error("KAMA nSlow must be >= 1");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this._fastestSC = 2 / (nFast + 1);
        this._slowestSC = 2 / (nSlow + 1);
        this._size = period + 1;
        this.onReset();
        return this;
    }
}

module.exports = KAMA;