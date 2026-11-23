"use strict";

/**
 * SlidingWindow — fixed-capacity ring of Float64Array(2*cap).
 *
 * Linear write into a 2*cap buffer. When the write pointer reaches 2*cap,
 * the newest cap values are copyWithin'd to the start (O(cap), amortised O(1)
 * per push over cap pushes). A sliding start/end pointer drops values older
 * than the cap window without moving memory.
 *
 * API:
 *   push(x)      — append a value
 *   length       — number of valid values (min(count, cap))
 *   at(i)        — value at logical index i (0 = oldest, length-1 = newest)
 *   view(n)      — zero-copy Float64Array subarray of the latest n values; valid only until the next push
 *
 * A view aliases the window's backing buffer. The next push may compact that
 * buffer with copyWithin(), so callers must consume or copy a view before
 * pushing another value. Do not retain a view across pushes.
 */
class SlidingWindow {
    constructor(cap) {
        if (!Number.isFinite(cap) || cap <= 0) {
            throw new Error("SlidingWindow: cap must be a positive finite number");
        }
        this.cap = cap;
        this.buf = new Float64Array(2 * cap);
        this.start = 0; // index of oldest valid value
        this.end = 0;   // index where the next value is written
        this.count = 0; // total pushes ever
    }

    push(x) {
        const v = Number(x);
        this.buf[this.end] = v;
        this.end += 1;
        this.count += 1;

        // Slide the window: drop the oldest value when over capacity.
        if (this.end - this.start > this.cap) {
            this.start += 1;
        }

        // Compact when the buffer is full: copy the newest cap values to the start.
        if (this.end === 2 * this.cap) {
            const len = this.end - this.start;
            this.buf.copyWithin(0, this.start, this.end);
            this.start = 0;
            this.end = len;
        }
    }

    get length() {
        return this.end - this.start;
    }

    at(i) {
        if (i < 0 || i >= this.length) return undefined;
        return this.buf[this.start + i];
    }

    view(n) {
        const count = Math.min(n, this.length);
        if (count <= 0) return this.buf.subarray(0, 0);
        // Latest `count` values end at `this.end` (exclusive).
        return this.buf.subarray(this.end - count, this.end);
    }

    toArray() {
        return Array.prototype.slice.call(this.view(this.length));
    }
}

module.exports = SlidingWindow;
