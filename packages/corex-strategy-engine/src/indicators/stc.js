"use strict";

const IncrementalEMA = require("./ema");

class STC {
    static updateMode = "single";
    static resolveParams = (indDef) => [Number(indDef.cycle || 10), Number(indDef.entry || 0.3), Number(indDef.signal || 5)];

    constructor(cyclePeriod = 10, entryPercentage = 0.3, signalPeriod = 5) {
        if (!cyclePeriod || cyclePeriod < 1) throw new Error("STC cyclePeriod must be >= 1");
        if (!signalPeriod || signalPeriod < 1) throw new Error("STC signalPeriod must be >= 1");
        this.cyclePeriod = cyclePeriod;
        this.entryPercentage = entryPercentage;
        this.signalPeriod = signalPeriod;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._filteredBuffer = [];
        this._scBuff = [];
        this._scSum = 0;
        this._scCount = 0;
        this._scAvg = 0;
    }

    update(price) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = price;
            this._filteredBuffer.push({ value: 0, prev: 0 });
            return this.value;
        }

        const max = Math.max(price, this._filteredBuffer[this._filteredBuffer.length - 1].value);
        const min = Math.min(price, this._filteredBuffer[this._filteredBuffer.length - 1].value);

        this._filteredBuffer.push({ value: max, prev: min });
        if (this._filteredBuffer.length > this.cyclePeriod) {
            this._filteredBuffer.shift();
        }

        if (this._filteredBuffer.length === this.cyclePeriod) {
            const ma = this._calculateMA(this._filteredBuffer.map(f => f.value));
            const prevMA = this._calculateMA(this._filteredBuffer.map(f => f.prev));
            const diff = ma - prevMA;
            const pct = prevMA !== 0 ? diff / (this.entryPercentage * Math.abs(prevMA)) : 0;

            this._scBuff.push(pct);
            if (this._scBuff.length > this.signalPeriod) {
                this._scBuff.shift();
            }
        }

        if (this._scBuff.length >= this.signalPeriod) {
            const sum = this._scBuff.reduce((a, b) => a + b, 0);
            this._scAvg = sum / this._scBuff.length;
        }

        this._prevClose = price;
        this.value = this._scAvg;
        this.ready = true;
        return this.value;
    }

    _calculateMA(values) {
        const len = values.length;
        if (len === 0) return 0;
        let sum = 0;
        for (let i = 0; i < len; i++) {
            sum += values[i];
        }
        return sum / len;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._filteredBuffer = [];
        this._scBuff = [];
        this._scSum = 0;
        this._scCount = 0;
        this._scAvg = 0;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = STC;