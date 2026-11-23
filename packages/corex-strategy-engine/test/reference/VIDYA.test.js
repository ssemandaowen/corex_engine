"use strict";
const reference = require("../helpers/reference/VIDYA");
describe("VIDYA reference — Chande CMO-driven variant", () => {
    const close = [10, 11, 12, 11, 13, 14];
    test("hand calculation: VIDYA(3)", () => {
        // Seed SMA(3)=(10+11+12)/3=11; base alpha=2/(3+1)=.5.
        // At close 11, last changes [-1,+1,-1]: CMO=(1-2)/3=-1/3,
        // alpha=.5/3=1/6, so VIDYA remains 11.
        // At close 13, changes [+1,-1,+2]: CMO=(3-1)/4=.5,
        // alpha=.25, VIDYA=11+.25*(13-11)=11.5.
        // At close 14, changes [-1,+2,+1]: CMO=.5, VIDYA=11.5+.25*2=12.125.
        expect(reference(close, 3).value).toBeCloseTo(12.125, 12);
    });
    test("flat series has zero CMO and holds the seed average", () => {
        expect(reference([5, 5, 5, 5, 5, 5], 3).value).toBe(5);
    });
    test("insufficient seed window is not ready", () => {
        expect(reference([10, 11], 3).ready).toBe(false);
    });
});
