"use strict";

class ChoppinessIndex {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("ChoppinessIndex period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;
        this._buffer.push({ high, low, close });
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            let sumTR = 0;
            for (let i = 1; i < this.period; i++) {
                const curr = this._buffer[i];
                const prev = this._buffer[i - 1];
                const tr = Math.max(
                    curr.high - curr.low,
                    Math.abs(curr.high - prev.close),
                    Math.abs(curr.low - prev.close)
                );
                sumTR += tr;
            }

            let highestHigh = -Infinity;
            let lowestLow = Infinity;
            for (let i = 0; i < this.period; i++) {
                if (this._buffer[i].high > highestHigh) highestHigh = this._buffer[i].high;
                if (this._buffer[i].low < lowestLow) lowestLow = this._buffer[i].low;
            }

            const range = highestHigh - lowestLow;
            if (range === 0 || sumTR === 0) {
                this.value = 0;
            } else {
                this.value = (-100 * Math.log(sumTR / range)) / Math.log(this.period);
            }
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
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = ChoppinessIndex;