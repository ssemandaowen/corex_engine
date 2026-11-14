"use strict";

/**
 * ENGINE-01 P0 — Characterization: engine warmup dispatch (Test C).
 *
 * Exercises the REAL `CoreXEngine#warmupStrategy` implementation
 * (engine/core/engine.js:453-586) with only its I/O collaborators mocked, so
 * the dispatch rules under test are the production ones:
 *
 *   1. prefer `strategy.onBar(bar)`            (engine.js:554-555)
 *   2. fall back to `strategy.onTick(bar, true)` (engine.js:556-557)
 *   3. remote runtimes go through strategyRuntime.warmupBar (engine.js:547-553)
 *
 * The suite records actual behavior, including behavior that is arguably
 * undesirable (see plans/Audit/BASELINE.md). Nothing here redesigns warmup.
 */

jest.mock("@data", () => ({
    DataProviderFactory: { fetchHistorical: jest.fn() },
    MarketFeed: { setDeps: jest.fn() },
    legacyMarketData: {}
}));

jest.mock("@core/strategyLoader", () => ({}));

jest.mock("@utils/stateController", () => ({}));

jest.mock("@core/core/lifecycle/ComponentLifecycle", () => ({
    ComponentLifecycle: class ComponentLifecycle { constructor() { this.state = "IDLE"; } },
    STATES: { IDLE: "IDLE" }
}));

jest.mock("@core/core/pipeline/SignalGenerationEngine", () => ({}));
jest.mock("@core/core/pipeline/SignalProcessingEngine", () => ({ validateForCommand: jest.fn() }));
jest.mock("@core/core/pipeline/SignalExecutionEngine", () => ({ updateSettings: jest.fn() }));
jest.mock("@core/core/pipeline/SocketXRiskEngine", () => ({ check: jest.fn() }));

jest.mock("../packages/corex-gateway/index.js", () => ({
    RiskGateway: { setRiskEngine: jest.fn() },
    SocketXServer: { setAuthVerifier: jest.fn() }
}));

jest.mock("corex-broker-contract", () => ({
    BaseBroker: { setRiskValidator: jest.fn() }
}));

jest.mock("../packages/corex-auth/index.js", () => ({ verifyToken: jest.fn() }));

jest.mock("@core/modules/strategyRuntime", () => ({ warmupBar: jest.fn() }));
jest.mock("@core/core/runtime/RuntimeRegistry", () => ({}));
jest.mock("@core/services/userScope", () => ({ parseScopedId: jest.fn(() => ({})) }));

const fs = require("fs");

const engine = require("@core/core/engine");
const { DataProviderFactory } = require("@data");
const strategyRuntime = require("@core/modules/strategyRuntime");
const storage = require("@utils/storageManager");

const CoreXEngine = engine.constructor;

const TF_MS = 60000;
const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

function buildBars(count) {
    return Array.from({ length: count }, (_, i) => ({
        time: BASE_TIME + i * TF_MS,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10
    }));
}

/**
 * Minimal `this` for warmupStrategy: real prototype helpers + a stubbed cache
 * policy (cache disabled) so the test exercises the fetch + dispatch path only.
 */
function makeCtx() {
    return {
        _getWarmupCachePolicy: () => ({
            enabled: false,
            clampMaxSizeMb: 1,
            clampMaxAgeDays: 1,
            maxWriteBars: 500,
            maxGapBarsForPatch: 5,
            maxPatchBars: 50
        }),
        _normalizeCachedBars: CoreXEngine.prototype._normalizeCachedBars,
        _normalizeTimeframe: CoreXEngine.prototype._normalizeTimeframe,
        _timeframeToMs: CoreXEngine.prototype._timeframeToMs,
        _readWarmupCacheAsync: CoreXEngine.prototype._readWarmupCacheAsync,
        _mergeBarsByTime: CoreXEngine.prototype._mergeBarsByTime,
        _writeWarmupCacheAsync: CoreXEngine.prototype._writeWarmupCacheAsync
    };
}

function makeStrategy(overrides = {}) {
    return {
        id: "warmup-strategy",
        symbols: ["BTC/USD"],
        timeframe: "1m",
        lookback: 20,
        ...overrides
    };
}

async function warmup(strategy) {
    return CoreXEngine.prototype.warmupStrategy.call(makeCtx(), strategy);
}

