"use strict";

const SoACandleStore = require("../utils/strategy/SoACandleStore");
const StrategyDataManager = require("../utils/strategy/StrategyDataManager");

describe("SoACandleStore & StrategyDataManager SoA Migration", () => {
    test("round-trip correctness: write N candles, read back, values match exactly", () => {
        const store = new SoACandleStore(10);
        const candle1 = { time: 1000, open: 1.1000, high: 1.1050, low: 1.0980, close: 1.1020, volume: 150 };
        const candle2 = { time: 2000, open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070, volume: 200 };

        store.push(candle1);
        store.push(candle2);

        expect(store.size).toBe(2);
        
        const retrieved1 = store.get(0);
        expect(retrieved1.time).toBe(candle1.time);
        expect(retrieved1.open).toBe(candle1.open);
        expect(retrieved1.close).toBe(candle1.close);
        expect(retrieved1.volume).toBe(candle1.volume);

        const retrieved2 = store.get(1);
        expect(retrieved2.close).toBe(candle2.close);

        const closes = store.getCloses(2);
        expect(closes instanceof Float64Array).toBe(true);
        expect(closes[0]).toBe(1.1020);
        expect(closes[1]).toBe(1.1070);
    });

    test("wrap-around correctness at capacity boundary", () => {
        const capacity = 3;
        const store = new SoACandleStore(capacity);

        store.push({ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 10 });
        store.push({ time: 2, open: 2, high: 2, low: 2, close: 2, volume: 20 });
        store.push({ time: 3, open: 3, high: 3, low: 3, close: 3, volume: 30 });
        
        expect(store.size).toBe(3);

        // Push 4th item, wrapping around capacity
        store.push({ time: 4, open: 4, high: 4, low: 4, close: 4, volume: 40 });

        expect(store.size).toBe(3); // capped at capacity
        expect(store.get(0).time).toBe(2); // oldest is now time 2
        expect(store.get(2).time).toBe(4); // newest is time 4

        const times = store.getTimes(3);
        expect(times[0]).toBe(2);
        expect(times[1]).toBe(3);
        expect(times[2]).toBe(4);
    });

    test("StrategyDataManager updates ticks and ingests bars successfully with SoA store", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 100 });
        
        manager.ingestBar({ symbol: "EURUSD", time: 1000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 500 });
        expect(manager.isWarmedUp("EURUSD", 1)).toBe(true);

        const latest = manager.getLatest("EURUSD");
        expect(latest.close).toBe(1.11);

        // Update tick
        manager.updateTick({ symbol: "EURUSD", time: 2000, price: 1.1150, volume: 10 }, 60000);
        const window = manager.getLookbackWindow("EURUSD", 5);
        expect(window.length).toBe(1); // 1 completed bar so far
    });

    test("Benchmark: 100k ticks processed via StrategyDataManager", () => {
        const manager = new StrategyDataManager({ symbols: ["EURUSD"], maxHistory: 50000 });
        const tfMs = 60000;

        const start = process.hrtime.bigint();
        for (let i = 0; i < 100000; i++) {
            manager.updateTick({
                symbol: "EURUSD",
                time: i * 1000,
                price: 1.1000 + (i % 100) * 0.0001,
                volume: 1
            }, tfMs);
        }
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;

        console.log(`[Benchmark] SoA StrategyDataManager 100k ticks: ${durationMs.toFixed(2)}ms (${(100000 / (durationMs / 1000)).toFixed(0)} ticks/sec)`);
        expect(durationMs).toBeLessThan(500); // 100k ticks should complete well under 500ms
    });
});
