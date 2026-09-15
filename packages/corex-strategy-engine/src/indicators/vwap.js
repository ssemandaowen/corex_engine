"use strict";

class VWAP {
    static updateMode = "volume";
    static resolveParams = () => [];

    constructor() {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._totalVolume = 0;
        this._weightedPrice = 0;
    }

    update(price, volume) {
        this.prev = this.value;
        const vol = Math.abs(volume || 0);
        if (vol > 0) {
            this._weightedPrice += price * vol;
            this._totalVolume += vol;
            if (this._totalVolume > 0) {
                this.value = this._weightedPrice / this._totalVolume;
                this.ready = true;
            }
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._totalVolume = 0;
        this._weightedPrice = 0;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.close, c.volume);
        }
        return this.value;
    }
}

module.exports = VWAP;