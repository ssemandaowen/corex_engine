"use strict";

const reference = require("../helpers/reference/HMA");

describe("HMA reference (independent, published definition)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: HMA(5)", () => {
        // Convention: halfPeriod = floor(5/2) = 2; sqrtPeriod = floor(sqrt(5)) = 2.
        //   diff = 2 * WMA(2) - WMA(5);  HMA = WMA(2, diff)  (weights oldest=1, newest=2)
        //   At index 9 (final bar):
        //     WMA(5) over [12,11,10,9,11] = (12+22+30+36+55)/15 = 155/15 = 10.3333
        //     WMA(2) over [9,11]           = (9*1 + 11*2)/3   = 31/3   = 10.3333
        //     diff9 = 2*(31/3) - 155/15 = 62/3 - 155/15 = (310-155)/15 = 155/15 = 10.3333
        //     WMA(5) over [14,12,11,10,9] = (14+24+33+40+45)/15 = 156/15 = 10.4
        //     WMA(2) over [10,9]           = (10*1 + 9*2)/3   = 28/3   = 9.3333
        //     diff8 = 2*(28/3) - 156/15 = 56/3 - 156/15 = (280-156)/15 = 124/15 = 8.2667
        //     HMA = WMA(2, [diff8, diff9]) = (124/15*1 + 155/15*2)/3 = (124+310)/15/3 = 434/45
        //     434/45 = 9.644444444444446
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(434 / 45, 10);
        expect(result.half).toBe(2);
        expect(result.sqrtP).toBe(2);
    });

    test("insufficient warmup: not ready until diff window fills", () => {
        const result = reference([10, 12, 11, 13, 14], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: HMA equals the constant", () => {
        const result = reference([7, 7, 7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(7);
    });
});
