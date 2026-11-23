"use strict";

const reference = require("../helpers/reference/KeltnerChannels");

describe("KeltnerChannels reference (independent, published definition — SMA + ATR)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: KeltnerChannels(5, 2)", () => {
        // Convention: middle = SMA(close, 5); upper = middle + 2*ATR; lower = middle - 2*ATR.
        //   SMA(close,5) over last 5 closes [8,10,11,12,13] (indices 5..9) = 54/5 = 10.8
        //   ATR(5) final value for this input = 2.18432 (see ATR worked example)
        //   upper = 10.8 + 2*2.18432 = 15.16864
        //   lower = 10.8 - 2*2.18432 = 6.43136
        const result = reference(highs, lows, closes, 5, 2);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(10.8, 10);
        expect(result.upper).toBeCloseTo(10.8 + 2 * 2.18432, 10);
        expect(result.lower).toBeCloseTo(10.8 - 2 * 2.18432, 10);
        expect(result.upper).toBeGreaterThan(result.value);
        expect(result.value).toBeGreaterThan(result.lower);
    });

    test("upper > middle > lower when ATR > 0", () => {
        const result = reference(highs, lows, closes, 5, 2);
        expect(result.upper).toBeGreaterThan(result.value);
        expect(result.value).toBeGreaterThan(result.lower);
    });

    test("insufficient warmup: not ready before ATR + SMA ready", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5, 2);
        expect(result.ready).toBe(false);
    });
});
