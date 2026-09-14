"use strict";

const IncrementalEMA = require("./ema");

class MACD {
    constructor(fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (!fastPeriod || fastPeriod < 1) throw new Error("MACD fastPeriod must be >= 1");
        if (!slowPeriod || slowPeriod < 1) throw new Error("MACD slowPeriod must be >= 1");
        if (!signalPeriod || signalPeriod < 1) throw new Error("MACD signalPeriod must be >= 1");
        this.fastPeriod = fastPeriod;
        this.slowPeriod = slowPeriod;
        this.signalPeriod = signalPeriod;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.histoReady = false;
        this._fastEMA = new IncrementalEMA(fastPeriod);
        this._slowEMA = new IncrementalEMA(slowPeriod);
        this._signalEMA = new IncrementalEMA(signalPeriod);
        this._prevSignal = 0;
        this._signalStarted = false;
        this.histo = 0;
        this.histoPrev = 0;
        this.signal = 0;
    }

    update(price) {
        this.prev = this.value;
        this.histoPrev = this.histo;

        const fast = this._fastEMA.update(price);
        const slow = this._slowEMA.update(price);

        if (!this._fastEMA.ready || !this._slowEMA.ready) {
            return this.value;
        }

        this.value = fast - slow;

        const signal = this._signalEMA.update(this.value);
        if (!this._signalEMA.ready) {
            return this.value;
        }

        if (!this._signalStarted) {
            this._signalStarted = true;
            this._prevSignal = 0;
            return this.value;
        }

        this.histo = this.value - signal;
        this.histoReady = true;

        this._prevSignal = signal;
        this.signal = signal;
        this.ready = true;

        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.histoReady = false;
        this._fastEMA = new IncrementalEMA(this.fastPeriod);
        this._slowEMA = new IncrementalEMA(this.slowPeriod);
        this._signalEMA = new IncrementalEMA(this.signalPeriod);
        this._prevSignal = 0;
        this._signalStarted = false;
        this.histo = 0;
        this.histoPrev = 0;
        this.signal = 0;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = MACD;