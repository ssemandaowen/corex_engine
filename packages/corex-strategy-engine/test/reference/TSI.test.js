"use strict";

const reference = require("../helpers/reference/TSI");

describe("TSI reference (independent, published definition — Blau)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: TSI(short=3, long=5)", () => {
        // Price changes: [2,-1,2,1,-2,-1,-1,-1,2].
        // Absolute changes: [2,1,2,1,2,1,1,1,2].
        // EMA(5) seeds each stream with its first value, then alpha=2/(5+1)=1/3.
        // EMA(3) then smooths each EMA(5) stream with alpha=2/(3+1)=1/2.
        // Final double-smoothed change = -0.081566 (rounded);
        // final double-smoothed absolute change = 1.391950 (rounded).
        // TSI = 100 * (-0.081566 / 1.391950) = -5.8599 (rounded).
        const result = reference(closes, 3, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(-5.859899800722086, 10);
    });

    test("constant prices: all changes are zero, TSI = 0", () => {
        const result = reference([7, 7, 7, 7, 7, 7], 3, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("first observed price change defines the first-value-seeded output", () => {
        const result = reference([10, 12], 3, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(100);
    });
});
