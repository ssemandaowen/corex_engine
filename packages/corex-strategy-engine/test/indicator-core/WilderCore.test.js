"use strict";
const WilderCore = require("../../src/indicators/core/WilderCore");

describe("WilderCore", () => {
    test("SMA-seeds and then applies Wilder's 1/N recurrence", () => {
        const core = new WilderCore(3);
        expect(Number.isNaN(core.update(2))).toBe(true);
        expect(Number.isNaN(core.update(3))).toBe(true);
        expect(core.update(4)).toBe(3);
        expect(core.update(6)).toBe(4);
        expect(core.ready).toBe(true);
    });

    test("reseed and reset restore the seed state", () => {
        const core = new WilderCore(2);
        expect(core.reseed([2, 4, 6])).toBe(4.5);
        core.reset();
        expect(core.ready).toBe(false);
        expect(Number.isNaN(core.value)).toBe(true);
        expect(core.count).toBe(0);
    });

    test("rejects invalid periods but safely ignores non-finite market input", () => {
        expect(() => new WilderCore(-1)).toThrow();
        const core = new WilderCore(2);
        expect(Number.isNaN(core.update(Infinity))).toBe(true);
        expect(core.count).toBe(0);
    });
});