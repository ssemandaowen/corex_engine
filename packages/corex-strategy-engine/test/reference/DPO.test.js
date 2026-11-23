"use strict";
const reference = require("../helpers/reference/DPO");
describe("DPO reference — shifted close minus current SMA", () => {
    const close = [10, 11, 12, 11, 13, 14, 13, 15];
    test("hand calculation: DPO(3)", () => {
        // shift=floor(3/2)+1=2. Last SMA=(14+13+15)/3=14.
        // Shifted close is close[7-2]=close[5]=14, hence DPO=14-14=0.
        expect(reference(close, 3).value).toBe(0);
    });
    test("not ready until the shifted source and SMA both exist", () => {
        expect(reference([10,11], 3).ready).toBe(false);
    });
});
