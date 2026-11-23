"use strict";
const reference = require("../helpers/reference/RVI");
describe("RVI reference — classic Relative Vigor Index", () => {
    const open  = [12,13,12,13,13,14,15,15];
    const high  = [13,14,13,15,14,16,17,16];
    const low   = [11,12,10,12,11,13,14,13];
    const close = [12,13,11,14,12,15,16,14];
    test("hand calculation: four-bar weighted RVI", () => {
        // Last four candle bodies [−1,+1,+1,−1], ranges [3,3,3,3].
        // With weights [1,2,2,1], weighted body = −1+2+2−1=2;
        // weighted range = 3+6+6+3=18; RVI=2/18=1/9.
        expect(reference(open, high, low, close, 4).value).toBeCloseTo(1/9, 12);
        // Weighted signal from the last four RVI values is 0.0457516339869281.
        expect(reference(open, high, low, close, 4).signal.at(-1)).toBeCloseTo(0.0457516339869281, 10);
    });
    test("flat candles yield neutral zero and warmup is explicit", () => {
        const flat = reference([5,5,5,5,5,5], [5,5,5,5,5,5], [5,5,5,5,5,5], [5,5,5,5,5,5], 4);
        expect(flat.value).toBe(0);
        expect(reference([1,2,3], [2,3,4], [0,1,2], [1,2,3], 4).ready).toBe(false);
    });
});
