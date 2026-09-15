"use strict";

class CCI {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20) {
        if (!period || period < 1) throw new Error("CCI period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(typicalPrice) {
        this.prev = this.value;
        this._buffer.push(typicalPrice);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let sum = 0;
            for (let i = 0; i < this.period; i++) {
                sum += this._buffer[i];
            }
            const sma = sum / this.period;
            let sumDev = 0;
            for (let i = 0; i < this.period; i++) {
                sumDev += Math.abs(this._buffer[i] - sma);
            }
            const meanDev = sumDev / this.period;
            if (meanDev === 0) {
                this.value = 0;
            } else {
                this.value = (typicalPrice - sma) / (0.015 * meanDev);
            }
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

module.exports = CCI;