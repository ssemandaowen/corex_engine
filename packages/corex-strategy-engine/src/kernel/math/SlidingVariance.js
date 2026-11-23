"use strict";

/**
 * SlidingVariance — sliding-window variance using Welford's recurrence.
 *
 *   mean'   = mean + (x - xo) / n
 *   M2'     = M2 + (x - xo) * (x + xo - mean' - mean_old)
 *   variance = M2 / (n - 1)
 *
 * xo is the value leaving the window (0 when growing). Periodic exact re-sum
 * every w pushes to stop drift. No per-call allocation.
 */
class SlidingVariance {
    constructor(w) {
        if (!Number.isFinite(w) || w <= 0) {
            throw new Error("SlidingVariance: w must be a positive finite number");
        }
        this.w = w;
        this.vals = new Float64Array(w);
        this.pos = 0;
        this.count = 0;
        this._mean = 0;
        this._M2 = 0;
        this.pushes = 0;
    }

    push(x) {
        const v = Number(x);
        const xo = this.vals[this.pos];
        const wasFull = this.count === this.w;

        this.vals[this.pos] = v;
        this.pos = (this.pos + 1) % this.w;
        if (this.count < this.w) this.count++;

        const n = this.count;

        if (n === 1) {
            this._mean = v;
            this._M2 = 0;
        } else if (wasFull) {
            const oldMean = this._mean;
            this._mean = oldMean + (v - xo) / n;
            this._M2 = this._M2 + (v - xo) * (v + xo - this._mean - oldMean);
        } else {
            const oldMean = this._mean;
            this._mean = oldMean + (v - oldMean) / n;
            this._M2 = this._M2 + (v - oldMean) * (v - this._mean);
        }

        this.pushes++;
        if (this.pushes % this.w === 0) {
            this._recompute();
        }
    }

    _recompute() {
        const n = this.count;
        const start = this.count < this.w ? 0 : this.pos;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            sum += this.vals[(start + i) % this.w];
        }
        this._mean = sum / n;
        let m2 = 0;
        for (let i = 0; i < n; i++) {
            const d = this.vals[(start + i) % this.w] - this._mean;
            m2 += d * d;
        }
        this._M2 = m2;
    }

    get mean() {
        return this._mean;
    }

    get variance() {
        return this.count > 1 ? this._M2 / (this.count - 1) : 0;
    }

    get length() {
        return this.count;
    }
}

module.exports = SlidingVariance;
