"use strict";

const SoACandleStore = require("../src/SoACandleStore");
const StrategyDataManager = require("../src/StrategyDataManager");
const Frame = require("../src/kernel/Frame");

function frame(packet) {
    const value = new Frame();
    if (!value.load(packet)) throw new Error("Invalid test frame");
    return value;
}

describe("SoACandleStore & StrategyDataManager SlidingWindow migration", () => {
    test("round-trip correctness: write candles through pushFrame and read back", () => {
        const store = new SoACandleStore(10);
        store.pushFrame(frame({ time: 1000, open: 1.1, high: 1.105, low: 1.098, close: 1.102, volume: 150 }));
        store.pushFrame(frame({ time: 2000, open: 1.102, high: 1.108, low: 1.101, close: 1.107, volume: 200 }));
        expect(store.size).toBe(2);
        expect(store.get(0)).toEqual({ time: 1000, open: 1.1, high: 1.105, low: 1.098, close: 1.102, volume: 150 });
        expect(store.get(1).close).toBe(1.107);
        expect(store.getCloses(2)).toBeInstanceOf(Float64Array);
        expect(Array.from(store.getCloses(2))).toEqual([1.102, 1.107]);
    });

    test("capacity sliding preserves chronological order", () => {
        const store = new SoACandleStore(3);
        for (let i = 1; i <= 4; i++) store.pushFrame(frame({ time: i, open: i, high: i, low: i, close: i, volume: i * 10 }));
        expect(store.size).toBe(3);
        expect(store.get(0).time).toBe(2);
        expect(store.get(2).time).toBe(4);
        expect(Array.from(store.getTimes(3))).toEqual([2, 3, 4]);
    });

    test("StrategyDataManager updates ticks and ingests bars through Frames", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 100 });
        manager.ingestBar(frame({ symbol: "EURUSD", time: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 500 }));
        expect(manager.isWarmedUp("EURUSD", 1)).toBe(true);
        expect(manager.getLatest("EURUSD").close).toBe(1.11);
        manager.updateTick(frame({ symbol: "EURUSD", time: 2000, price: 1.115, volume: 10 }), 60000);
        expect(manager.getLookbackWindow("EURUSD", 5)).toHaveLength(1);
    });

    test("100k Frame ticks are processed by StrategyDataManager", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 50000 });
        const scratch = new Frame();
        const start = process.hrtime.bigint();
        for (let i = 0; i < 100000; i++) {
            scratch.load({ symbol: "EURUSD", time: i * 1000, price: 1.1 + (i % 100) * 0.0001, volume: 1 });
            manager.updateTick(scratch, 60000);
        }
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        expect(durationMs).toBeLessThan(2500);
    });
});