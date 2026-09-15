"use strict";

class EaseOfMovement {
    static updateMode = "volume";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.scale || 10000)];

    constructor(period = 14, scale = 10000) {
        if (!period || period < 1) throw new Error("EaseOfMovement period must be >= 1");
        this.period = period;
        this.scale = scale;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevHigh = null;
        this._prevLow = null;
        this._buffer = [];
    }

    update(high, low, volume) {
        this.prev = this.value;

        if (this._prevHigh === null) {
            this._prevHigh = high;
            this._prevLow = low;
            return this.value;
        }

        const highMove = (high - this._prevHigh) / 2;
        const lowMove = (this._prevLow - low) / 2;
        const boxMove = highMove + lowMove;

        const range = high - low;
        const emv = range === 0 ? 0 : (boxMove * this.scale) / volume;

        this._prevHigh = high;
        this._prevLow = low;

        this._buffer.push(emv);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let sum = 0;
            for (let i = 0; i < this.period; i++) {
                sum += this._buffer[i];
            }
            this.value = sum / this.period;
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevHigh = null;
        this._prevLow = null;
        this._buffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.volume);
        }
        return this.value;
    }
}

module.exports = EaseOfMovement;