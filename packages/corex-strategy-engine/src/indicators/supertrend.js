"use strict";

const IncrementalATR = require("./atr");
const IncrementalEMA = require("./ema");

class SuperTrend {
    static updateMode = "multi";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 10), Number(indDef.multiplier || 3)];

    constructor(period = 10, multiplier = 3) {
        if (!period || period < 1) throw new Error("SuperTrend period must be >= 1");
        this.period = period;
        this.multiplier = multiplier;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._atr = new IncrementalATR(period);
        this._prevClose = null;
        this._prevFinalUpper = 0;
        this._prevFinalLower = 0;
        this._prevSuperTrend = 0;
        this._prevDirection = 1;
        this._upperBand = 0;
        this._lowerBand = 0;
    }

    update(high, low, close) {
        this.prev = this.value;
        if (this._prevClose === null) {
            this._prevClose = close;
            return this.value;
        }

        this._atr.update(high, low, close);
        const atr = this._atr.value;
        if (atr === 0) {
            this._prevClose = close;
            return this.value;
        }

        const hl2 = (high + low) / 2;
        const basicUpper = hl2 + this.multiplier * atr;
        const basicLower = hl2 - this.multiplier * atr;

        let finalUpper, finalLower;
        if (basicUpper < this._prevFinalUpper || this._prevClose > this._prevFinalUpper) {
            finalUpper = basicUpper;
        } else {
            finalUpper = this._prevFinalUpper;
        }

        if (basicLower > this._prevFinalLower || this._prevClose < this._prevFinalLower) {
            finalLower = basicLower;
        } else {
            finalLower = this._prevFinalLower;
        }

        this._prevClose = close;

        let direction, superTrend;
        if (this._prevSuperTrend === this._prevFinalUpper) {
            if (close <= finalUpper) {
                direction = 1;
                superTrend = finalLower;
            } else {
                direction = -1;
                superTrend = finalUpper;
            }
        } else if (this._prevSuperTrend === this._prevFinalLower) {
            if (close >= finalLower) {
                direction = -1;
                superTrend = finalUpper;
            } else {
                direction = 1;
                superTrend = finalLower;
            }
        } else {
            if (close >= finalUpper) {
                direction = -1;
                superTrend = finalUpper;
            } else {
                direction = 1;
                superTrend = finalLower;
            }
        }

        this._prevFinalUpper = finalUpper;
        this._prevFinalLower = finalLower;
        this._prevSuperTrend = superTrend;
        this._prevDirection = direction;
        this._upperBand = finalUpper;
        this._lowerBand = finalLower;
        this.value = superTrend;
        this.ready = true;
        this.bearish = direction === 1;
        this.bullish = direction === -1;
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._prevClose = null;
        this._prevFinalUpper = 0;
        this._prevFinalLower = 0;
        this._prevSuperTrend = 0;
        this._prevDirection = 1;
        this._atr = new IncrementalATR(this.period);
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.value;
    }

    get direction() {
        return this._prevDirection;
    }
}

module.exports = SuperTrend;