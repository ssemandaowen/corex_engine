"use strict";
const reference = require("../helpers/reference/McGinley");
describe("McGinley Dynamic reference — McGinley formula", () => {
    const close = [10, 11, 12, 11, 13, 14];
    test("hand calculation: period=3, k=.6", () => {
        // Seed MD=(10+11+12)/3=11.
        // At 11, MD remains 11. At 13:
        // MD=11+(13-11)/(.6*3*(13/11)^4)=11.569580118965645.
        // At 14:
        // MD=11.569580118965645+(14-11.569580118965645)/
        //   (.6*3*(14/11.569580118965645)^4)=12.199328490161605.
        expect(reference(close, 3, 0.6).value).toBeCloseTo(12.199328490161605, 10);
    });
    test("requires a complete seed window", () => {
        expect(reference([10, 11], 3).ready).toBe(false);
    });
    test("zero seed is rejected because price/MD is undefined", () => {
        expect(() => reference([0, 0, 0, 1], 3).value).toThrow();
    });
});
