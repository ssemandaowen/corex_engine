"use strict";

const reference = require("../helpers/reference/SMA");

describe("SMA reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: SMA(5) over last 5 prices", () => {
        // Calculation (period = 5):
        //   window = [12, 11, 10, 9, 11]   (indices 5..9)
        //   sum    = 12 + 11 + 10 + 9 + 11 = 53
        //   SMA    = 53 / 5 = 10.6
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(10.6);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
        expect(result.series).toEqual([null, null, null]);
    });

    test("constant prices: SMA equals the constant", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
    });

    test("technicalindicators cross-check (SMA)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.SMA({ period: 5, values: closes }).getResult();
        // technicalindicators returns SMA values starting at the period-th bar;
        // its last value must equal our independent reference.
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 5).value, 10);
    });
});
