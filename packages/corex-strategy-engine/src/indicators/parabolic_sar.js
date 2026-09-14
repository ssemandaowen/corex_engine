"use strict";

class ParabolicSAR {
    constructor(step = 0.02, maxStep = 0.2) {
        this.AF = step;
        this.maxAF = maxStep;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._long = true;
        this._af = step;
        this._ep = 0;
        this._prevHigh = null;
        this._prevLow = null;
    }

    update(high, low, close) {
        this.prev = this.value;

        if (!this.ready) {
            this._long = close <= low;
            this._ep = this._long ? high : low;
            this.value = this._ep;
            this._prevHigh = high;
            this._prevLow = low;
            this.ready = true;
            return this.value;
        }

        if (this._long) {
            if (high > this._ep) {
                this._ep = high;
                this._af = Math.min(this._af + this.AF, this.maxAF);
            }
            this.value = this.value + this._af * (this._ep - this.value);
            this.value = Math.min(this.value, this._prevLow);

            if (low <= this.value) {
                this._long = false;
                this._af = this.AF;
                this._ep = low;
                this.value = this._ep;
            }
        } else {
            if (low < this._ep) {
                this._ep = low;
                this._af = Math.min(this._af + this.AF, this.maxAF);
            }
            this.value = this.value + this._af * (this._ep - this.value);
            this.value = Math.max(this.value, this._prevHigh);

            if (high >= this.value) {
                this._long = true;
                this._af = this.AF;
                this._ep = high;
                this.value = this._ep;
            }
        }

        this._prevHigh = high;
        this._prevLow = low;

        if (this._long && this.value > low) this.value = high;
        if (!this._long && this.value < high) this.value = low;

        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._long = true;
        this._af = this.AF;
        this._ep = 0;
        this._prevHigh = null;
        this._prevLow = null;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }

    get direction() {
        return this._long ? "long" : "short";
    }
}

module.exports = ParabolicSAR;