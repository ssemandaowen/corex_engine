"use strict";

class CMF {
    constructor(period = 20) {
        if (!period || period < 1) throw new Error("CMF period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(high, low, close, volume) {
        this.prev = this.value;

        const moneyFlowMultiplier = ((close - low) - (high - close)) / (high - low);
        const moneyFlowVolume = moneyFlowMultiplier * volume;

        this._buffer.push({ mfm: moneyFlowMultiplier, mfv: moneyFlowVolume, volume });
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let sumMFV = 0;
            let sumVol = 0;
            for (let i = 0; i < this.period; i++) {
                sumMFV += this._buffer[i].mfv;
                sumVol += this._buffer[i].volume;
            }
            this.value = sumVol === 0 ? 0 : sumMFV / sumVol;
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
            this.update(c.high, c.low, c.close, c.volume);
        }
        return this.value;
    }
}

module.exports = CMF;