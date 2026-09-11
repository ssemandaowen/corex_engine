"use strict";

/**
 * Stateful, incrementally-updated technical indicators (EMA, RSI, ATR).
 * Updates in O(1) per tick with zero per-update allocations.
 */

class IncrementalEMA {
    constructor(period) {
        if (!period || period < 1) throw new Error("EMA period must be >= 1");
        this.period = period;
        this.multiplier = 2 / (period + 1);
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        if (!this.ready) {
            this._buffer.push(price);
            if (this._buffer.length === this.period) {
                // Initial EMA is SMA of the first `period` values
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._buffer[i];
                }
                this.value = sum / this.period;
                this.ready = true;
                this._buffer = null; // release memory
            }
            return this.value;
        }

        // O(1) EMA update
        this.value = (price - this.prev) * this.multiplier + this.prev;
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

class IncrementalRSI {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("RSI period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._gains = [];
        this._losses = [];
        this._avgGain = 0;
        this._avgLoss = 0;
    }

    update(price) {
        this.prev = this.value;
        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const change = price - this._prevClose;
        this._prevClose = price;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        if (!this.ready) {
            this._gains.push(gain);
            this._losses.push(loss);

            if (this._gains.length === this.period) {
                let sumGain = 0;
                let sumLoss = 0;
                for (let i = 0; i < this.period; i++) {
                    sumGain += this._gains[i];
                    sumLoss += this._losses[i];
                }
                this._avgGain = sumGain / this.period;
                this._avgLoss = sumLoss / this.period;

                if (this._avgLoss === 0) {
                    this.value = 100;
                } else {
                    const rs = this._avgGain / this._avgLoss;
                    this.value = 100 - (100 / (1 + rs));
                }
                this.ready = true;
                this._gains = null;
                this._losses = null;
            }
            return this.value;
        }

        // O(1) Wilder smoothing for RSI
        this._avgGain = (this._avgGain * (this.period - 1) + gain) / this.period;
        this._avgLoss = (this._avgLoss * (this.period - 1) + loss) / this.period;

        if (this._avgLoss === 0) {
            this.value = 100;
        } else if (this._avgGain === 0) {
            this.value = 0;
        } else {
            const rs = this._avgGain / this._avgLoss;
            this.value = 100 - (100 / (1 + rs));
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._gains = [];
        this._losses = [];
        this._avgGain = 0;
        this._avgLoss = 0;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

class IncrementalATR {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("ATR period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._trBuffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;
        if (this._prevClose === null) {
            this._prevClose = close;
            return this.value;
        }

        const hl = high - low;
        const hc = Math.abs(high - this._prevClose);
        const lc = Math.abs(low - this._prevClose);
        const tr = Math.max(hl, hc, lc);
        this._prevClose = close;

        if (!this.ready) {
            this._trBuffer.push(tr);
            if (this._trBuffer.length === this.period) {
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._trBuffer[i];
                }
                this.value = sum / this.period;
                this.ready = true;
                this._trBuffer = null;
            }
            return this.value;
        }

        // O(1) Wilder smoothing for ATR
        this.value = (this.value * (this.period - 1) + tr) / this.period;
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._trBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = {
    IncrementalEMA,
    IncrementalRSI,
    IncrementalATR
};
