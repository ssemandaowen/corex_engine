"use strict";

const reference = require("../helpers/reference/ParabolicSAR");

describe("ParabolicSAR reference (independent, published definition — Wilder)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: ParabolicSAR(step=0.02, max=0.2)", () => {
        // First two closes rise (12 -> 13), so initialize long: SAR=low0=11, EP=high0=13.
        // bar1: SAR=11+0.02*(13-11)=11.04, clamped to low0=11; new EP=14, AF=0.04.
        // bar2: SAR=11+0.04*(14-11)=11.12, clamped to min(low1=12,low0=11)=11;
        //       low2=10 crosses SAR, so reverse short: SAR=EP=14, EP=10, AF=0.02.
        // Continuing the Wilder recurrence and two-bar clamps gives:
        //   SAR series [null,11,14,14,13.8,13.452,12.93584,12.4609728,7,7.12].
        // Final SAR = 7.12.
        const result = reference(highs, lows, closes, 0.02, 0.2);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(7.12, 10);
    });

    test("technicalindicators cross-check (PSAR; seed value is offset by one bar)", () => {
        const ti = require("technicalindicators");
        const result = ti.PSAR.calculate({ high: highs, low: lows, close: closes, step: 0.02, max: 0.2 });
        expect(result.slice(1)).toEqual(reference(highs, lows, closes, 0.02, 0.2).series.slice(1));
    });

    test("one bar cannot establish direction", () => {
        const result = reference([13], [11], [12], 0.02, 0.2);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });
});
