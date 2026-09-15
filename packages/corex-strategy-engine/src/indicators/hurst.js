"use strict";

class HurstExponent {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 20)];

    constructor(period = 20) {
        if (!period || period < 1) throw new Error("HurstExponent period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._logPeriod = Math.log10(period);
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            const mean = this._buffer.reduce((a, b) => a + b, 0) / this.period;
            const deviation = this._buffer.map(v => v - mean);
            const cumulative = [];
            let cum = 0;
            for (let i = 0; i < deviation.length; i++) {
                cum += deviation[i];
                cumulative.push(cum);
            }

            const range = Math.max(...cumulative) - Math.min(...cumulative);
            const stdDev = Math.sqrt(
                this._buffer.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / this.period
            );

            if (stdDev === 0) {
                this.value = 0.5;
            } else {
                const rs = range / stdDev;
                this.value = Math.log10(rs) / this._logPeriod;
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = HurstExponent;