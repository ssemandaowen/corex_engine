"use strict";

const reference = require("../helpers/reference/StandardDeviation");

describe("StandardDeviation reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: StandardDeviation(5), population divisor", () => {
        // Calculation (period = 5; window = [12, 11, 10, 9, 11]):
        //   mean = 53 / 5 = 10.6
        //   sumSq = (12-10.6)^2 + (11-10.6)^2 + (10-10.6)^2 + (9-10.6)^2 + (11-10.6)^2
        //         = 1.4^2 + 0.4^2 + (-0.6)^2 + (-1.6)^2 + 0.4^2
        //         = 1.96 + 0.16 + 0.36 + 2.56 + 0.16 = 5.2
        //   variance = 5.2 / 5 = 1.04
        //   stddev = sqrt(1.04) = 1.0198039027185568
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(Math.sqrt(1.04), 10);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: stddev is 0", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("technicalindicators cross-check (SD / population stddev)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.SD({ period: 5, values: closes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 5).value, 10);
    });
});
