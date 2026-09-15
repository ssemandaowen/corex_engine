"use strict";

class ROC {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("ROC period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period + 1) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period + 1) {
            const refPrice = this._buffer[0];
            if (refPrice !== 0) {
                this.value = ((price - refPrice) / refPrice) * 100;
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

module.exports = ROC;