"use strict";

const BaseIndicator = require("./BaseIndicator");

class ALMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.offset || 0.85), Number(indDef.sigma || 6)];
    static meta = Object.freeze({ version: 2 });

    constructor(period = 14, offset = 0.85, sigma = 6, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("ALMA period must be >= 1");
        if (!(sigma > 0) || offset < 0 || offset > 1) throw new Error("ALMA invalid parameters");
        this.period = period;
        this.offset = offset;
        this.sigma = sigma;
        this._buffer = new Array(period);
        this._pos = 0;
        this._count = 0;
        this._calcWeights();
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
    }

    _calcWeights() {
        const m = this.offset * (this.period - 1);
        const s = this.period / this.sigma;
        this._weights = [];
        let total = 0;
        for (let i = 0; i < this.period; i++) {
            const w = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
            this._weights[i] = w;
            total += w;
        }
        for (let i = 0; i < this.period; i++) this._weights[i] /= total;
    }

    onFrame(frame) {
        const price = this.readSource(frame);
        this.prev = this.value;
        this._buffer[this._pos] = price;
        this._pos = (this._pos + 1) % this.period;
        if (this._count < this.period) this._count++;
        if (this._count === this.period) {
            let sum = 0;
            const start = this._pos;
            for (let i = 0; i < this.period; i++) {
                sum += this._buffer[(start + i) % this.period] * this._weights[i];
            }
            this.value = sum;
            this.ready = true;
        }
        return this.value;
    }

    onReset() {
        this._buffer = new Array(this.period);
        this._pos = 0;
        this._count = 0;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
    }

    setPeriod(period, offset, sigma) {
        if (!Number.isInteger(period) || period < 1) throw new Error("ALMA period must be >= 1");
        if (!(sigma > 0) || offset < 0 || offset > 1) throw new Error("ALMA invalid parameters");
        this.period = period;
        this.offset = offset;
        this.sigma = sigma;
        this._buffer = new Array(period);
        this._pos = 0;
        this._count = 0;
        this._calcWeights();
        this.value = NaN;
        this.prev = NaN;
        this.ready = false;
        return this;
    }
}

module.exports = ALMA;