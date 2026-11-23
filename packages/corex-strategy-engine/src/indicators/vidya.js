"use strict";

const BaseIndicator = require("./BaseIndicator");

class VIDYA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.fast || 2), Number(indDef.slow || 30)];
    static meta = Object.freeze({ version: 2 });

    constructor(period = 14, nFast = 2, nSlow = 30, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new TypeError("VIDYA period must be a positive integer");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this._baseAlpha = 2 / (period + 1);
        this._size = period;
        this._changes = new Array(period);
        this._cstart = 0;
        this._clen = 0;
        this._gainsSum = 0;
        this._lossesSum = 0;
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

        if (this._lastPrice !== null) {
            const change = price - this._lastPrice;
            const size = this._size;
            const evicting = this._clen === size;
            if (evicting) {
                const xo = this._changes[this._cstart];
                if (xo > 0) this._gainsSum -= xo;
                else this._lossesSum += xo;
                this._cstart = (this._cstart + 1) % size;
            } else {
                this._clen++;
            }
            this._changes[(this._cstart + this._clen - 1) % size] = change;
            if (change > 0) this._gainsSum += change;
            else this._lossesSum -= change;
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

        if (this._clen < this.period) return this.value;

        const total = this._gainsSum + this._lossesSum;
        const cmo = total === 0 ? 0 : (this._gainsSum - this._lossesSum) / total;
        const alpha = this._baseAlpha * Math.abs(cmo);
        this.value = this.value + alpha * (price - this.value);
        return this.value;
    }

    onReset() {
        this._changes = new Array(this._size);
        this._cstart = 0;
        this._clen = 0;
        this._gainsSum = 0;
        this._lossesSum = 0;
        this._lastPrice = null;
        this._seedSum = 0;
        this._priceCount = 0;
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    setPeriod(period, nFast, nSlow) {
        if (!Number.isInteger(period) || period < 1) throw new TypeError("VIDYA period must be a positive integer");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this._baseAlpha = 2 / (period + 1);
        this._size = period;
        this.onReset();
        return this;
    }
}

module.exports = VIDYA;