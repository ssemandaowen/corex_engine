"use strict";

const reference = require("../helpers/reference/BollingerBands");

describe("BollingerBands reference (independent, published definition — Bollinger)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: BollingerBands(5, 2)", () => {
        // Calculation (period = 5; window [12,11,10,9,11]):
        //   middle = SMA = 53/5 = 10.6
        //   sumSq = 5.2  (see StandardDeviation worked example); sigma = sqrt(5.2/5) = sqrt(1.04) = 1.0198039027185568
        //   upper = 10.6 + 2*1.0198039027185568 = 12.639607805437114
        //   lower = 10.6 - 2*1.0198039027185568 = 8.560392194562886
        //   value = middle = 10.6
        const result = reference(closes, 5, 2);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(10.6);
        expect(result.upper).toBeCloseTo(10.6 + 2 * Math.sqrt(1.04), 10);
        expect(result.lower).toBeCloseTo(10.6 - 2 * Math.sqrt(1.04), 10);
        expect(result.upper).toBeGreaterThan(result.value);
        expect(result.lower).toBeLessThan(result.value);
    });

    test("insufficient warmup: not ready before period closes", () => {
        const result = reference([10, 12, 11], 5, 2);
        expect(result.ready).toBe(false);
    });

    test("constant prices: sigma 0 => upper=lower=middle=constant", () => {
        const result = reference([7, 7, 7, 7, 7], 5, 2);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
        expect(result.upper).toBe(7);
        expect(result.lower).toBe(7);
    });
});
