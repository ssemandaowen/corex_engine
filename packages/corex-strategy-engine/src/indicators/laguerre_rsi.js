"use strict";

class LaguerreRSI {
    static updateMode = "single";
    static resolveParams = (indDef) => [Number(indDef.gamma || 0.5)];

    constructor(gamma = 0.5) {
        if (gamma < 0 || gamma > 1) throw new Error("Laguerre filter gamma must be between 0 and 1");
        this.gamma = gamma;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._l0 = 0;
        this._l1 = 0;
        this._l2 = 0;
        this._l3 = 0;
        this._prevClose = null;
    }

    update(price) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const g = this.gamma;
        const prevL0 = this._l0;
        const prevL1 = this._l1;
        const prevL2 = this._l2;
        const prevL3 = this._l3;

        this._l0 = (1 - g) * price + g * prevL3;
        this._l1 = prevL0 - g * prevL0 + g * prevL1;
        this._l2 = prevL1 - g * prevL1 + g * prevL2;
        this._l3 = prevL2 - g * prevL2 + g * prevL3;

        const diff = this._l0 - this._l3;
        const sum = Math.abs(this._l0) + Math.abs(this._l3);

        if (sum === 0) {
            this.value = 0;
        } else {
            this.value = Math.min(1, Math.max(-1, diff / sum)) * 50 + 50;
        }

        this._prevClose = price;
        this.ready = true;
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._l0 = 0;
        this._l1 = 0;
        this._l2 = 0;
        this._l3 = 0;
        this._prevClose = null;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = LaguerreRSI;