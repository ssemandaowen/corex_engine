"use strict";

const IncrementalSMA = require("./sma");

class DPO {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20) {
        if (!period || period < 1) throw new Error("DPO period must be >= 1");
        this.period = period;
        this.halfPeriod = Math.floor(period / 2) + 1;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._sma = new IncrementalSMA(period);
    }

    update(price) {
        this.prev = this.value;
        this._sma.update(price);
        this._buffer.push(price);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._sma.ready) {
            const sma = this._sma.value;
            const shiftedIndex = this._buffer.length - 1 - this.halfPeriod;
            if (shiftedIndex >= 0) {
                const shiftedPrice = this._buffer[shiftedIndex];
                this.value = shiftedPrice - sma;
            } else {
                this.value = price - sma;
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
        this._sma = new IncrementalSMA(this.period);
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = DPO;