"use strict";

class MFI {
    constructor(period = 14) {
        if (!period || period < 1) throw new Error("MFI period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._rmfBuffer = [];
    }

    update(typicalPrice, moneyFlow, volume) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = typicalPrice;
            return this.value;
        }

        const prevTypical = this._prevClose;
        this._prevClose = typicalPrice;

        let rmf = 0;
        if (typicalPrice > prevTypical) {
            rmf = moneyFlow;
        } else if (typicalPrice < prevTypical) {
            rmf = -moneyFlow;
        }

        this._rmfBuffer.push({ rmf, moneyFlow, volume });
        if (this._rmfBuffer.length > this.period) {
            this._rmfBuffer.shift();
        }

        if (this._rmfBuffer.length === this.period) {
            let sumPos = 0;
            let sumNeg = 0;
            for (let i = 0; i < this.period; i++) {
                if (this._rmfBuffer[i].rmf > 0) {
                    sumPos += this._rmfBuffer[i].rmf;
                } else {
                    sumNeg += Math.abs(this._rmfBuffer[i].rmf);
                }
            }

            if (sumNeg === 0) {
                this.value = 100;
            } else {
                const mfr = sumPos / sumNeg;
                this.value = 100 - (100 / (1 + mfr));
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._rmfBuffer = [];

        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const typicalPrice = (c.high + c.low + c.close) / 3;
            const moneyFlow = typicalPrice * (c.volume || 0);
            this.update(typicalPrice, moneyFlow, c.volume);
        }
        return this.value;
    }
}

module.exports = MFI;