"use strict";

/**
 * ENGINE-01 P0 — Characterization: live/paper market-data delivery (Test B).
 *
 * Records the ACTUAL behavior of packages/corex-market-data/src/MarketFeed.js
 * `_feedRuntime` around the strategy timeout race (MarketFeed.js:196-218).
 *
 * This suite deliberately asserts what the code does today (including the
 * absence of cancellation/serialization). It does not impose desired behavior.
 * Findings are recorded in plans/Audit/BASELINE.md.
 */

const MarketFeed = require("../packages/corex-market-data/src/MarketFeed.js");

const RUNTIME_ID = "p0-user::feed-strategy::BTC/USD::PAPER";

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeEntry(overrides = {}) {
    const broker = {
        onTick: jest.fn().mockResolvedValue(undefined),
        getPositionSnapshot: jest.fn(() => ({ positions: {}, openCount: 0, totalUnrealized: 0 })),
        handle: jest.fn().mockResolvedValue({ status: "FILLED" }),
        ...overrides.broker
    };
    const instance = {
        onMarketData: jest.fn().mockResolvedValue(null),
        _syncPositionSnapshot: jest.fn(),
        ...overrides.instance
    };
    return {
        runtimeId: RUNTIME_ID,
        userId: "p0-user",
        strategyName: "feed-strategy",
        symbol: "BTC/USD",
        actualState: "ACTIVE",
        instance,
        broker
    };
}

function makeBar(offsetMs = 0) {
    return {
        symbol: "BTC/USD",
        time: 1767225600000 + offsetMs,
        open: 100, high: 101, low: 99, close: 100.5, volume: 12
    };
}

function installDeps(entry, onStrategyCrash = jest.fn()) {
    MarketFeed.setDeps({
        registry: {
            get: jest.fn((id) => (id === RUNTIME_ID ? entry : null)),
            forSymbol: jest.fn(() => [entry])
        },
        onStrategyCrash
    });
    return { onStrategyCrash };
}

