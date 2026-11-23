"use strict";

const StrategyDataManager = require("../src/StrategyDataManager");
const Frame = require("../src/kernel/Frame");

function frame(packet) {
    const value = new Frame();
    if (!value.load(packet)) throw new Error("Invalid test frame");
    return value;
}

describe("StrategyDataManager candle close contract", () => {
    test("returns the completed OHLCV candle when the next timeframe begins", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 10 });
        expect(manager.updateTick(frame({ symbol: "EURUSD", time: 1000, price: 10, volume: 2 }), 60000)).toEqual({ closed: false });
        expect(manager.updateTick(frame({ symbol: "EURUSD", time: 2000, price: 13, volume: 3 }), 60000)).toEqual({ closed: false });
        const result = manager.updateTick(frame({ symbol: "EURUSD", time: 61000, price: 12, volume: 7 }), 60000);
        expect(result.closed).toBe(true);
        expect(result.candle).toEqual({ time: 0, open: 10, high: 13, low: 10, close: 13, volume: 5 });
        expect(manager.getLatest("EURUSD")).toEqual(result.candle);
        expect(result.activeCandle).toEqual({ time: 60000, open: 12, high: 12, low: 12, close: 12, volume: 7 });
    });

    test("reuses immutable no-close results on the tick hot path", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 10 });
        const first = manager.updateTick(frame({ symbol: "EURUSD", time: 1000, price: 10, volume: 1 }), 60000);
        const second = manager.updateTick(frame({ symbol: "EURUSD", time: 2000, price: 11, volume: 1 }), 60000);
        expect(first).toBe(second);
        expect(Object.isFrozen(first)).toBe(true);
    });

    test("ignores out-of-order ticks without replacing the active candle", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 10 });
        manager.updateTick(frame({ symbol: "EURUSD", time: 61000, price: 12, volume: 1 }), 60000);
        const before = { ...manager.data.get("EURUSD").activeCandle };
        expect(manager.updateTick(frame({ symbol: "EURUSD", time: 2000, price: 99, volume: 1 }), 60000))
            .toEqual({ closed: false, ignored: true });
        expect(manager.data.get("EURUSD").activeCandle).toEqual(before);
    });

    test("stores a normalised Frame and returns a detached candle packet", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 10 });
        const bar = frame({ symbol: "EURUSD", time: 1, open: 10, high: 12, low: 9, close: 11, volume: 3 });
        expect(manager.ingestBar(bar)).toEqual({ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 3 });
        expect(manager.getLatest("EURUSD")).toEqual({ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 3 });
    });
});