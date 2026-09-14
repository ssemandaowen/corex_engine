"use strict";

class TSI {
    constructor(shortPeriod = 25, longPeriod = 13) {
        if (!shortPeriod || shortPeriod < 1) throw new Error("TSI shortPeriod must be >= 1");
        if (!longPeriod || longPeriod < 1) throw new Error("TSI longPeriod must be >= 1");
        this.shortPeriod = shortPeriod;
        this.longPeriod = longPeriod;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._diffBuffer = [];
        this._absDiffBuffer = [];
        this._emaLongDiff = 0;
        this._emaLongAbsDiff = 0;
        this._emaShortDiff = 0;
        this._emaShortAbsDiff = 0;
        this._longReady = false;
        this._shortReady = false;
    }

    update(price) {
        this.prev = this.value;

        if (this._prevClose === null) {
            this._prevClose = price;
            return this.value;
        }

        const diff = price - this._prevClose;
        const absDiff = Math.abs(diff);
        this._prevClose = price;

        const alphaLong = 2 / (this.longPeriod + 1);
        const alphaShort = 2 / (this.shortPeriod + 1);

        if (!this._longReady) {
            this._emaLongDiff = diff;
            this._emaLongAbsDiff = absDiff;
            this._longReady = true;
        } else {
            this._emaLongDiff = this._emaLongDiff * (1 - alphaLong) + diff * alphaLong;
            this._emaLongAbsDiff = this._emaLongAbsDiff * (1 - alphaLong) + absDiff * alphaLong;
        }

        if (this._longReady && !this._shortReady) {
            this._emaShortDiff = this._emaLongDiff;
            this._emaShortAbsDiff = this._emaLongAbsDiff;
            this._shortReady = true;
        } else if (this._longReady && this._shortReady) {
            this._emaShortDiff = this._emaShortDiff * (1 - alphaShort) + this._emaLongDiff * alphaShort;
            this._emaShortAbsDiff = this._emaShortAbsDiff * (1 - alphaShort) + this._emaLongAbsDiff * alphaShort;
        }

        if (this._shortReady && this._emaShortAbsDiff !== 0) {
            this.value = 100 * (this._emaShortDiff / this._emaShortAbsDiff);
            this.ready = true;
        }

        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._diffBuffer = [];
        this._absDiffBuffer = [];
        this._emaLongDiff = 0;
        this._emaLongAbsDiff = 0;
        this._emaShortDiff = 0;
        this._emaShortAbsDiff = 0;
        this._longReady = false;
        this._shortReady = false;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = TSI;