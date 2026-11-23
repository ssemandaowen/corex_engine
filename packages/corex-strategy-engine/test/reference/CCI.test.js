"use strict";

const reference = require("../helpers/reference/CCI");

describe("CCI reference (independent, published definition — Lambert)", () => {
const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);

    test("hand-computed worked example: CCI(5)", () => {
        // Calculation (period = 5; typical price window indices 5..9 = [8,10,11,12,13]):
        //   typicalPrice = (high+low+close)/3: [8, 10, 11, 12, 13]
        //   SMA = 54/5 = 10.8
        //   meanDev = (|8-10.8|+|10-10.8|+|11-10.8|+|12-10.8|+|13-10.8|)/5
        //           = (2.8+0.8+0.2+1.2+2.2)/5 = 7.2/5 = 1.44
        //   CCI = (typicalPrice[9] - SMA) / (0.015 * meanDev)
        //       = (13 - 10.8) / (0.015 * 1.44) = 2.2 / 0.0216 = 101.85185185185183
        const result = reference(typicalPrices, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(2.2 / (0.015 * 1.44), 10);
    });

    test("insufficient warmup: not ready before period typical prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("zero mean deviation (constant prices): CCI = 0", () => {
        const result = reference([7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("technicalindicators cross-check (CCI)", () => {
        const ti = require("technicalindicators");
        // technicalindicators CCI takes high/low/close and derives typical price internally;
        // its CCI convention may differ from the independent reference; do not force equality.
        const tiResult = new ti.CCI({ period: 5, high: highs, low: lows, close: closes }).getResult();
        const ref = reference(closes.map((c, i) => (highs[i] + lows[i] + c) / 3), 5);
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(ref.value, 2);
    });
});
