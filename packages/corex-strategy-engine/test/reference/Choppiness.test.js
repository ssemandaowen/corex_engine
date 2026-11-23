"use strict";

const reference = require("../helpers/reference/Choppiness");

describe("Choppiness reference (independent, published definition — Dreiss)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: Choppiness(5) over bars 5..9", () => {
        // TR uses the previous close; window bars 5..9:
        //   bar5: max(2, |9-9|=0, |7-9|=2) = 2
        //   bar6: max(2, |11-8|=3, |9-8|=1) = 3
        //   bar7: max(2, |12-10|=2, |10-10|=0) = 2
        //   bar8: max(2, |13-11|=2, |11-11|=0) = 2
        //   bar9: max(2, |14-12|=2, |12-12|=0) = 2
        //   sumTR = 2+3+2+2+2 = 11; range = 14-7 = 7
        //   CI = 100*ln(11/7)/ln(5) = positive Choppiness Index.
        const result = reference(highs, lows, closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(100 * Math.log(11 / 7) / Math.log(5), 10);
    });

    test("insufficient warmup: not ready before period bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero range or zero sumTR: CI = 0", () => {
        const h = [10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10];
        const result = reference(h, l, c, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
