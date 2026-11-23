"use strict";

const BaseIndicator = require("./BaseIndicator");
const EmaCore = require("./core/EmaCore");

class IncrementalEMA extends BaseIndicator {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];
    static meta = Object.freeze({ version: 2, aliases: ["ExponentialMovingAverage"], cost: "O(1)" });

    constructor(period, options = {}) {
        super(options);
        if (!Number.isInteger(period) || period < 1) throw new TypeError("EMA period must be a positive integer");
        this.period = period;
        this.core = new EmaCore(period);
        this.multiplier = this.core.alpha;
    }

    onFrame(frame) {
        const next = this.core.update(this.readSource(frame));
        this.ready = this.core.ready;
        this.value = this.ready ? next : NaN;
    }

    onReset() {
        this.core.reset();
    }

    reconfigure(params = {}, store, scratchFrame) {
        const period = params.period === undefined ? this.period : params.period;
        if (!Number.isInteger(period) || period < 1) throw new TypeError("EMA period must be a positive integer");
        this.period = period;
        this.core = new EmaCore(period);
        this.multiplier = this.core.alpha;
        return super.reconfigure({ source: params.source === undefined ? this.source : params.source }, store, scratchFrame);
    }

    setPeriod(period) {
        return this.reconfigure({ period });
    }
}

module.exports = IncrementalEMA;