"use strict";

const IncrementalEMA = require("./ema");

class VIDYA {
    constructor(period = 14, nFast = 2, nSlow = 30) {
        if (!period || period < 1) throw new Error("VIDYA period must be >= 1");
        this.period = period;
        this.nFast = nFast;
        this.nSlow = nSlow;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._upSum = 0;
        this._downSum = 0;
        this._prevClose = null;
        this._emaGain = new IncrementalEMA(period);
        this._emaLoss = new IncrementalEMA(period);
        this._prices = [];
        this._fastestSC = 2 / (this.nFast + 1);
        this._slowestSC = 2 / (this.nSlow + 1);
    }

    update(price) {
        this.prev = this.value;
        this._prices.push(price);
        if (this._prices.length > this.period + 1) {
            this._prices.shift();
        }

        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const change = price - this._prevClose;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        this._prevClose = price;

        this._emaGain.update(gain);
        this._emaLoss.update(loss);

        if (!this._emaGain.ready || !this._emaLoss.ready) {
            return this.value;
        }

        const rs = this._emaLoss.value === 0 ? Infinity : this._emaGain.value / this._emaLoss.value;
        const cmi = Math.abs((rs - 1) / (rs + 1));

        const sc = Math.pow(cmi * (this._fastestSC - this._slowestSC) + this._slowestSC, 2);

        if (!this.ready) {
            if (this._prices.length === this.period) {
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._prices[i];
                }
                this.value = sum / this.period;
                this.ready = true;
            }
            return this.value;
        }

        this.value = this.value + sc * (price - this.value);
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._upSum = 0;
        this._downSum = 0;
        this._prevClose = null;
        this._emaGain = new IncrementalEMA(this.period);
        this._emaLoss = new IncrementalEMA(this.period);
        this._prices = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = VIDYA;