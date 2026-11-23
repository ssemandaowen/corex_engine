"use strict";
const BaseIndicator = require("../../src/indicators/BaseIndicator");
const Frame = require("../../src/kernel/Frame");
const CandleStore = require("../../src/kernel/CandleStore");

class CloseFrameIndicator extends BaseIndicator {
    onFrame(frame) {
        this.value = this.readSource(frame);
        this.ready = true;
    }
}

describe("BaseIndicator Frame contract", () => {
    test("starts with NaN values and retains readiness separately", () => {
        const indicator = new CloseFrameIndicator();
        expect(Number.isNaN(indicator.value)).toBe(true);
        expect(Number.isNaN(indicator.prev)).toBe(true);
        expect(indicator.ready).toBe(false);
        const frame = new Frame();
        expect(frame.load({ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 2 })).toBe(true);
        indicator.update(frame);
        expect(indicator.value).toBe(11);
        expect(indicator.prev).toBeNaN();
        expect(indicator.ready).toBe(true);
    });

    test("rejects plain frames and requires onFrame implementation", () => {
        const indicator = new CloseFrameIndicator();
        expect(Number.isNaN(indicator.update({ c: 10 }))).toBe(true);
        const abstract = new BaseIndicator();
        expect(() => abstract.update(new Frame())).toThrow(/onFrame/);
    });

    test("reseed replays typed-array CandleStore through one scratch Frame", () => {
        const store = new CandleStore(4);
        const frame = new Frame();
        for (const [time, close] of [[1, 10], [2, 12], [3, 14]]) {
            expect(frame.load({ time, open: close, high: close, low: close, close, volume: 1 })).toBe(true);
            store.pushFrame(frame);
        }
        const indicator = new CloseFrameIndicator();
        expect(indicator.reseed(store, new Frame())).toBe(indicator);
        expect(indicator.value).toBe(14);
        expect(indicator.count).toBe(3);
        expect(indicator.prev).toBe(12);
    });

    test("precomputes all supported source fields", () => {
        const frame = new Frame();
        expect(frame.load({ time: 1, open: 8, high: 12, low: 4, close: 10, volume: 100 })).toBe(true);
        for (const [source, expected] of [["volume", 100], ["hl2", 8], ["hlc3", 26 / 3], ["ohlc4", 8.5]]) {
            const indicator = new CloseFrameIndicator({ source });
            indicator.update(frame);
            expect(indicator.value).toBeCloseTo(expected, 12);
        }
    });

    test("all Frame-based production indicators begin with NaN value/prev and ready=false", () => {
        const { indicators } = require("../../src/IndicatorRegistry");
        for (const type of [
            "SMA", "EMA", "WMA", "HMA", "McGinley", "ALMA", "KAMA", "VIDYA",
            "ATR", "BollingerBands", "DonchianChannels", "KeltnerChannels",
            "StandardDeviation", "ZScore", "DPO"
        ]) {
            const instance = new indicators[type](3);
            expect(Number.isNaN(instance.value)).toBe(true);
            expect(Number.isNaN(instance.prev)).toBe(true);
            expect(instance.ready).toBe(false);
        }
    });
});