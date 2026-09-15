"use strict";

class InstantaneousTrendline {
    static updateMode = "single";
    static resolveParams = (indDef) => [Number(indDef.alpha || 0.07)];

    constructor(alpha = 0.07) {
        if (alpha < 0.01 || alpha > 1) throw new Error("InstantaneousTrendline alpha must be between 0.01 and 1");
        this.alpha = alpha;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevPrice = null;
        this._priceBuffer = [];
        this._trendBuffer = [];
    }

    update(price) {
        this.prev = this.value;

        if (this._priceBuffer.length < 3) {
            this._priceBuffer.push(price);
            this._prevPrice = price;
            return this.value;
        }

        this._priceBuffer.push(price);
        if (this._priceBuffer.length > 3) {
            this._priceBuffer.shift();
        }

        const p0 = this._priceBuffer[0];
        const p1 = this._priceBuffer[1];
        const p2 = this._priceBuffer[2];
        const p3 = this._priceBuffer[3] !== undefined ? this._priceBuffer[3] : price;

        let trend = this._alpha * (price + p1 - p3) + (1 - this.alpha) * this._trendBuffer[this._trendBuffer.length - 1] || 0;

        if (!this._trendBuffer.length) {
            trend = price;
        }

        this._trendBuffer.push(trend);
        if (this._trendBuffer.length > 50) {
            this._trendBuffer.shift();
        }

        this._prevPrice = price;
        this.value = trend;
        this.ready = true;
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevPrice = null;
        this._priceBuffer = [];
        this._trendBuffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = InstantaneousTrendline;