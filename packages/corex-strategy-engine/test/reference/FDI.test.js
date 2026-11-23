"use strict";
const reference = require("../helpers/reference/FDI");
describe("FDI reference — Sevcik waveform estimator", () => {
    const close = [10, 11, 12, 11, 13, 14, 13, 15];
    test("hand calculation: Sevcik FDI(5)", () => {
        // Last window [11,13,14,13,15], min=11, max=15, range=4.
        // Unit-square y=[0,.5,.75,.5,1], x-step=.25.
        // Segment lengths: sqrt(.25²+.5²), sqrt(.25²+.25²),
        // sqrt(.25²+.25²), sqrt(.25²+.5²); total L≈1.8251407699.
        // FDI=1+(ln(L)+ln(2))/ln(2*(5-1))=1.622669246948619.
        expect(reference(close, 5).value).toBeCloseTo(1.622669246948619, 10);
    });
    test("flat window is finite and values stay in [1,2]", () => {
        const flat = reference([5,5,5,5,5,5], 5);
        expect(Number.isFinite(flat.value)).toBe(true);
        expect(flat.value).toBeGreaterThanOrEqual(1);
        expect(flat.value).toBeLessThanOrEqual(2);
    });
    test("insufficient window is not ready", () => {
        expect(reference([1,2,3,4], 5).ready).toBe(false);
    });
});
