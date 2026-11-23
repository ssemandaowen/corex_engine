"use strict";

const BaseIndicator = require("./BaseIndicator");
const WilderCore = require("./core/WilderCore");

class IncrementalATR extends BaseIndicator {
    static updateMode = "single";
    static meta = Object.freeze({ version: 2, aliases: ["AverageTrueRange"], cost: "O(1)" });
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new TypeError("ATR period must be a positive integer");
        this.period = period;
        this.core = new WilderCore(period);
        this._prevClose = NaN;
    }

    onFrame(frame) {
        if (!Number.isFinite(this._prevClose)) {
            this._prevClose = frame.c;
            this.value = NaN;
            this.ready = false;
            return;
        }
        const tr = Math.max(
            frame.h - frame.l,
            Math.abs(frame.h - this._prevClose),
            Math.abs(frame.l - this._prevClose)
        );
        this._prevClose = frame.c;
        const next = this.core.update(tr);
        this.ready = this.core.ready;
        this.value = this.ready ? next : NaN;
    }

    onReset() {
        this.core = new WilderCore(this.period);
        this._prevClose = NaN;
    }

    reconfigure(params = {}, store, scratchFrame) {
        const period = params.period === undefined ? this.period : params.period;
        if (!Number.isInteger(period) || period < 1) throw new TypeError("ATR period must be a positive integer");
        this.period = period;
        return super.reconfigure({ source: params.source === undefined ? this.source : params.source }, store, scratchFrame);
    }

    setPeriod(period) {
        return this.reconfigure({ period });
    }
}

module.exports = IncrementalATR;