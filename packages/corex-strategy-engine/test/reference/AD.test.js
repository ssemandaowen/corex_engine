"use strict";

const reference = require("../helpers/reference/AD");

describe("AD reference (independent, published definition — Chaikin Accumulation/Distribution)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: AD over all 10 bars", () => {
        // Convention: mfm = ((close-low)-(high-close))/(high-low); mfv = mfm*volume; AD = cumulative sum.
        //   In this data every close is the midpoint of high/low, so mfm = 0 for every bar.
        //   AD = cumulative sum of 0 = 0.
        const result = reference(highs, lows, closes, volumes);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("ready after the first bar", () => {
        const result = reference([13], [11], [12], [1000]);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("non-midpoint close accumulates", () => {
        // h=10,l=8,c=9 -> midpoint -> mfm=0; h=12,l=8,c=11 -> ((11-8)-(12-11))/(12-8)=(3-1)/4=0.5
        const h = [10, 12];
        const l = [8, 8];
        const c = [9, 11];
        const v = [100, 100];
        const result = reference(h, l, c, v);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(0.5 * 100, 10);
    });
});
