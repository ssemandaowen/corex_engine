"use strict";

class IncrementalRSI {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

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

module.exports = IncrementalRSI;
