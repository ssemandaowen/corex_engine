"use strict";

class StochasticOscillator {
    static updateMode = "multi";
    static resolveParams = (indDef) => [Number(indDef.kPeriod || 14), Number(indDef.dPeriod || 3)];

    constructor(kPeriod = 14, dPeriod = 3) {
        if (!kPeriod || kPeriod < 1) throw new Error("StochasticOscillator kPeriod must be >= 1");
        if (!dPeriod || dPeriod < 1) throw new Error("StochasticOscillator dPeriod must be >= 1");
        this.kPeriod = kPeriod;
        this.dPeriod = dPeriod;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.k = 0;
        this.d = 0;
        this._buffer = [];
        this._kBuffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;
        this._buffer.push({ high, low, close });
        if (this._buffer.length > this.kPeriod) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.kPeriod) {
            let highestHigh = -Infinity;
            let lowestLow = Infinity;
            for (let i = 0; i < this.kPeriod; i++) {
                if (this._buffer[i].high > highestHigh) highestHigh = this._buffer[i].high;
                if (this._buffer[i].low < lowestLow) lowestLow = this._buffer[i].low;
            }
            const range = highestHigh - lowestLow;
            if (range === 0) {
                this.k = 50;
            } else {
                this.k = ((close - lowestLow) / range) * 100;
            }

            this._kBuffer.push(this.k);
            if (this._kBuffer.length > this.dPeriod) {
                this._kBuffer.shift();
            }

            if (this._kBuffer.length === this.dPeriod) {
                let sum = 0;
                for (let i = 0; i < this.dPeriod; i++) {
                    sum += this._kBuffer[i];
                }
                this.d = sum / this.dPeriod;
            }

            this.value = this.k;
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.k = 0;
        this.d = 0;
        this._buffer = [];
        this._kBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = StochasticOscillator;