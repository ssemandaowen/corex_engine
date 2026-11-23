"use strict";
const reference = require("../helpers/reference/STC");
describe("STC reference — double stochastic of MACD", () => {
    const close = [10, 11, 12, 11, 13, 14, 13, 15];
    test("hand calculation: MACD(2,4), cycle=3, smoothing=2", () => {
        // EMA alpha fast=2/3, slow=2/5; both seed from first close.
        // Final MACD values (bars 5..7) are approximately [.7763805761,.3418228587,.6970918862].
        // First stochastic's smoothed values at bars 5..7 are
        // [92.5925925926,30.8641975309,64.7908416214].
        // Second %K at bar 7 = 100*(64.7908416214-30.8641975309)/
        // (92.5925925926-30.8641975309)=54.9611634266.
        // Second EMA alpha=2/3, previous value at bar 6=29.6296296296:
        // STC= (2/3)*54.9611634266 +(1/3)*29.6296296296 = 46.5173188276.
        expect(reference(close, 2, 4, 3, 2).value).toBeCloseTo(46.5173188276043, 9);
    });
    test("requires both stochastic passes to warm up", () => {
        expect(reference([10,11,12,11], 2, 4, 3, 2).ready).toBe(false);
    });
});
