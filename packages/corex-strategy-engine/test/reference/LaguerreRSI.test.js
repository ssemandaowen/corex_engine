"use strict";

const reference = require("../helpers/reference/LaguerreRSI");

describe("LaguerreRSI reference (independent, published definition — Ehlers)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: LaguerreRSI(gamma=0.5)", () => {
        // Seed L0=L1=L2=L3=10. On the second price (12):
        //   L0=0.5*12+0.5*10=11
        //   L1=-0.5*11+10+0.5*10=9.5
        //   L2=-0.5*9.5+10+0.5*10=10.25
        //   L3=-0.5*10.25+10+0.5*10=9.875
        //   CU=max(1.5,0,0.375)=1.875; CD=max(0,0.75,0)=0.75
        //   RSI=100*1.875/(1.875+0.75)=71.4285714.
        // Continuing the same four-stage recursion through all ten closes gives 46.05388272583201.
        const result = reference(closes, 0.5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(46.05388272583201, 10);
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
    });

    test("first price seeds the four stages; output becomes ready on second price", () => {
        const r1 = reference([10], 0.5);
        expect(r1.ready).toBe(false);
        expect(r1.value).toBeNull();
        const r2 = reference([10, 12], 0.5);
        expect(r2.ready).toBe(true);
    });

    test("gamma out of range throws", () => {
        expect(() => reference(closes, -0.1)).toThrow();
        expect(() => reference(closes, 1.1)).toThrow();
    });
});
