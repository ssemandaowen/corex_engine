"use strict";

require("module-alias/register");

const SignalGenerationEngine = require("../engine/core/pipeline/SignalGenerationEngine");
const SignalProcessingEngine = require("../engine/core/pipeline/SignalProcessingEngine");
const SignalExecutionEngine = require("../engine/core/pipeline/SignalExecutionEngine");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000, stepMs = 10) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await sleep(stepMs);
    }
    return false;
}

describe("SignalGenerationEngine", () => {
    test("uses priority order generateSignal > onMarketData > onTick > onBar > next", () => {
        const engine = new SignalGenerationEngine();
        const packet = { symbol: "BTC/USD" };
        const context = { isWarmup: false };

        const s1 = { generateSignal: jest.fn(() => ({ source: "generateSignal" })), onTick: jest.fn() };
        expect(engine.generate({ strategy: s1, packet, context }).source).toBe("generateSignal");
        expect(s1.generateSignal).toHaveBeenCalledTimes(1);
        expect(s1.onTick).not.toHaveBeenCalled();

        const s2 = { onMarketData: jest.fn(() => ({ source: "onMarketData" })), onTick: jest.fn() };
        expect(engine.generate({ strategy: s2, packet, context }).source).toBe("onMarketData");
        expect(s2.onMarketData).toHaveBeenCalledTimes(1);
        expect(s2.onTick).not.toHaveBeenCalled();

        const s3 = { onTick: jest.fn(() => ({ source: "onTick" })) };
        expect(engine.generate({ strategy: s3, packet, context }).source).toBe("onTick");

        const s4 = { onBar: jest.fn(() => ({ source: "onBar" })) };
        expect(engine.generate({ strategy: s4, packet, context }).source).toBe("onBar");

        const s5 = { next: jest.fn(() => ({ source: "next" })) };
        expect(engine.generate({ strategy: s5, packet, context }).source).toBe("next");
    });
});

describe("SignalProcessingEngine", () => {
    test("normalizes valid signal with context fallbacks", () => {
        const engine = new SignalProcessingEngine();
        const result = engine.process(
            { intent: "enter", quantity: "2", side: "BUY", ts: "12345" },
            { strategyId: "ema", symbol: "BTC/USD" }
        );

        expect(result.accepted).toBe(true);
        expect(result.signal.strategyId).toBe("ema");
        expect(result.signal.symbol).toBe("BTC/USD");
        expect(result.signal.intent).toBe("ENTER");
        expect(result.signal.quantity).toBe(2);
        expect(result.signal.side).toBe("long");
    });

    test("rejects invalid signal", () => {
        const engine = new SignalProcessingEngine();
        const result = engine.process({ intent: "ENTER" }, {});
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe("INVALID_SIGNAL");
        expect(result.signal).toBeNull();
    });
});

describe("SignalExecutionEngine", () => {
    test("processes queue with configured concurrency", async () => {
        const engine = new SignalExecutionEngine({ concurrency: 2, maxQueue: 500 });
        let active = 0;
        let maxActive = 0;
        const tasks = Array.from({ length: 10 }, () => () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            return sleep(30).then(() => {
                active -= 1;
            });
        });

        tasks.forEach((task) => {
            expect(engine.enqueue(task)).toBe(true);
        });

        const drained = await waitFor(() => {
            const m = engine.getMetrics();
            return m.executed === 10 && m.inFlight === 0 && m.queueDepth === 0;
        }, 4000);

        expect(drained).toBe(true);
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    test("applies backpressure and drops when queue is full", async () => {
        const engine = new SignalExecutionEngine({ concurrency: 1, maxQueue: 1 });
        let release;
        const blocker = new Promise((resolve) => { release = resolve; });

        expect(engine.enqueue(() => blocker)).toBe(true); // in-flight

        let accepted = 1;
        let rejected = 0;
        for (let i = 0; i < 150; i++) {
            const ok = engine.enqueue(() => Promise.resolve());
            if (ok) accepted += 1;
            else rejected += 1;
        }

        const during = engine.getMetrics();
        expect(accepted).toBeLessThanOrEqual(101); // 1 in-flight + queue max clamp(100)
        expect(rejected).toBeGreaterThan(0);
        expect(during.dropped).toBe(rejected);

        release();
        const drained = await waitFor(() => engine.getMetrics().inFlight === 0, 4000);
        expect(drained).toBe(true);
    });
});
