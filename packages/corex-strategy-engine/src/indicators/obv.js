"use strict";

class OBV {
    constructor() {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
    }

    update(close, volume) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = close;
            this.value = volume || 0;
            this.ready = true;
            return this.value;
        }

        const vol = Math.abs(volume || 0);
        if (close > this._prevClose) {
            this.value += vol;
        } else if (close < this._prevClose) {
            this.value -= vol;
        }

        this._prevClose = close;
        this.ready = true;
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.close, c.volume);
        }
        return this.value;
    }
}

module.exports = OBV;