describe("ENGINE-01 P0 — MarketFeed strategy dispatch (characterization)", () => {
    const ORIGINAL_TIMEOUT = process.env.COREX_STRATEGY_TIMEOUT_MS;

    beforeEach(() => {
        MarketFeed._subscribers.clear();
        MarketFeed._symbolStats.clear();
        MarketFeed._totalTicks = 0;
    });

    afterEach(async () => {
        if (ORIGINAL_TIMEOUT === undefined) delete process.env.COREX_STRATEGY_TIMEOUT_MS;
        else process.env.COREX_STRATEGY_TIMEOUT_MS = ORIGINAL_TIMEOUT;
        jest.restoreAllMocks();
        // Drain any timer from a still-outstanding strategy call so it cannot
        // be reported against the next test's injected deps.
        await new Promise((r) => setTimeout(r, 60));
    });

    test("onMarketData is invoked once per bar with the packet and context", async () => {
        const entry = makeEntry();
        const { onStrategyCrash } = installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());

        expect(entry.instance.onMarketData).toHaveBeenCalledTimes(1);
        const [packet, context] = entry.instance.onMarketData.mock.calls[0];
        expect(packet.symbol).toBe("BTC/USD");
        expect(packet.close).toBe(100.5);
        expect(context).toEqual({ source: "bar" });
        expect(onStrategyCrash).not.toHaveBeenCalled();
    });

    test("a returned signal is dispatched through broker.handle", async () => {
        const signal = { intent: "ENTER", side: "long", quantity: 1, symbol: "BTC/USD" };
        const entry = makeEntry({ instance: { onMarketData: jest.fn().mockResolvedValue(signal), _syncPositionSnapshot: jest.fn() } });
        installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());

        expect(entry.broker.handle).toHaveBeenCalledTimes(1);
        expect(entry.broker.handle.mock.calls[0][0]).toBe(signal);
    });

    test("a result without intent is not dispatched", async () => {
        const entry = makeEntry({ instance: { onMarketData: jest.fn().mockResolvedValue({ side: "long" }), _syncPositionSnapshot: jest.fn() } });
        installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());

        expect(entry.broker.handle).not.toHaveBeenCalled();
    });

    test("broker position snapshot is pushed to the instance before dispatch", async () => {
        const entry = makeEntry();
        const { onStrategyCrash } = installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());

        expect(entry.instance._syncPositionSnapshot).toHaveBeenCalledTimes(1);
        expect(onStrategyCrash).not.toHaveBeenCalled();
    });

    test("timeout wins: feedBar resolves, no order is sent, strategy crash handler is notified", async () => {
        process.env.COREX_STRATEGY_TIMEOUT_MS = "30";
        const pending = deferred();
        const entry = makeEntry({ instance: { onMarketData: jest.fn(() => pending.promise), _syncPositionSnapshot: jest.fn() } });
        const { onStrategyCrash } = installDeps(entry);

        await expect(MarketFeed.feedBar(RUNTIME_ID, makeBar())).resolves.toBeUndefined();

        expect(entry.broker.handle).not.toHaveBeenCalled();
        expect(onStrategyCrash).toHaveBeenCalledTimes(1);
        const [crashedRuntimeId, err] = onStrategyCrash.mock.calls[0];
        expect(crashedRuntimeId).toBe(RUNTIME_ID);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/STRATEGY_TIMEOUT/);

        pending.resolve(null); // let the losing promise settle
    });

    test("the strategy operation is NOT cancelled after the timeout — it keeps running", async () => {
        process.env.COREX_STRATEGY_TIMEOUT_MS = "20";
        const pending = deferred();
        const finished = { value: false };
        const entry = makeEntry({
            instance: {
                onMarketData: jest.fn(() => pending.promise.then(() => { finished.value = true; return null; })),
                _syncPositionSnapshot: jest.fn()
            }
        });
        installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());
        expect(finished.value).toBe(false); // timed out, still running

        pending.resolve(null);
        await pending.promise;
        await new Promise((r) => setImmediate(r));

        expect(finished.value).toBe(true);
        expect(entry.broker.handle).not.toHaveBeenCalled();
    });

    test("subsequent market data overlaps with the still-outstanding operation", async () => {
        process.env.COREX_STRATEGY_TIMEOUT_MS = "20";
        const first = deferred();
        const second = deferred();

        let inFlight = 0;
        let maxInFlight = 0;
        const onMarketData = jest.fn(() => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            const d = onMarketData.mock.calls.length === 1 ? first : second;
            return d.promise.finally(() => { inFlight -= 1; });
        });

        const entry = makeEntry({ instance: { onMarketData, _syncPositionSnapshot: jest.fn() } });
        installDeps(entry);

        const firstRun = MarketFeed.feedBar(RUNTIME_ID, makeBar(0));
        await firstRun; // first times out and resolves

        const secondRun = MarketFeed.feedBar(RUNTIME_ID, makeBar(60000)); // while first is still pending
        await new Promise((r) => setImmediate(r)); // let the second call reach the strategy

        expect(onMarketData).toHaveBeenCalledTimes(2);
        expect(maxInFlight).toBe(2); // no serialization / deduplication

        await secondRun;
        first.resolve(null);
        second.resolve(null);
        await new Promise((r) => setImmediate(r));
    }, 15000);

    test("a late rejection from the timed-out strategy is swallowed (no crash, no order)", async () => {
        process.env.COREX_STRATEGY_TIMEOUT_MS = "20";
        const pending = deferred();
        const entry = makeEntry({ instance: { onMarketData: jest.fn(() => pending.promise), _syncPositionSnapshot: jest.fn() } });
        const { onStrategyCrash } = installDeps(entry);

        await MarketFeed.feedBar(RUNTIME_ID, makeBar());
        expect(onStrategyCrash).toHaveBeenCalledTimes(1);

        pending.reject(new Error("late failure after timeout"));
        await new Promise((r) => setImmediate(r));

        expect(entry.broker.handle).not.toHaveBeenCalled();
        // Only the timeout is reported; the late rejection produces no second report.
        expect(onStrategyCrash).toHaveBeenCalledTimes(1);
    });

    test("an unknown runtimeId is ignored", async () => {
        const entry = makeEntry();
        installDeps(entry);

        await expect(MarketFeed.feedBar("missing::runtime::BTC/USD::PAPER", makeBar())).resolves.toBeUndefined();
        expect(entry.instance.onMarketData).not.toHaveBeenCalled();
    });
});