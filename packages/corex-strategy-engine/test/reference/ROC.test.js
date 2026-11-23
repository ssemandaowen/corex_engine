"use strict";

const reference = require("../helpers/reference/ROC");

describe("ROC reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: ROC(4)", () => {
        // Calculation (period = 4):
        //   price[9] = 11;  price[9-4] = price[5] = 12
        //   ROC = ((11 - 12) / 12) * 100 = (-1/12) * 100 = -8.333333333333332
        const result = reference(closes, 4);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(-8.333333333333332, 10);
    });

    test("insufficient warmup: not ready before period+1 prices", () => {
        const result = reference([10, 12, 11], 4);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero reference price: ROC is null (undefined convention)", () => {
        // reference price price[i-period] === 0 -> value null
        const result = reference([0, 12, 11, 13, 14], 4);
        expect(result.ready).toBe(true);
        expect(result.value).toBeNull();
    });

    test("technicalindicators cross-check (ROC)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.ROC({ period: 4, values: closes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 4).value, 10);
    });
});
