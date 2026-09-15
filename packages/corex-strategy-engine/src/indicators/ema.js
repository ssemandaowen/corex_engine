"use strict";

class IncrementalEMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period) {
        if (!period || period < 1) throw new Error("EMA period must be >= 1");
        this.period = period;
        this.multiplier = 2 / (period + 1);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        if (!this.ready) {
            this._buffer.push(price);
            if (this._buffer.length === this.period) {
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._buffer[i];
                }
                this.value = sum / this.period;
                this.ready = true;
                this._buffer = null;
            }
            return this.value;
        }
        this.value = (price - this.prev) * this.multiplier + this.prev;
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

module.exports = IncrementalEMA;
