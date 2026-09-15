"use strict";

class WilliamsR {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("Williams %R period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;
        this._buffer.push({ high, low, close });
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let highestHigh = -Infinity;
            let lowestLow = Infinity;
            for (let i = 0; i < this.period; i++) {
                if (this._buffer[i].high > highestHigh) highestHigh = this._buffer[i].high;
                if (this._buffer[i].low < lowestLow) lowestLow = this._buffer[i].low;
            }
            const range = highestHigh - lowestLow;
            if (range === 0) {
                this.value = 0;
            } else {
                this.value = ((highestHigh - close) / range) * -100;
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = WilliamsR;