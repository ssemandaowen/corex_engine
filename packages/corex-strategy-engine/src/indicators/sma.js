"use strict";

class IncrementalSMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period) {
        if (!period || period < 1) throw new Error("SMA period must be >= 1");
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
        let sum = 0;
        for (let i = 0; i < this._buffer.length; i++) {
            sum += this._buffer[i];
        }
        this.value = sum / this._buffer.length;
        this.ready = this._buffer.length === this.period;
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

module.exports = IncrementalSMA;
