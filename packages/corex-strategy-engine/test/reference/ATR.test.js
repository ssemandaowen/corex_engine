"use strict";

const reference = require("../helpers/reference/ATR");

describe("ATR reference (independent, published definition — Wilder)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: ATR(5)", () => {
        // True ranges (TR = max(h-l, |h-prevClose|, |l-prevClose|)):
        //   idx1: max(2, |14-12|=2, |12-12|=0) = 2
        //   idx2: max(2, |12-13|=1, |10-13|=3) = 3
        //   idx3: max(2, |11-11|=0, |9-11|=2) = 2
        //   idx4: max(2, |10-10|=0, |8-10|=2) = 2
        //   idx5: max(2, |9-9|=0, |7-9|=2)  = 2
        //   seed ATR = (2+3+2+2+2)/5 = 11/5 = 2.2   (index 5)
        //   Wilder recursion:
        //     idx6 TR=max(2,|11-8|=3,|9-8|=1)=3   -> ATR=(2.2*4+3)/5 = 2.36
        //     idx7 TR=max(1,|10-11|=1,|9-11|=2)=2  -> ATR=(2.36*4+2)/5 = 2.288
        //     idx8 TR=max(2,|12-10|=2,|10-10|=0)=2 -> ATR=(2.288*4+2)/5 = 2.2304
        //     idx9 TR=max(2,|13-12|=1,|11-12|=1)=2 -> ATR=(2.2304*4+2)/5 = 2.18432
        const result = reference(highs, lows, closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(2.18432, 6);
    });

    test("insufficient warmup: not ready before period+1 bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("constant prices: TR=0 => ATR=0", () => {
        const h = [10, 10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10, 10];
        const result = reference(h, l, c, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
