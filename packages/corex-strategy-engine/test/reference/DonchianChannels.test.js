"use strict";

const reference = require("../helpers/reference/DonchianChannels");

describe("DonchianChannels reference (independent, published definition — Donchian)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: DonchianChannels(5) over last 5 bars (indices 5..9)", () => {
        // Calculation (period = 5; window indices 5..9):
        //   highestHigh = max(9, 11, 12, 13, 14) = 14
        //   lowestLow   = min(7, 9, 10, 11, 12) = 7
        //   upper = 14; lower = 7; value (middle) = (14 + 7) / 2 = 10.5
        const result = reference(highs, lows, closes, 5);
        expect(result.ready).toBe(true);
        expect(result.upper).toBe(14);
        expect(result.lower).toBe(7);
        expect(result.value).toBe(10.5);
    });

    test("insufficient warmup: not ready before period bars", () => {
        const result = reference([13, 14], [11, 12], [12, 13], 5);
        expect(result.ready).toBe(false);
    });

    test("constant prices: upper = lower = value = constant", () => {
        const h = [10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10];
        const result = reference(h, l, c, 5);
        expect(result.ready).toBe(true);
        expect(result.upper).toBe(10);
        expect(result.lower).toBe(10);
        expect(result.value).toBe(10);
    });
});
