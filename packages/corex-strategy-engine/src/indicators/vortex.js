"use strict";

class VortexIndicator {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("Vortex period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.viPlus = 0;
        this.viMinus = 0;
        this._prevHigh = null;
        this._prevLow = null;
        this._plusBuffer = [];
        this._minusBuffer = [];
        this._trBuffer = [];
    }

    update(high, low, close) {
        this.prev = this.value;

        if (this._prevHigh === null) {
            this._prevHigh = high;
            this._prevLow = low;
            return this.value;
        }

        const upMove = Math.abs(high - this._prevHigh);
        const downMove = Math.abs(this._prevLow - low);
        const tr = Math.max(
            high - low,
            Math.abs(high - close),
            Math.abs(low - close)
        );

        this._plusBuffer.push(upMove);
        this._minusBuffer.push(downMove);
        this._trBuffer.push(tr);

        if (this._plusBuffer.length > this.period) {
            this._plusBuffer.shift();
            this._minusBuffer.shift();
            this._trBuffer.shift();
        }

        this._prevHigh = high;
        this._prevLow = low;

        if (this._plusBuffer.length === this.period) {
            let sumPlus = 0;
            let sumMinus = 0;
            let sumTR = 0;
            for (let i = 0; i < this.period; i++) {
                sumPlus += this._plusBuffer[i];
                sumMinus += this._minusBuffer[i];
                sumTR += this._trBuffer[i];
            }

            const tr = sumTR === 0 ? 0.0001 : sumTR;
            this.viPlus = sumPlus / tr;
            this.viMinus = sumMinus / tr;
            this.value = this.viPlus;
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this.viPlus = 0;
        this.viMinus = 0;
        this._prevHigh = null;
        this._prevLow = null;
        this._plusBuffer = [];
        this._minusBuffer = [];
        this._trBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }
}

module.exports = VortexIndicator;