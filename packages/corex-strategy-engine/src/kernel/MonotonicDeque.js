"use strict";

/**
 * MonotonicDeque — rolling max and min over a window of size w.
 *
 * Uses two Int32Array index rings (one decreasing for max, one increasing for
 * min) storing global indices into a Float64Array value ring. Amortised O(1)
 * per push; no per-call allocation.
 */
class MonotonicDeque {
    constructor(w) {
        if (!Number.isFinite(w) || w <= 0) {
            throw new Error("MonotonicDeque: w must be a positive finite number");
        }
        this.w = w;
        this.vals = new Float64Array(w);
        this.globalIndex = 0;

        // Max deque: values at stored indices are strictly decreasing.
        this.maxDq = new Int32Array(w);
        this.maxHead = 0;
        this.maxTail = 0;
        this.maxCount = 0;

        // Min deque: values at stored indices are strictly increasing.
        this.minDq = new Int32Array(w);
        this.minHead = 0;
        this.minTail = 0;
        this.minCount = 0;
    }

    push(value) {
        const v = Number(value);
        const gi = this.globalIndex++;
        const pos = gi % this.w;
        this.vals[pos] = v;

        // ---- Evict front indices outside the window FIRST (makes room in ring) ----
        const cutoff = gi - this.w + 1;
        while (this.maxCount > 0 && this.maxDq[this.maxHead] < cutoff) {
            this.maxHead = (this.maxHead + 1) % this.w;
            this.maxCount--;
        }
        while (this.minCount > 0 && this.minDq[this.minHead] < cutoff) {
            this.minHead = (this.minHead + 1) % this.w;
            this.minCount--;
        }

        // ---- Max deque (decreasing): evict back while value <= v ----
        while (this.maxCount > 0) {
            const backGi = this.maxDq[(this.maxTail - 1 + this.w) % this.w];
            if (this.vals[backGi % this.w] <= v) {
                this.maxTail = (this.maxTail - 1 + this.w) % this.w;
                this.maxCount--;
            } else {
                break;
            }
        }
        this.maxDq[this.maxTail] = gi;
        this.maxTail = (this.maxTail + 1) % this.w;
        this.maxCount++;

        // ---- Min deque (increasing): evict back while value >= v ----
        while (this.minCount > 0) {
            const backGi = this.minDq[(this.minTail - 1 + this.w) % this.w];
            if (this.vals[backGi % this.w] >= v) {
                this.minTail = (this.minTail - 1 + this.w) % this.w;
                this.minCount--;
            } else {
                break;
            }
        }
        this.minDq[this.minTail] = gi;
        this.minTail = (this.minTail + 1) % this.w;
        this.minCount++;
    }

    max() {
        if (this.maxCount === 0) return undefined;
        return this.vals[this.maxDq[this.maxHead] % this.w];
    }

    min() {
        if (this.minCount === 0) return undefined;
        return this.vals[this.minDq[this.minHead] % this.w];
    }

    get length() {
        return Math.min(this.globalIndex, this.w);
    }
}

module.exports = MonotonicDeque;
