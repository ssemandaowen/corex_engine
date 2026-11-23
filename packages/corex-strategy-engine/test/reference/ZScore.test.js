"use strict";

const reference = require("../helpers/reference/ZScore");

describe("ZScore reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: ZScore(5)", () => {
        // Calculation (period = 5; window = [12,11,10,9,11]):
        //   mean = 10.6  (see SMA worked example)
        //   sumSq = 5.2  (see StandardDeviation worked example)
        //   sigma = sqrt(5.2 / 5) = sqrt(1.04) = 1.0198039027185568
        //   Z = (price[9] - mean) / sigma = (11 - 10.6) / 1.0198039027185568 = 0.3922322702763685
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(0.4 / Math.sqrt(1.04), 10);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: stddev 0 => Z = 0", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
