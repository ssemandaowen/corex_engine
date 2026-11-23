"use strict";
const EmaCore = require("../../src/indicators/core/EmaCore");

describe("EmaCore", () => {
    test("SMA-seeds and then applies the standard EMA recurrence", () => {
        const core = new EmaCore(3);
        expect(Number.isNaN(core.update(10))).toBe(true);
        expect(Number.isNaN(core.update(11))).toBe(true);
        expect(core.update(12)).toBe(11);
        expect(core.ready).toBe(true);
        expect(core.update(13)).toBe(12);
    });

    test("reseed resets and replays values", () => {
        const core = new EmaCore(3);
        expect(core.reseed([10, 11, 12, 13])).toBe(12);
        expect(core.count).toBe(4);
        expect(Number.isNaN(core.reseed([1, 2]))).toBe(true);
        expect(core.ready).toBe(false);
    });

    test("rejects invalid periods but safely ignores non-finite market input", () => {
        expect(() => new EmaCore(0)).toThrow();
        expect(() => new EmaCore(1.5)).toThrow();
        const core = new EmaCore(2);
        expect(Number.isNaN(core.update(NaN))).toBe(true);
        expect(core.count).toBe(0);
        core.update(2);
        expect(core.update(Infinity)).toBeNaN();
        expect(core.count).toBe(1);
    });
});