"use strict";

const reference = require("../helpers/reference/VWAP");

describe("VWAP reference (independent, published definition)", () => {
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: VWAP over all 10 bars", () => {
        // VWAP = sum(price*volume) / sum(volume).
        //   sum(price*volume) = 12000+15600+12100+9000+7200+5600+9000+11000+13200+15600
        //                     = 110300
        //   sum(volume) = 1000+1200+1100+900+800+700+900+1000+1100+1200 = 9900
        //   VWAP = 110300/9900 = 11.141414141414142
        const result = reference(closes, volumes);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(110300 / 9900, 10);
    });

    test("zero and negative volume are ignored", () => {
        const result = reference([10, 12, 14], [0, -50, 100]);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(14);
    });

    test("no positive volume: not ready and undefined", () => {
        const result = reference([10, 12], [0, -10]);
        expect(result.ready).toBe(false);
        expect(result.value).toBeNull();
    });

    test("technicalindicators cross-check (VWAP)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.VWAP({ high: closes, low: closes, close: closes, volume: volumes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBeCloseTo(reference(closes, volumes).value, 10);
    });
});