describe("ENGINE-01 P0 — engine warmup dispatch (characterization)", () => {
    let clampSpy;
    let mkdirSpy;

    beforeEach(() => {
        DataProviderFactory.fetchHistorical.mockReset();
        DataProviderFactory.fetchHistorical.mockResolvedValue(buildBars(30));
        strategyRuntime.warmupBar.mockReset();
        strategyRuntime.warmupBar.mockResolvedValue({ ok: true });

        clampSpy = jest.spyOn(storage, "clampCacheAsync").mockResolvedValue({});
        mkdirSpy = jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
    });

    afterEach(() => {
        clampSpy.mockRestore();
        mkdirSpy.mockRestore();
        jest.clearAllMocks();
    });

    test("prefers onBar and never calls onTick when both exist", async () => {
        const onBar = jest.fn();
        const onTick = jest.fn();
        const strategy = makeStrategy({ onBar, onTick });

        const ok = await warmup(strategy);

        expect(ok).toBe(true);
        expect(onBar).toHaveBeenCalledTimes(20); // only the trailing `lookback` (20) of 30 fetched bars are replayed
        expect(onTick).not.toHaveBeenCalled();
        expect(strategy._warmedUp).toBe(true);
        // Bars are passed in chronological order with the symbol attached, and
        // only the trailing `lookback` window is replayed (bar index 10 of 30).
        expect(onBar.mock.calls[0][0].symbol).toBe("BTC/USD");
        expect(onBar.mock.calls[0][0].time).toBe(BASE_TIME + 10 * TF_MS);
    });

    test("falls back to onTick(bar, true) when onBar is absent", async () => {
        const onTick = jest.fn();
        const strategy = makeStrategy({ onTick });

        const ok = await warmup(strategy);

        expect(ok).toBe(true);
        expect(onTick).toHaveBeenCalledTimes(20);
        const [bar, isWarmedUp] = onTick.mock.calls[0];
        expect(bar.symbol).toBe("BTC/USD");
        expect(isWarmedUp).toBe(true);
        expect(strategy._warmedUp).toBe(true);
    });

    test("a strategy with neither onBar nor onTick is still marked warmed up", async () => {
        const strategy = makeStrategy();

        const ok = await warmup(strategy);

        expect(ok).toBe(true);
        // CHARACTERIZATION: flip when fixed
        expect(strategy._warmedUp).toBe(true); // set at engine.js:565 regardless of dispatch
    });

    test("a throwing bar aborts the remaining bars but still marks the strategy warmed up", async () => {
        let calls = 0;
        const onBar = jest.fn(() => {
            calls += 1;
            if (calls === 2) throw new Error("bar blew up");
            return null;
        });
        const strategy = makeStrategy({ onBar });

        const ok = await warmup(strategy);

        expect(ok).toBe(false);       // failure is reported
        // CHARACTERIZATION: flip when fixed
        expect(onBar).toHaveBeenCalledTimes(2); // remaining bars skipped
        // CHARACTERIZATION: flip when fixed
        expect(strategy._warmedUp).toBe(true);  // ...but warmup is still flagged complete
    });

    test("insufficient data fails warmup without marking the strategy warmed up", async () => {
        DataProviderFactory.fetchHistorical.mockResolvedValue(buildBars(5));
        const onBar = jest.fn();
        const strategy = makeStrategy({ onBar });

        const ok = await warmup(strategy);

        expect(ok).toBe(false);
        expect(onBar).not.toHaveBeenCalled();
        expect(strategy._warmedUp).toBeUndefined();
    });

    test("an async onBar is NOT awaited — warmup resolves before the strategy finishes", async () => {
        let release;
        const gate = new Promise((res) => { release = res; });
        let finished = false;

        const onBar = jest.fn(() => gate.then(() => { finished = true; }));
        const strategy = makeStrategy({ onBar });

        const ok = await warmup(strategy);

        expect(ok).toBe(true);
        expect(onBar).toHaveBeenCalledTimes(20); // only the trailing `lookback` (20) of 30 fetched bars are replayed
        // CHARACTERIZATION: flip when fixed
        expect(finished).toBe(false); // dispatch is fire-and-forget

        release();
        await gate;
        expect(finished).toBe(true);
    });

    test("remote runtimes are warmed sequentially through strategyRuntime.warmupBar", async () => {
        const onBar = jest.fn();
        const strategy = makeStrategy({ __remote: true, onBar });

        const ok = await warmup(strategy);

        expect(ok).toBe(true);
        expect(strategyRuntime.warmupBar).toHaveBeenCalledTimes(20);
        expect(strategyRuntime.warmupBar.mock.calls[0][0]).toMatchObject({ strategyId: "warmup-strategy" });
        expect(onBar).not.toHaveBeenCalled(); // local dispatch is bypassed
    });

    test("a failed remote warmup bar aborts and is still reported as a failed warmup", async () => {
        let calls = 0;
        strategyRuntime.warmupBar.mockImplementation(() => {
            calls += 1;
            return Promise.resolve(calls === 2 ? { ok: false, error: "REMOTE_FAIL" } : { ok: true });
        });
        const strategy = makeStrategy({ __remote: true, onBar: jest.fn() });

        const ok = await warmup(strategy);

        expect(ok).toBe(false);
        // CHARACTERIZATION: flip when fixed
        expect(strategyRuntime.warmupBar).toHaveBeenCalledTimes(2);
        // CHARACTERIZATION: flip when fixed
        expect(strategy._warmedUp).toBe(true);
    });

    test("an invalid timeframe aborts before any data is fetched", async () => {
        const onBar = jest.fn();
        const strategy = makeStrategy({ timeframe: "not-a-timeframe", onBar });

        const ok = await warmup(strategy);

        expect(ok).toBe(false);
        expect(DataProviderFactory.fetchHistorical).not.toHaveBeenCalled();
        expect(onBar).not.toHaveBeenCalled();
        expect(strategy._warmedUp).toBeUndefined();
    });
});