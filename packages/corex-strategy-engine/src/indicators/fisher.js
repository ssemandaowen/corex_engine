"use strict";

class FisherTransform {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 9)];

    constructor(period = 9) {
        if (!period || period < 1) throw new Error("FisherTransform period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            const highest = Math.max(...this._buffer);
            const lowest = Math.min(...this._buffer);
            const range = highest - lowest;

            let normalized;
            if (range === 0) {
                normalized = 0;
            } else {
                normalized = 0.66 * ((price - lowest) / range - 0.5) + 0.5 * (this.prev || 0);
            }

            normalized = Math.max(-0.999, Math.min(0.999, normalized));

            this.value = 0.5 * Math.log((1 + normalized) / (1 - normalized));
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

module.exports = FisherTransform;