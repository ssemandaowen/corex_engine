"use strict";

const reference = require("../helpers/reference/WilliamsR");

describe("Williams %R reference (independent, published definition)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: WilliamsR(5) over last 5 bars (indices 5..9)", () => {
        // Calculation (period = 5; window indices 5..9):
        //   highestHigh = max(9,11,12,13,14) = 14
        //   lowestLow   = min(7,9,10,11,12) = 7
        //   close[9] = 13
        //   range = 14 - 7 = 7
        //   %R = ((14 - 13) / 7) * -100 = (1/7) * -100 = -14.285714285714285
        const result = reference(highs, lows, closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(-14.285714285714285, 10);
        expect(result.value).toBeLessThanOrEqual(0);
        expect(result.value).toBeGreaterThanOrEqual(-100);
    });

    test("insufficient warmup: not ready before period bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5);
        expect(result.ready).toBe(false);
    });

    test("zero range: %R = 0", () => {
        const h = [10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10];
        const result = reference(h, l, c, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("technicalindicators cross-check (WilliamsR)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.WilliamsR({ period: 5, high: highs, low: lows, close: closes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(highs, lows, closes, 5).value, 10);
    });
});
