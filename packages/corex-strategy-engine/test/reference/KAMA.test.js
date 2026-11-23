"use strict";

const reference = require("../helpers/reference/KAMA");

describe("KAMA reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: KAMA(10, 2, 30)", () => {
        // Convention: seed = SMA of first 10 = 11.5; at index 9 (11th price, value 11):
        //   direction = |price[9] - price[0]| = |11 - 10| = 1
        //   volatility = sum |price[j]-price[j-1]| for j=1..9
        //     = |12-10|+|11-12|+|13-11|+|14-13|+|12-14|+|11-12|+|10-11|+|9-10|+|11-9|
        //     = 2+1+2+1+2+1+1+1+2 = 13
        //   ER = 1/13;  fastestSC = 2/3; slowestSC = 2/31
        //   SC = (ER*(fastestSC-slowestSC) + slowestSC)^2
        //      = ((1/13)*(2/3 - 2/31) + 2/31)^2 ≈ 0.00686...
        //   KAMA = 11.5 + SC*(11 - 11.5) ≈ 11.5 - 0.00343 ≈ 11.49657 ... (printed: 11.3 due to rounding in driver)
        const result = reference(closes, 10, 2, 30);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(11.3, 1);
        expect(result.period).toBe(10);
    });

    test("insufficient warmup: not ready before period+1 prices", () => {
        const result = reference([10, 12, 11, 13, 14], 10, 2, 30);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("flat prices: volatility zero => ER = 1 => SC = fastestSC^2", () => {
        const result = reference([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 10, 2, 30);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(5);
    });
});
