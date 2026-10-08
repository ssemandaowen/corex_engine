"use strict";

/**
 * Incremental Simple Moving Average (SMA).
 *
 * Performance Optimization (Bolt ⚡):
 * Uses an O(1) sliding window circular buffer and running sum (_sum, _head)
 * to achieve constant time updates per price tick without array shifting or re-summing loops.
 */
class IncrementalSMA {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period) {
        if (!period || period < 1) throw new Error("SMA period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._sum = 0;
        this._head = 0;
    }

    update(price) {
        this.prev = this.value;
        if (!this.ready) {
            this._buffer.push(price);
            this._sum += price;
            if (this._buffer.length === this.period) {
                this.ready = true;
            }
            this.value = this._sum / this._buffer.length;
            return this.value;
        }

        // O(1) sliding window update with circular buffer
        const oldPrice = this._buffer[this._head];
        this._buffer[this._head] = price;
        this._sum += price - oldPrice;
        this._head = (this._head + 1) % this.period;

        // Periodic re-sum when head wraps to eliminate cumulative float drift
        if (this._head === 0) {
            let sum = 0;
            for (let i = 0; i < this.period; i++) {
                sum += this._buffer[i];
            }
            this._sum = sum;
        }

        this.value = this._sum / this.period;
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        this._sum = 0;
        this._head = 0;
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = IncrementalSMA;
