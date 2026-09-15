"use strict";

class McGinleyDynamic {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14), Number(indDef.k || 0.6)];

    constructor(period = 14, k = 0.6) {
        if (!period || period < 1) throw new Error("McGinley period must be >= 1");
        this.period = period;
        this.k = k;
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

        if (!this.ready) {
            if (this._buffer.length === this.period) {
                let sum = 0;
                for (let i = 0; i < this.period; i++) {
                    sum += this._buffer[i];
                }
                this.value = sum / this.period;
                this.ready = true;
            }
            return this.value;
        }

        const ratio = Math.abs(price / this.value);
        const adjustment = this.k * (price - this.value) * ratio;
        this.value = this.value + adjustment;
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

module.exports = McGinleyDynamic;