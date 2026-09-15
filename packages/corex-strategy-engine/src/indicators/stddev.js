"use strict";

const IncrementalSMA = require("./sma");

class StandardDeviation {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("StandardDeviation period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
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
                sum += this._buffer[i];
            }
            const mean = sum / this.period;
            let sumSq = 0;
            for (let i = 0; i < this.period; i++) {
                const diff = this._buffer[i] - mean;
                sumSq += diff * diff;
            }
            this.value = Math.sqrt(sumSq / this.period);
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

module.exports = StandardDeviation;