"use strict";

const reference = require("../helpers/reference/Stochastic");

describe("Stochastic reference (independent, published definition — Lane, fast)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: Stochastic(k=5, d=3) at last bar", () => {
        // Calculation (period k=5; window indices 5..9):
        //   highestHigh = 14; lowestLow = 7; close[9] = 13
        //   range = 14 - 7 = 7
        //   %K = (13 - 7) / 7 * 100 = 6/7 * 100 = 85.71428571428571
        //   %D = SMA(%K, 3) over the last 3 %K values (path-dependent) = 83.01587301587301
        const result = reference(highs, lows, closes, 5, 3);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(85.71428571428571, 10);
        expect(result.k).toBeCloseTo(85.71428571428571, 10);
        expect(result.d).toBeCloseTo(83.01587301587301, 10);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("insufficient warmup: not ready before kPeriod bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5, 3);
        expect(result.ready).toBe(false);
    });

    test("zero range: %K = 50", () => {
        const h = [10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10];
        const result = reference(h, l, c, 5, 3);
        expect(result.ready).toBe(true);
        expect(result.k).toBe(50);
        expect(result.value).toBe(50);
    });

    test("technicalindicators cross-check (Stochastic)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.Stochastic({ period: 5, high: highs, low: lows, close: closes, signalPeriod: 3 }).getResult();
        // Note: technicalindicators %K/%D conventions (smoothing) may differ; do not force equality.
        expect(tiResult[tiResult.length - 1].k).toBeCloseTo(reference(highs, lows, closes, 5, 3).k, 2);
    });
});
