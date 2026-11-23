"use strict";

const reference = require("../helpers/reference/CMO");

describe("CMO reference (independent, published definition — Chande)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: CMO(5)", () => {
        // Calculation (period = 5; last 5 changes, indices 5..9):
        //   changes = [12-14=-2, 11-12=-1, 10-11=-1, 9-10=-1, 11-9=+2]
        //   sumHigh = 2 (only +2); sumLow = |-2|+|-1|+|-1|+|-1| = 5
        //   CMO = 100 * (2 - 5) / (2 + 5) = 100 * (-3) / 7 = -42.857142857142854
        //   Wait — driver printed 66.6666 for window ending at index 9; let me recompute the
        //   actual window used: changes over j in [i-period+1, i] = [5..9] using prices[j]-prices[j-1]:
        //     j=5: 12-14 = -2; j=6: 11-12=-1; j=7: 10-11=-1; j=8: 9-10=-1; j=9: 11-9=+2
        //   sumHigh=2, sumLow=5 -> CMO = 100*(-3)/7 = -42.8571...
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(100 * (2 - 5) / 7, 10);
        expect(result.value).toBeGreaterThanOrEqual(-100);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("insufficient warmup: not ready before period+1 prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("no change: sum=0 => CMO = 0", () => {
        const result = reference([7, 7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
