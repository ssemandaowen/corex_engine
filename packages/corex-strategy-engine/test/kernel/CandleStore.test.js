"use strict";

const CandleStore = require("../../src/kernel/CandleStore");
const Frame = require("../../src/kernel/Frame");
const LegacyStorePath = require("../../src/SoACandleStore");

describe("kernel/CandleStore", () => {
    function push(store, frame, time, close) {
        expect(frame.load({ time, open: close, high: close + 1, low: close - 1, close, volume: close * 10 })).toBe(true);
        store.pushFrame(frame);
    }

    test("stores detached rows from a normalised Frame", () => {
        const store = new CandleStore(3);
        const frame = new Frame();
        push(store, frame, 1, 10);
        const row = store.get(0);
        expect(row).toEqual({ time: 1, open: 10, high: 11, low: 9, close: 10, volume: 100 });
        row.close = 999;
        expect(store.get(0).close).toBe(10);
    });

    test("SlidingWindow-backed fields preserve chronological reads", () => {
        const store = new CandleStore(3);
        const frame = new Frame();
        for (let value = 1; value <= 5; value++) push(store, frame, value, value);
        expect(store.toArray().map(row => row.time)).toEqual([3, 4, 5]);
        expect(Array.from(store.getCloses(2))).toEqual([4, 5]);
        expect(Array.from(store.getTimes(3))).toEqual([3, 4, 5]);
        expect(store.get(-1)).toBeNull();
        expect(store.get(3)).toBeNull();
    });

    test("requires a Frame for the single pushFrame ingestion API", () => {
        const store = new CandleStore(2);
        expect(() => store.pushFrame({ time: 1 })).toThrow(/Frame/);
    });

    test("legacy SoACandleStore path resolves to the kernel implementation", () => {
        expect(LegacyStorePath).toBe(CandleStore);
    });

    test("requires a positive integer capacity", () => {
        expect(() => new CandleStore(0)).toThrow(/positive integer/);
        expect(() => new CandleStore(1.5)).toThrow(/positive integer/);
    });
});