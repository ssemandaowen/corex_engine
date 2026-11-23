"use strict";

const reference = require("../helpers/reference/SuperTrend");

describe("SuperTrend reference (independent, published definition — ATR based)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: SuperTrend(period=5, multiplier=2)", () => {
        // ATR(5) at bar5 = 2.2; HL2=(9+7)/2=8; first lower band=8-2*2.2=3.6.
        // At bar6: ATR=2.36, HL2=10, lower=5.28; it rises above prior lower 3.6.
        // At bar7: ATR=2.288, HL2=11, lower=6.424.
        // At bar8: ATR=2.2304, HL2=12, lower=7.5392.
        // At bar9: ATR=2.18432, HL2=13, lower=8.63136.
        // Closes remain above each active lower band, so direction stays bullish.
        // Final SuperTrend = finalLower = 8.63136 (not the uninitialized zero band).
        const result = reference(highs, lows, closes, 5, 2);
        expect(result.ready).toBe(true);
        expect(result.series[5]).toBeCloseTo(3.6, 10);
        expect(result.value).toBeCloseTo(8.63136, 10);
        expect(result.period).toBe(5);
        expect(result.multiplier).toBe(2);
    });

    test("not ready before ATR warmup", () => {
        const result = reference([13], [11], [12], 5, 2);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });
});
