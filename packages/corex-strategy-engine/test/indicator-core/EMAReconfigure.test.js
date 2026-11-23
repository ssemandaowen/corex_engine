"use strict";

const EMA = require("../../src/indicators/ema");
const Frame = require("../../src/kernel/Frame");
const CandleStore = require("../../src/kernel/CandleStore");

describe("EMA reconfigure and replay", () => {
    test("period change plus store replay equals a fresh instance at the new period", () => {
        const store = new CandleStore(16);
        const frame = new Frame();
        const values = [10, 12, 11, 15, 14, 18, 17, 20];
        const old = new EMA(2);
        for (let i = 0; i < values.length; i++) {
            const value = values[i];
            expect(frame.load({ time: i + 1, open: value, high: value, low: value, close: value, volume: 1 })).toBe(true);
            store.pushFrame(frame);
            old.update(frame);
        }

        old.reconfigure({ period: 3 }, store, new Frame());

        const fresh = new EMA(3);
        fresh.reseed(store, new Frame());

        expect(old.period).toBe(3);
        expect(old.ready).toBe(true);
        expect(old.count).toBe(values.length);
        expect(old.value).toBeCloseTo(fresh.value, 12);
        expect(old.prev).toBeCloseTo(fresh.prev, 12);
    });
});