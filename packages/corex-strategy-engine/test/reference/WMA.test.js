"use strict";

const reference = require("../helpers/reference/WMA");

describe("WMA reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: WMA(5) over last 5 prices", () => {
        // Calculation (period = 5; weights 1,2,3,4,5; weightSum = 15):
        //   window = [12, 11, 10, 9, 11]   (indices 5..9, oldest to newest)
        //   sum    = 12*1 + 11*2 + 10*3 + 9*4 + 11*5 = 12 + 22 + 30 + 36 + 55 = 155
        //   WMA    = 155 / 15 = 10.333333333333334
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(155 / 15, 10);
        expect(result.weightSum).toBe(15);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: WMA equals the constant", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
    });

    test("technicalindicators cross-check (WMA)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.WMA({ period: 5, values: closes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 5).value, 10);
    });
});
