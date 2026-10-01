"use strict";

/**
 * Fractal Dimension Index (FDI)
 *
 * Measures market complexity and trendiness:
 * - FDI ≈ 1.5: Random walk / Gaussian noise
 * - FDI < 1.5: Trending market (persistent)
 * - FDI > 1.5: Mean-reverting / choppiness (anti-persistent)
 *
 * Algorithm complexity: O(period)
 */
class FractalDimensionIndex {
    constructor(period = 30) {
        if (!period || period < 1) throw new Error("FDI period must be >= 1");
        this.period = period;
        this.value = 1.5;
        this.prev = 1.5;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period + 1) {
            this._buffer.shift();
        }

        if (this._buffer.length >= this.period + 1) {
            const n = this.period;
            const data = this._buffer.slice(-n - 1);

            let maxP = -Infinity;
            let minP = Infinity;
            for (let i = 0; i <= n; i++) {
                const p = data[i];
                if (p > maxP) maxP = p;
                if (p < minP) minP = p;
            }

            const range = maxP - minP;
            if (range < 1e-12) {
                this.value = 1.0;
                this.ready = true;
                return this.value;
            }

            let len = 0;
            const dx = 1 / n;
            for (let i = 0; i < n; i++) {
                const dy = (data[i + 1] - data[i]) / range;
                len += Math.sqrt(dy * dy + dx * dx);
            }

            if (len > 0) {
                this.value = 1 + (Math.log(len) + Math.log(2)) / Math.log(2 * n);
            } else {
                this.value = 1.0;
            }
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 1.5;
        this.prev = 1.5;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = FractalDimensionIndex;
