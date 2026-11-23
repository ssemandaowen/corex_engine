"use strict";

const reference = require("../helpers/reference/LinearRegression");

describe("LinearRegression reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: LinearRegression(5) fitted value at last point", () => {
        // Calculation (period = 5; window = [12,11,10,9,11]; x = 1..5):
        //   sumX = 15,  sumY = 53,  sumXY = 1*12+2*11+3*10+4*9+5*11 = 155,  sumXX = 55
        //   denominator = 5*55 - 15*15 = 275 - 225 = 50
        //   slope  = (5*155 - 15*53) / 50 = (775 - 795) / 50 = -0.4
        //   intercept = (sumY - slope*sumX) / 5 = (53 - (-0.4)*15) / 5 = 59/5 = 11.8
        //   value (fitted at x=5) = intercept + slope*5 = 11.8 + (-0.4)*5 = 9.8
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(9.8);
        expect(result.slope).toBe(-0.4);
        expect(result.intercept).toBe(11.8);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: denominator ~0, value = last price", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
        expect(result.slope).toBe(0);
    });
});
