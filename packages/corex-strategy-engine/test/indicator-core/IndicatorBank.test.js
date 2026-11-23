"use strict";
const IndicatorBank = require("../../src/IndicatorBank");
const BaseIndicator = require("../../src/indicators/BaseIndicator");
const Frame = require("../../src/kernel/Frame");
const CandleStore = require("../../src/kernel/CandleStore");

class CloseFrameIndicator extends BaseIndicator {
    onFrame(frame) { this.value = frame.c; this.ready = true; }
}

describe("IndicatorBank", () => {
    test("updates named BaseIndicators with one shared Frame", () => {
        const close = new CloseFrameIndicator();
        const bank = new IndicatorBank([{ name: "close", instance: close }]);
        const frame = new Frame();
        expect(frame.load({ time: 1, close: 42 })).toBe(true);
        expect(bank.update(frame)).toBe(bank);
        expect(bank.get("close")).toBe(close);
        expect(close.value).toBe(42);
        expect(bank.names).toEqual(["close"]);
        expect(bank.size).toBe(1);
    });

    test("reseed resets every indicator and replays a typed-array store", () => {
        const a = new CloseFrameIndicator();
        const b = new CloseFrameIndicator();
        const bank = new IndicatorBank([{ name: "a", instance: a }, { name: "b", instance: b }]);
        const store = new CandleStore(4);
        const frame = new Frame();
        for (const [time, close] of [[1, 10], [2, 11]]) {
            expect(frame.load({ time, close })).toBe(true);
            store.pushFrame(frame);
        }
        bank.reseed(store, new Frame());
        expect(a.value).toBe(11);
        expect(b.value).toBe(11);
        expect(a.count).toBe(2);
    });

    test("enforces unique names, BaseIndicator instances and Frame inputs", () => {
        const bank = new IndicatorBank();
        bank.add("close", new CloseFrameIndicator());
        expect(() => bank.add("close", new CloseFrameIndicator())).toThrow(/already contains/);
        expect(() => bank.add("legacy", { update() {} })).toThrow(/BaseIndicator/);
        expect(() => bank.update({ close: 10 })).toThrow(/Frame/);
    });
});