"use strict";

class DonchianChannels {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20) {
        if (!period || period < 1) throw new Error("DonchianChannels period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
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
            this.upper = highestHigh;
            this.lower = lowestLow;
            this.value = (highestHigh + lowestLow) / 2;
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.upper = 0;
        this.lower = 0;
        this._buffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = DonchianChannels;