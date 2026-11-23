"use strict";

const reference = require("../helpers/reference/MFI");

describe("MFI reference (independent, published definition — Quong/Soudack)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: MFI(3) over last 3 bars (indices 7, 8, 9)", () => {
        // Convention: typicalPrice=(high+low+close)/3; moneyFlow=typicalPrice*volume;
        //   rawMoneyFlow positive if typicalPrice up, negative if down.
        //   Window bars 7,8,9: typicalPrices = [11, 12, 13] (each (h+l+c)/3)
        //     bar7: tp=11, vol=1000, tp up vs bar6(tp=10) -> +11000
        //     bar8: tp=12, vol=1100, tp up vs bar7 -> +13200
        //     bar9: tp=13, vol=1200, tp up vs bar8 -> +15600
        //   sumPos = 11000+13200+15600 = 39800; sumNeg = 0
        //   sumNeg === 0 -> MFI = 100
        const result = reference(highs, lows, closes, volumes, 3);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(100);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("insufficient warmup: not ready before period+1 bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], [1000, 1000], 3);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("all down moves: sumPos 0 => MFI = 0", () => {
        const h = [10, 9, 8, 7];
        const l = [8, 7, 6, 5];
        const c = [9, 8, 7, 6];
        const v = [100, 100, 100, 100];
        const result = reference(h, l, c, v, 3);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });
});
