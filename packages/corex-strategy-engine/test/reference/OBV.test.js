"use strict";

const reference = require("../helpers/reference/OBV");

describe("OBV reference (independent, published definition — Granville)", () => {
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];
    const volumes = [1000, 1200, 1100, 900, 800, 700, 900, 1000, 1100, 1200];

    test("hand-computed worked example: OBV over all 10 bars", () => {
        // Convention: first close establishes the baseline at OBV=0.
        //   idx0: seed close=12, OBV=0
        //   idx1: 13>12 -> +1200 = 1200
        //   idx2: 11<13 -> -1100 = 100
        //   idx3: 10<11 -> -900 = -800
        //   idx4: 9<10 -> -800 = -1600
        //   idx5: 8<9 -> -700 = -2300
        //   idx6: 10>8 -> +900 = -1400
        //   idx7: 11>10 -> +1000 = -400
        //   idx8: 12>11 -> +1100 = 700
        //   idx9: 13>12 -> +1200 = 1900
        const result = reference(closes, volumes);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(1900);
    });

    test("ready after the first bar with a zero baseline", () => {
        const result = reference([12], [1000]);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("flat close: OBV unchanged", () => {
        const result = reference([10, 10, 10], [100, 200, 300]);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(0);
    });

    test("non-positive volume contributes zero", () => {
        const result = reference([10, 11, 12], [100, -200, 0]);
        expect(result.value).toBe(0);
    });

    test("technicalindicators cross-check (OBV)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.OBV({ close: closes, volume: volumes }).getResult();
        expect(tiResult[tiResult.length - 1]).toBe(reference(closes, volumes).value);
    });
});
