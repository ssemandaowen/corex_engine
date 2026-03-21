"use strict";

require("module-alias/register");

jest.setTimeout(30000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000, stepMs = 10) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await sleep(stepMs);
    }
    return false;
}

function buildEngineHarness({ status = "ACTIVE" } = {}) {
    jest.resetModules();

    const loaderMock = {
        registry: new Map(),
        syncRuntimeState: jest.fn(),
        init: jest.fn(async () => [])
    };

    const stateMock = {
        getStatus: jest.fn(() => status),
        commit: jest.fn(() => true)
    };

    jest.doMock("@broker/twelvedata", () => ({
        updateSymbols: jest.fn(),
        connect: jest.fn(),
        cleanup: jest.fn(),
        fetchHistory: jest.fn(async () => [])
    }));
    jest.doMock("@core/strategyLoader", () => loaderMock);
    jest.doMock("@utils/storageManager", () => ({
        clampCacheAsync: jest.fn(async () => {}),
        setConfig: jest.fn(),
        getConfig: jest.fn(() => ({}))
    }));
    jest.doMock("@utils/stateController", () => stateMock);

    const engine = require("../engine/core/engine");
    return { engine, loaderMock, stateMock };
}

describe("Core engine signal pipeline integration", () => {
    test("routes generated signal to strategy adapter", async () => {
        const { engine, loaderMock } = buildEngineHarness({ status: "ACTIVE" });
        engine.status = "RUNNING";

        const adapter = { handle: jest.fn(async () => ({ ok: true })) };
        const strategy = {
            id: "ema",
            name: "ema",
            enabled: true,
            symbols: ["BTC/USD"],
            generateSignal: jest.fn(() => ({
                strategyId: "ema",
                symbol: "BTC/USD",
                intent: "ENTER",
                side: "long",
                quantity: 1
            })),
            executionContext: { adapter }
        };
        loaderMock.registry.set("ema", { instance: strategy });

        engine._enqueueStrategyTick(strategy, { symbol: "BTC/USD", price: 100, time: Date.now() });

        const done = await waitFor(() => adapter.handle.mock.calls.length === 1, 3000);
        expect(done).toBe(true);
        expect(adapter.handle).toHaveBeenCalledTimes(1);
        expect(strategy.generateSignal).toHaveBeenCalledTimes(1);

        const metrics = engine.getFeedMetrics();
        expect(metrics.signalExecution).toBeDefined();
        expect(metrics.signalExecution.executed).toBeGreaterThanOrEqual(1);
    });

    test("does not execute signal when strategy state is not ACTIVE", async () => {
        const { engine, loaderMock } = buildEngineHarness({ status: "STAGED" });
        engine.status = "RUNNING";

        const adapter = { handle: jest.fn(async () => ({ ok: true })) };
        const strategy = {
            id: "pair",
            name: "pair",
            enabled: true,
            symbols: ["EUR/USD"],
            generateSignal: jest.fn(() => ({
                strategyId: "pair",
                symbol: "EUR/USD",
                intent: "ENTER",
                side: "long",
                quantity: 1
            })),
            executionContext: { adapter }
        };
        loaderMock.registry.set("pair", { instance: strategy });

        engine._enqueueStrategyTick(strategy, { symbol: "EUR/USD", price: 1.1, time: Date.now() });
        await sleep(100);

        expect(adapter.handle).toHaveBeenCalledTimes(0);
    });
});
