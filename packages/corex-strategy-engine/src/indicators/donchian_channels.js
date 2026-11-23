"use strict";

const BaseIndicator = require("./BaseIndicator");
const MonotonicDeque = require("../kernel/MonotonicDeque");

class DonchianChannels extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 1 });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new Error("DonchianChannels period must be a positive integer");
        this.period = period;
        this._highs = new MonotonicDeque(period);
        this._lows = new MonotonicDeque(period);
        this.upper = 0;
        this.lower = 0;
    }

    onFrame(frame) {
        this._highs.push(frame.h);
        this._lows.push(frame.l);

        if (this._highs.length >= this.period) {
            const upper = this._highs.max();
            const lower = this._lows.min();
            this.value = (upper + lower) / 2;
            this.upper = upper;
            this.lower = lower;
            this.ready = true;
        } else {
            this.value = NaN;
            this.upper = 0;
            this.lower = 0;
            this.ready = false;
        }
    }

    onReset() {
        this._highs = new MonotonicDeque(this.period);
        this._lows = new MonotonicDeque(this.period);
        this.upper = 0;
        this.lower = 0;
    }

    setPeriod(period) {
        if (!Number.isInteger(period) || period < 1) throw new Error("DonchianChannels period must be a positive integer");
        this.period = period;
        return this.reset();
    }
}

module.exports = DonchianChannels;
