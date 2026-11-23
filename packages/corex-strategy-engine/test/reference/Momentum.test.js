"use strict";

const reference = require("../helpers/reference/Momentum");

describe("Momentum reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: Momentum(4)", () => {
        // Calculation (period = 4):
        //   Momentum = price[9] - price[9 - (4-1)] = price[9] - price[6]
        //            = 11 - 11 = 0
        const result = reference(closes, 4);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 4);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: Momentum is 0", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
