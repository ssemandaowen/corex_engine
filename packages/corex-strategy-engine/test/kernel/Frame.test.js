"use strict";

const Frame = require("../../src/kernel/Frame");

describe("kernel/Frame", () => {
    test("coerces a complete packet and computes derived fields", () => {
        const frame = new Frame();
        expect(frame.load({ symbol: "EURUSD", time: "1000", price: "1.1", open: "1.0", high: "1.2", low: "0.9", close: "1.15", volume: "100" })).toBe(true);
        expect(frame.t).toBe(1000);
        expect(frame.price).toBe(1.1);
        expect(frame.o).toBe(1);
        expect(frame.h).toBe(1.2);
        expect(frame.l).toBe(0.9);
        expect(frame.c).toBe(1.15);
        expect(frame.v).toBe(100);
        expect(frame.symbol).toBe("EURUSD");
        expect(frame.hl2).toBeCloseTo(1.05, 12);
        expect(frame.hlc3).toBeCloseTo((1.2 + 0.9 + 1.15) / 3, 12);
        expect(frame.ohlc4).toBeCloseTo((1 + 1.2 + 0.9 + 1.15) / 4, 12);
    });

    test("normalises price-only and close-only tick packets", () => {
        const frame = new Frame();
        expect(frame.load({ time: 2, price: "2.5" })).toBe(true);
        expect([frame.o, frame.h, frame.l, frame.c, frame.v]).toEqual([2.5, 2.5, 2.5, 2.5, 0]);
        expect(frame.load({ time: 3, close: "3.33" })).toBe(true);
        expect([frame.o, frame.h, frame.l, frame.c, frame.v]).toEqual([3.33, 3.33, 3.33, 3.33, 0]);
    });

    test("returns false and leaves the previous frame unchanged for bad packets", () => {
        const frame = new Frame();
        expect(frame.load({ time: 1, price: 10 })).toBe(true);
        const before = frame.toPacket();
        expect(frame.load({ time: 2, open: 10, high: 8, low: 9, close: 9, volume: 1 })).toBe(false);
        expect(frame.toPacket()).toEqual(before);
        expect(frame.load({ time: "bad", price: 10 })).toBe(false);
        expect(frame.load({ time: 2, price: 10, volume: -1 })).toBe(false);
        expect(frame.load({ time: Symbol("bad"), price: 10 })).toBe(false);
        expect(frame.load(null)).toBe(false);
    });

    test("loadValues copies trusted typed-array values without packet allocation", () => {
        const frame = new Frame();
        expect(frame.loadValues(5, 8, 12, 4, 10, 100)).toBe(frame);
        expect(frame.hl2).toBe(8);
        expect(frame.hlc3).toBeCloseTo(26 / 3, 12);
        expect(frame.ohlc4).toBe(8.5);
    });
});