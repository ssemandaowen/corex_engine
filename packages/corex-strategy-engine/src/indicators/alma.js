"use strict";

class ALMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.offset || 6), Number(indDef.sigma || 3)];

    constructor(period = 14, offset = 6, sigma = 3) {
        if (!period || period < 1) throw new Error("ALMA period must be >= 1");
        this.period = period;
        this.offset = offset;
        this.sigma = sigma;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];

        this._calcWeights();
    }

    _calcWeights() {
        const m = Math.floor(this.offset * (this.period - 1) / (this.period - 1));
        const s = this.period / this.sigma;
        this._weights = [];
        let sum = 0;
        for (let i = 0; i < this.period; i++) {
            const w = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
            this._weights[i] = w;
            sum += w;
        }
        for (let i = 0; i < this.period; i++) {
            this._weights[i] /= sum;
        }
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let sum = 0;
            for (let i = 0; i < this.period; i++) {
                sum += this._buffer[i] * this._weights[i];
            }
            this.value = sum;
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = ALMA;