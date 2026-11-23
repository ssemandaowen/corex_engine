"use strict";

/**
 * SlidingLinReg — sliding-window linear regression slope.
 *
 * Positions 0..n-1 assigned to oldest..newest.
 *   T = sum i*y_i; S = sum y_i
 *   Sliding: T' = T - (S - y_old) + (n-1)*y_new; S' = S - y_old + y_new
 *   Growing:   T' = T + (n-1)*y_new; S' = S + y_new
 *   slope = (n*T - sum_i*S) / (n*sum_i2 - sum_i^2)
 *   where sum_i = n*(n-1)/2, sum_i2 = (n-1)*n*(2n-1)/6
 *
 * Periodic exact re-sum every w pushes to stop drift. No per-call allocation.
 */
class SlidingLinReg {
    constructor(w) {
        if (!Number.isFinite(w) || w <= 0) {
            throw new Error("SlidingLinReg: w must be a positive finite number");
        }
        this.w = w;
        this.vals = new Float64Array(w);
        this.pos = 0;
        this.count = 0;
        this._S = 0;
        this._T = 0;
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
            this._S = v;
            this._T = 0;
        } else if (wasFull) {
            this._T = this._T - (this._S - xo) + (n - 1) * v;
            this._S = this._S - xo + v;
        } else {
            this._T = this._T + (n - 1) * v;
            this._S = this._S + v;
        }

        this.pushes++;
        if (this.pushes % this.w === 0) {
            this._recompute();
        }
    }

    _recompute() {
        const n = this.count;
        const start = this.count < this.w ? 0 : this.pos;
        let S = 0;
        let T = 0;
        for (let i = 0; i < n; i++) {
            const val = this.vals[(start + i) % this.w];
            S += val;
            T += i * val;
        }
        this._S = S;
        this._T = T;
    }

    get slope() {
        const n = this.count;
        if (n < 2) return 0;
        const sumI = (n * (n - 1)) / 2;
        const sumI2 = ((n - 1) * n * (2 * n - 1)) / 6;
        const denom = n * sumI2 - sumI * sumI;
        if (denom === 0) return 0;
        return (n * this._T - sumI * this._S) / denom;
    }

    get length() {
        return this.count;
    }
}

module.exports = SlidingLinReg;
