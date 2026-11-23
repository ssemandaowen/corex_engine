"use strict";
const reference = require("../helpers/reference/InstantTrend");
describe("InstantTrend reference — Ehlers recursive ITrend", () => {
    const close = [10, 11, 12, 11, 13, 14];
    test("hand calculation: alpha=0.5", () => {
        // Seed I0=10, I1=11. For alpha=.5 the coefficients are
        // .4375*P[t] + .125*P[t-1] - .3125*P[t-2] + I[t-1] - .25*I[t-2].
        // I2 = .4375*12 + .125*11 - .3125*10 + 11 - .25*10 = 12.
        // I3 = .4375*11 + .125*12 - .3125*11 + 12 - .25*11 = 12.125.
        // I4 = .4375*13 + .125*11 - .3125*12 + 12.125 - .25*12 = 12.4375.
        // I5 = .4375*14 + .125*13 - .3125*11 + 12.4375 - .25*12.125 = 13.71875.
        expect(reference(close, 0.5).value).toBeCloseTo(13.71875, 12);
    });
    test("not ready before three prices and rejects invalid alpha", () => {
        expect(reference([10, 11], 0.5).ready).toBe(false);
        expect(() => reference(close, 0)).toThrow();
    });
});
