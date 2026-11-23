"use strict";

const reference = require("../helpers/reference/Ichimoku");

describe("Ichimoku reference (independent, published definition — Hosoda)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: Ichimoku(conversion=3, base=4, lagging=5, displacement=3)", () => {
        // Last bar index 9:
        //   Tenkan over bars 7..9: (maxHigh 14 + minLow 10)/2 = 12.
        //   Kijun over bars 6..9: (maxHigh 14 + minLow 9)/2 = 11.5.
        //   Senkou A = (12+11.5)/2 = 11.75.
        //   Senkou B over bars 5..9: (maxHigh 14 + minLow 7)/2 = 10.5.
        //   Cloud upper/lower = 11.75 / 10.5.
        //   Chikou at index 9 with displacement 3 = close at index 6 = 10.
        const result = reference(highs, lows, closes, 3, 4, 5, 3);
        expect(result.ready).toBe(true);
        expect(result.tenkan).toBe(12);
        expect(result.kijun).toBe(11.5);
        expect(result.senkouA).toBe(11.75);
        expect(result.senkouB).toBe(10.5);
        expect(result.cloudUpper).toBe(11.75);
        expect(result.cloudLower).toBe(10.5);
        expect(result.chikou).toBe(10);
    });

    test("not ready until all three lookback periods have enough bars", () => {
        const result = reference([13, 14, 12, 11], [11, 12, 10, 9], [12, 13, 11, 10], 3, 4, 5, 3);
        expect(result.ready).toBe(false);
    });

    test("cloud upper/lower are ordered", () => {
        const result = reference(highs, lows, closes, 3, 4, 5, 3);
        expect(result.cloudUpper).toBeGreaterThanOrEqual(result.cloudLower);
    });
});
