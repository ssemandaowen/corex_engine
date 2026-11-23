"use strict";
const reference = require("../helpers/reference/ALMA");
describe("ALMA reference — Gaussian weighted moving average", () => {
    const close = [10, 11, 12, 11, 13, 14];
    test("hand calculation: period=4, offset=.85, sigma=6", () => {
        // m=.85*(4-1)=2.55 and s=4/6=2/3.
        // Normalized weights oldest→newest are approximately
        // [.0004222608,.0425367270,.4516320805,.5054089317].
        // Last window [12,11,13,14] gives
        // 12*w0 + 11*w1 + 13*w2 + 14*w3 = 13.419913216874534.
        expect(reference(close, 4, 0.85, 6).value).toBeCloseTo(13.419913216874534, 10);
    });
    test("not ready until one complete window", () => {
        expect(reference([10, 11, 12], 4, 0.85, 6).ready).toBe(false);
    });
});
