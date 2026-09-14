"use strict";

class RVI {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("RVI period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._numBuffer = [];
        this._denomBuffer = [];
    }

    update(close, open, high, low) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = close;
            return this.value;
        }

        const moveUp = Math.max(high - low, 0);
        let num = 0;
        let denom = 0;
        const absCloseChange = Math.abs(close - this._prevClose);

        if (close > this._prevClose) {
            num = close - open;
        } else if (close < this._prevClose) {
            num = close - this._prevClose;
        }

        denom = absCloseChange;

        this._numBuffer.push(num);
        this._denomBuffer.push(denom);

        if (this._numBuffer.length > this.period) {
            this._numBuffer.shift();
            this._denomBuffer.shift();
        }

        this._prevClose = close;

        if (this._numBuffer.length === this.period) {
            let sumNum = 0;
            let sumDenom = 0;
            for (let i = 0; i < this.period; i++) {
                sumNum += this._numBuffer[i];
                sumDenom += this._denomBuffer[i];
            }
            this.value = sumDenom === 0 ? 0 : sumNum / sumDenom;
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._numBuffer = [];
        this._denomBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.close, c.open, c.high, c.low);
        }
        return this.value;
    }
}

module.exports = RVI;