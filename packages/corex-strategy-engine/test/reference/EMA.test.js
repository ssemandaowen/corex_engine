"use strict";

const reference = require("../helpers/reference/EMA");

describe("EMA reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: EMA(5), seeded with SMA of first 5", () => {
        // Calculation (period = 5, multiplier = 2/(5+1) = 1/3):
        //   seed = SMA of [10,12,11,13,14] = (10+12+11+13+14)/5 = 60/5 = 12
        //   EMA(6) = 12*(1/3) + 12*(2/3) = 12          (price[5]=12)
        //   EMA(7) = 11*(1/3) + 12*(2/3) = 11.666...
        //   EMA(8) = 10*(1/3) + 11.666...*(2/3) = 11.111...
        //   EMA(9) =  9*(1/3) + 11.111...*(2/3) = 10.407...
        //   EMA(10)= 11*(1/3) + 10.407...*(2/3) = 10.60493827160494
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(10.60493827160494, 10);
        expect(result.multiplier).toBeCloseTo(1 / 3, 10);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: EMA equals the constant after warmup", () => {
        const result = reference([7, 7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
    });

    test("technicalindicators cross-check (EMA)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.EMA({ period: 5, values: closes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 5).value, 10);
    });
});
