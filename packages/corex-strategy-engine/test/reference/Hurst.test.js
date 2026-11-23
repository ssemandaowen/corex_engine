"use strict";

const reference = require("../helpers/reference/Hurst");

describe("Hurst reference (independent, published definition — Rescaled Range R/S estimator)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: Hurst(10) R/S estimator", () => {
        // Convention: single-window R/S over the full 10 prices.
        //   mean = 11.3  (sum = 113 / 10)
        //   deviations: [-1.3, 0.7, -0.3, 1.7, 2.7, 0.7, -0.3, -1.3, -2.3, -0.3]
        //   cumulative: [-1.3, -0.6, -0.9, 0.8, 3.5, 4.2, 3.9, 2.6, 0.3, 0.0]
        //   range = max(cum) - min(cum) = 4.2 - (-1.3) = 5.5
        //   sumSq = 1.3^2+0.7^2+0.3^2+1.7^2+2.7^2+0.7^2+0.3^2+1.3^2+2.3^2+0.3^2
        //         = 1.69+0.49+0.09+2.89+7.29+0.49+0.09+1.69+5.29+0.09 = 20.1
        //   stdDev = sqrt(20.1/10) = sqrt(2.01) = 1.417744...
        //   R/S = 5.5 / 1.417744 = 3.8794...
        //   H = log10(3.8794) / log10(10) = 0.5887646607839991
        // NOTE: this is one named R/S estimator; other estimators (multi-lag R/S, DFA, periodogram) differ.
        const result = reference(closes, 10);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(0.5887646607839991, 10);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(1);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12], 10);
        expect(result.ready).toBe(false);
    });

    test("constant prices: stdDev 0 => H = 0.5", () => {
        const result = reference([7, 7, 7, 7, 7, 7, 7, 7, 7, 7], 10);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0.5);
    });
});
