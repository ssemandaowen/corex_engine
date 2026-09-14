"use strict";

class CoppockCurve {
    constructor(period1 = 11, period2 = 14) {
        if (!period1 || period1 < 1) throw new Error("CoppockCurve period1 must be >= 1");
        if (!period2 || period2 < 1) throw new Error("CoppockCurve period2 must be >= 1");
        this.period1 = period1;
        this.period2 = period2;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._window = period1 + period2;
        this._prices = [];
        this._roc1Buffer = [];
        this._roc11Period = Math.floor((period1 + period2) / 2);
    }

    update(price) {
        this.prev = this.value;
        this._prices.push(price);
        if (this._prices.length > this._window + 10) {
            this._prices.shift();
        }

        if (this._prevClose !== null && this._prices.length > this._roc11Period) {
            const refPrice = this._prices[this._prices.length - 1 - this._roc11Period];
            if (refPrice !== 0) {
                this._roc11Buffer.push(((price - refPrice) / refPrice) * 100);
            } else {
                this._roc11Buffer.push(0);
            }
        }

        if (this._roc11Buffer.length > this._window) {
            this._roc11Buffer.shift();
        }

        this._prevClose = price;

        if (this._roc11Buffer.length >= this._window) {
            let sum = 0;
            for (let i = 0; i < this._window; i++) {
                sum += this._roc11Buffer[i];
            }
            this.value = sum;
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._prices = [];
        this._roc11Buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = CoppockCurve;