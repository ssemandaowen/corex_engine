"use strict";

const reference = require("../helpers/reference/SuperSmoother");

describe("SuperSmoother reference (independent, published definition — Ehlers)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: SuperSmoother(alpha=0.2)", () => {
        // Convention: a = exp(-sqrt(0.2)) = exp(-0.4472135955) = 0.639282...
        //   b = 2a = 1.278564...;  c = (1-a)^2/(1 + b*cos(PI/2) + a^2) = (1-a)^2/(1+a^2)
        //   d = b*a = 2a^2 = 0.817038...;  e = -a^2 = -0.408519...
        //   first price seeds state: value = 10, ready = true
        //   subsequent recursion: y = c*(price + x2) + d*x1 - e*y1 + e*y2
        //   final value after processing all 10 prices = 8.778996630911513
        const result = reference(closes, 0.2);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(8.778996630911513, 10);
        expect(result.alpha).toBe(0.2);
    });

    test("alpha out of range throws", () => {
        expect(() => reference(closes, 0)).toThrow();
        expect(() => reference(closes, 1.5)).toThrow();
    });

    test("first price seeds state and is ready immediately", () => {
        const result = reference([42], 0.2);
        expect(result.ready).toBe(true);
        expect(result.value).toBe(42);
    });
});
