"use strict";

const IncrementalATR = require("./atr");

class ADX {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("ADX period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.diPlus = 0;
        this.diMinus = 0;
        this.dx = 0;
        this._prevHigh = null;
        this._prevLow = null;
        this._trBuffer = [];
        this._plusDBuffer = [];
        this._minusDBuffer = [];
        this._atr = new IncrementalATR(period);
    }

    update(high, low, close) {
        this.prev = this.value;

        if (this._prevHigh === null) {
            this._prevHigh = high;
            this._prevLow = low;
            this._atr.update(high, low, close);
            return this.value;
        }

        const highPrev = this._prevHigh;
        const lowPrev = this._prevLow;

        const upMove = high - highPrev;
        const downMove = lowPrev - low;

        let plusDM = 0;
        let minusDM = 0;
        if (upMove > downMove && upMove > 0) {
            plusDM = upMove;
        }
        if (downMove > upMove && downMove > 0) {
            minusDM = downMove;
        }

        const tr = Math.max(
            high - low,
            Math.abs(high - close),
            Math.abs(low - close)
        );

        this._trBuffer.push(tr);
        this._plusDBuffer.push(plusDM);
        this._minusDBuffer.push(minusDM);

        if (this._trBuffer.length > this.period) {
            this._trBuffer.shift();
            this._plusDBuffer.shift();
            this._minusDBuffer.shift();
        }

        this._prevHigh = high;
        this._prevLow = low;
        this._atr.update(high, low, close);

        if (this._trBuffer.length === this.period) {
            let sumTR = 0;
            let sumPlusDM = 0;
            let sumMinusDM = 0;
            for (let i = 0; i < this.period; i++) {
                sumTR += this._trBuffer[i];
                sumPlusDM += this._plusDBuffer[i];
                sumMinusDM += this._minusDBuffer[i];
            }

            const trAvg = sumTR === 0 ? 0.0001 : sumTR;
            const plusDI = sumPlusDM === 0 ? 0 : (sumPlusDM / trAvg) * 100;
            const minusDI = sumMinusDM === 0 ? 0 : (sumMinusDM / trAvg) * 100;

            this.diPlus = plusDI;
            this.diMinus = minusDI;

            const dx = plusDI + minusDI === 0 ? 0 : Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
            this.dx = dx;

            this._buffer = this._buffer || [];
            this._buffer.push(dx);
            if (this._buffer.length > this.period) {
                this._buffer.shift();
            }

            if (this._buffer.length === this.period) {
                let sumDX = 0;
                for (let i = 0; i < this.period; i++) {
                    sumDX += this._buffer[i];
                }
                this.value = sumDX / this.period;
                this.ready = true;
            }
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.diPlus = 0;
        this.diMinus = 0;
        this.dx = 0;
        this._prevHigh = null;
        this._prevLow = null;
        this._trBuffer = [];
        this._plusDBuffer = [];
        this._minusDBuffer = [];
        this._buffer = [];
        this._atr = new IncrementalATR(this.period);
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = ADX;