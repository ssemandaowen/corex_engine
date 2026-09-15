"use strict";

class CMO {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("CMO period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._sumHigh = 0;
        this._sumLow = 0;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const change = price - this._prevClose;
        this._prevClose = price;
        const high = change > 0 ? change : 0;
        const low = change < 0 ? -change : 0;

        this._buffer.push({ high, low });
        if (this._buffer.length > this.period) {
            const old = this._buffer.shift();
            this._sumHigh -= old.high;
            this._sumLow -= old.low;
        }

        this._sumHigh += high;
        this._sumLow += low;

        if (this._buffer.length === this.period) {
            const sum = this._sumHigh + this._sumLow;
            if (sum === 0) {
                this.value = 0;
            } else {
                this.value = 100 * ((this._sumHigh - this._sumLow) / sum);
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._sumHigh = 0;
        this._sumLow = 0;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = CMO;