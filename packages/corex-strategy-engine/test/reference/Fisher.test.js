"use strict";

const reference = require("../helpers/reference/Fisher");

describe("Fisher reference (independent, published definition — Ehlers)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: Fisher(5)", () => {
        // Last five-price window [12,11,10,9,11]: high=12, low=9, close=11.
        // raw = 2*((11-9)/(12-9)-0.5) = 1/3.
        // Previous recursive state from the preceding window: x≈-0.6658,
        // Fisher≈-1.108639. Therefore x=0.33*(1/3)+0.67*(-0.6658)≈-0.3361.
        // Fisher = 0.5*ln((1+x)/(1-x)) + 0.5*previousFisher
        //        = -0.904010067049902 (rounded).
        const result = reference(closes, 5);
        expect(result.ready).toBe(true);
        expect(result.value).toBeCloseTo(-0.904010067049902, 10);
    });

    test("insufficient warmup: not ready before period prices", () => {
        const result = reference([10, 12, 11], 5);
        expect(result.ready).toBe(false);
    });

    test("constant prices: zero range keeps Fisher finite", () => {
        const result = reference([7, 7, 7, 7, 7, 7], 5);
        expect(result.ready).toBe(true);
        expect(Number.isFinite(result.value)).toBe(true);
    });
});
