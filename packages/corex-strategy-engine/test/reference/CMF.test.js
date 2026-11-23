"use strict";

const reference = require("../helpers/reference/CMF");

describe("CMF reference (independent, published definition — Chaikin)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: CMF(5) over last 5 bars (indices 5..9)", () => {
        // Convention: mfm = ((close-low)-(high-close))/(high-low); mfv = mfm*volume;
        //   CMF = sum(mfv)/sum(volume). In this data each close is exactly the midpoint of high/low,
        //   so (close-low) === (high-close) -> mfm = 0 for every bar.
        //   Bar 5: h=9,l=7,c=8 -> (8-7)-(9-8)=1-1=0 -> mfm=0
        //   Bar 6: h=11,l=9,c=10 -> (10-9)-(11-10)=0 -> mfm=0
        //   Bar 7: h=12,l=10,c=11 -> mfm=0
        //   Bar 8: h=13,l=11,c=12 -> mfm=0
        //   Bar 9: h=14,l=12,c=13 -> mfm=0
        //   sumMFV = 0; CMF = 0 / sum(volume) = 0
        const result = reference(highs, lows, closes, volumes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("insufficient warmup: not ready before period bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], [1000, 1000], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero total volume: CMF = 0", () => {
        const h = [10, 11]; const l = [8, 9]; const c = [9, 10]; const v = [0, 0];
        const result = reference(h, l, c, v, 2);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
