"use strict";

/**
 * SlidingWma — sliding weighted moving average.
 *
 * Weights 1..n applied to oldest..newest.
 *   S = sum x; N = sum i*x_i (i=1..n)
 *   Sliding: N' = N - S + n*x_new; S' = S - xo + x_new
 *   Growing: N' = N + n*x_new; S' = S + x_new
 *   wma = N / (n*(n+1)/2)
 *
 * Periodic exact re-sum every w pushes to stop drift. No per-call allocation.
 */
class SlidingWma {
    constructor(w) {
        if (!Number.isFinite(w) || w <= 0) {
            throw new Error("SlidingWma: w must be a positive finite number");
        }
        this.w = w;
        this.vals = new Float64Array(w);
        this.pos = 0;
        this.count = 0;
        this._S = 0;
        this._N = 0;
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
            this._N = v;
        } else if (wasFull) {
            this._N = this._N - this._S + n * v;
            this._S = this._S - xo + v;
        } else {
            this._N = this._N + n * v;
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
        let N = 0;
        for (let i = 0; i < n; i++) {
            const val = this.vals[(start + i) % this.w];
            S += val;
            N += (i + 1) * val;
        }
        this._S = S;
        this._N = N;
    }

    get wma() {
        const n = this.count;
        if (n === 0) return 0;
        return this._N / (n * (n + 1) / 2);
    }

    get length() {
        return this.count;
    }
}

module.exports = SlidingWma;
