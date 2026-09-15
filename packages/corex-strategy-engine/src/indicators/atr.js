"use strict";

class IncrementalATR {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("ATR period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._trBuffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;
        if (this._prevClose === null) {
            this._prevClose = close;
            return this.value;
        }

        const hl = high - low;
        const hc = Math.abs(high - this._prevClose);
        const lc = Math.abs(low - this._prevClose);
        const tr = Math.max(hl, hc, lc);
        this._prevClose = close;

        if (!this.ready) {
            this._trBuffer.push(tr);
            if (this._trBuffer.length === this.period) {
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._trBuffer[i];
                }
                this.value = sum / this.period;
                this.ready = true;
                this._trBuffer = null;
            }
            return this.value;
        }

        this.value = (this.value * (this.period - 1) + tr) / this.period;
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._trBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = IncrementalATR;
