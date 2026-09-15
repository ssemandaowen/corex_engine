"use strict";

class UltimateOscillator {
    static updateMode = "multi";
    static resolveParams = (indDef) => [Number(indDef.period1 || 7), Number(indDef.period2 || 14), Number(indDef.period3 || 28)];

    constructor(period1 = 7, period2 = 14, period3 = 28) {
        if (!period1 || period1 < 1) throw new Error("UltimateOscillator period1 must be >= 1");
        if (!period2 || period2 < 1) throw new Error("UltimateOscillator period2 must be >= 1");
        if (!period3 || period3 < 1) throw new Error("UltimateOscillator period3 must be >= 1");
        this.period1 = period1;
        this.period2 = period2;
        this.period3 = period3;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;

        if (this._buffer.length === 0) {
            this._buffer.push({ high, low, close });
            this.value = 50;
            return this.value;
        }

        const prevClose = this._buffer[this._buffer.length - 1].close;
        const bp = close - Math.min(low, prevClose);
        const tr = Math.max(high, prevClose) - Math.min(low, prevClose);
        this._buffer.push({ high, low, close, bp, tr });

        if (this._buffer.length > this.period3) {
            this._buffer.shift();
        }

        if (this._buffer.length >= this.period3) {
            const sumBP1 = this._sum(this.period1, "bp");
            const sumTR1 = this._sum(this.period1, "tr");
            const sumBP2 = this._sum(this.period2, "bp");
            const sumTR2 = this._sum(this.period2, "tr");
            const sumBP3 = this._sum(this.period3, "bp");
            const sumTR3 = this._sum(this.period3, "tr");

            if (sumTR1 === 0 || sumTR2 === 0 || sumTR3 === 0) {
                this.value = 50;
            } else {
                const avg1 = sumBP1 / sumTR1;
                const avg2 = sumBP2 / sumTR2;
                const avg3 = sumBP3 / sumTR3;
                this.value = 100 * (4 * avg1 + 2 * avg2 + avg3) / 7;
            }
            this.ready = true;
        }
        return this.value;
    }

    _sum(period, field) {
        let sum = 0;
        const start = Math.max(0, this._buffer.length - period);
        for (let i = start; i < this._buffer.length; i++) {
            sum += this._buffer[i][field] || 0;
        }
        return sum;
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

module.exports = UltimateOscillator;