"use strict";

const IncrementalWMA = require("./wma");

class HullMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("HMA period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._halfPeriod = Math.floor(period / 2);
        this._sqrtPeriod = Math.floor(Math.sqrt(period));
        this._wmaHalf = new IncrementalWMA(this._halfPeriod);
        this._wmaFull = new IncrementalWMA(period);
        this._diffBuffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);

        const wmaHalf = this._wmaHalf.update(price);
        const wmaFull = this._wmaFull.update(price);

        if (!this._wmaHalf.ready || !this._wmaFull.ready) {
            return this.value;
        }

        const diff = 2 * wmaHalf - wmaFull;
        this._diffBuffer.push(diff);
        if (this._diffBuffer.length > this._sqrtPeriod) {
            this._diffBuffer.shift();
        }

        if (this._diffBuffer.length === this._sqrtPeriod) {
            let sum = 0;
            for (let i = 0; i < this._sqrtPeriod; i++) {
                sum += this._diffBuffer[i] * (this._sqrtPeriod - i);
            }
            this.value = sum / (this._sqrtPeriod * (this._sqrtPeriod + 1) / 2);
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._wmaHalf = new IncrementalWMA(this._halfPeriod);
        this._wmaFull = new IncrementalWMA(this.period);
        this._diffBuffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = HullMA;