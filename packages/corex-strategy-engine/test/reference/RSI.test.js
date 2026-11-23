"use strict";

const reference = require("../helpers/reference/RSI");

describe("RSI reference (independent, published definition — Wilder smoothing)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: RSI(5)", () => {
        // Calculation (period = 5; changes from index 1..5: [2,-1,2,1,-2]):
        //   seed avgGain = (2+0+2+1+0)/5 = 1;  seed avgLoss = (0+1+0+0+2)/5 = 0.6
        //   seed RS = 1/0.6;  seed RSI = 100 - 100/(1+RS) = 62.5   (at index 5)
        //   Wilder recursion over changes [-1,-1,-1,+2] (indices 6..9):
        //     idx6: avgGain=0.8, avgLoss=0.68   -> RSI≈54.05
        //     idx7: avgGain=0.64, avgLoss=0.744 -> RSI≈46.24
        //     idx8: avgGain=0.512, avgLoss=0.7952 -> RSI≈39.17
        //     idx9: avgGain=0.8096, avgLoss=0.63616 -> RS≈1.27264
        //     final RSI = 100 - 100/(1+1.27264) = 55.998229305002205
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(55.998229305002205, 10);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("insufficient warmup: not ready before period+1 prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("all gains: avgLoss 0 => RSI = 100", () => {
        const result = reference([10, 11, 12, 13, 14, 15], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(100);
    });

    test("all losses: avgGain 0 => RSI = 0", () => {
        const result = reference([15, 14, 13, 12, 11, 10], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("technicalindicators cross-check (RSI, Wilder)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.RSI({ period: 5, values: closes }).getResult();
        // technicalindicators RSI uses Wilder smoothing but a slightly different seed
        // precision, so values may differ in the third decimal; do not force exact equality.
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, 5).value, 2);
    });
});
