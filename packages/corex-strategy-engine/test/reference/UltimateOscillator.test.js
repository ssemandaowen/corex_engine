"use strict";

const reference = require("../helpers/reference/UltimateOscillator");

describe("UltimateOscillator reference (independent, published definition — Williams)", () => {
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-computed worked example: UltimateOscillator(3, 4, 5)", () => {
        // BP=close-min(low,prevClose); TR=max(high,prevClose)-min(low,prevClose).
        // At last bar (index 9):
        //   period 3 (transitions 7..9): sumBP=3, sumTR=6, avg=3/6=1/2.
        //   period 4 (transitions 6..9): sumBP=5, sumTR=9, avg=5/9.
        //   period 5 (transitions 5..9): sumBP=6, sumTR=11, avg=6/11.
        //   UO=100*(4*(1/2)+2*(5/9)+(6/11))/7 = 52.23665223665223.
        const result = reference(highs, lows, closes, 3, 4, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(100 * (4 * (1 / 2) + 2 * (5 / 9) + (6 / 11)) / 7, 10);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("first bar is neutral 50 and warmup needs period3+1 bars", () => {
        const result = reference([13, 14, 12, 11, 10], [11, 12, 10, 9, 8], [12, 13, 11, 10, 9], 3, 4, 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBe(50);
    });

    test("zero TR: neutral average yields 50", () => {
        const h = [10, 10, 10, 10, 10, 10];
        const l = [10, 10, 10, 10, 10, 10];
        const c = [10, 10, 10, 10, 10, 10];
        const result = reference(h, l, c, 3, 4, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(50);
    });
});
