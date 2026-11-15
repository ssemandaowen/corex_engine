"use strict";

/**
 * ENGINE-02B-P0-1 — engine.js auto-recovery.
 *
 * Exercises the REAL recovery path: CoreXEngine.handleStrategyCrash -> the real
 * EVENTS.SYSTEM.STATE_CHANGED listener registered by start() -> _scheduleRecovery
 * -> _attemptRecovery, against the REAL RuntimeRegistry, the REAL RuntimeLifecycle
 * and the REAL utils/stateController.
 *
 * Only external I/O is mocked: the loader's init/startStrategy (DB + compiler),
 * the market-data feed, the broker factory (no broker/network) and the storage
 * manager (no filesystem). strategyLoader.stopStrategy is NOT mocked, so the
 * STOPPED transition that recovery itself causes is genuine — that is what makes
 * the attempt-counter requirement a real test instead of a mock.
 */

jest.mock("@data", () => ({
    MarketFeed: {
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        setDeps: jest.fn(),
        getMetrics: jest.fn(() => ({ symbols: [], totalTicks: 0, lastTickAt: 0, startedAt: null }))
    },
    DataProviderFactory: { fetchHistorical: jest.fn(async () => []) },
    legacyMarketData: { cleanup: jest.fn() }
}));

jest.mock("@core/services/postgres", () => ({
    hasDbConfig: () => false,
    query: jest.fn(async () => ({ rows: [], rowCount: 0 }))
}));

jest.mock("@utils/storageManager", () => ({
    clampCacheAsync: jest.fn(async () => {}),
    readCsvOrGz: jest.fn(async () => []),
    writeCsvOrGz: jest.fn(async () => {}),
    getConfig: jest.fn(() => ({})),
    setConfig: jest.fn()
}));

jest.mock("corex-broker-contract", () => {
    const actual = jest.requireActual("corex-broker-contract");
    return {
        ...actual,
        RuntimeBrokerFactory: {
            createBroker: (mode, config) => global.__corexP01CreateBroker(mode, config)
        }
    };
});

const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const RuntimeLifecycle = require("@core/core/runtime/RuntimeLifecycle");
const strategyLoader = require("@core/strategyLoader");
const stateManager = require("@utils/stateController");
const { bus, EVENTS } = require("@events/bus");
const engine = require("@core/core/engine");

// ── Broker double (external I/O only) ────────────────────────────────────────
function installBrokerFactory() {
    global.__corexP01CreateBroker = (mode, config) => ({
        runtimeId: config.runtimeId,
        mode,
        destroyCalls: 0,
        async initialize() {},
        async destroy() { this.destroyCalls += 1; },
        getPerformanceMetrics: () => ({ trades: [], finalEquity: 0 }),
        getPositionSnapshot: () => ({ positions: {}, openCount: 0, totalUnrealized: 0 })
    });
}

function makeStrategy(strategyName, symbol) {
    return {
        id: strategyName,
        symbols: [symbol],
        timeframe: "1m",
        lookback: 5,
        params: {},
        dataManager: { ingestBar: jest.fn() },
        state: {},
        destroyCalls: 0,
        _attachRuntime() {},
        destroy() { this.destroyCalls += 1; }
    };
}

function makeProfile({ strategyName, userId, symbol, mode }) {
    return {
        runtimeId: `${userId}::${strategyName}::${symbol}::${mode}`,
        strategyName: `${userId}::${strategyName}`,
        userId,
        accountId: userId,
        symbol,
        mode,
        params: {},
        initialCash: 100000,
        connectorType: "metaapi"
    };
}

async function bootRuntime({ strategyName, userId = "u1", symbol = "EURUSD", mode = "PAPER" }) {
    const instance = makeStrategy(`${userId}::${strategyName}`, symbol);
    const profile = makeProfile({ strategyName, userId, symbol, mode });
    const lifecycle = new RuntimeLifecycle();
    await lifecycle.boot({ runtimeId: profile.runtimeId, strategyInstance: instance, profile });
    return { instance, profile, runtimeId: profile.runtimeId };
}

async function flush(times = 100) {
    for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Advance the recovery clock and let the async attempt settle. */
async function advance(ms) {
    await jest.advanceTimersByTimeAsync(ms);
    await flush();
}

beforeAll(async () => {
    installBrokerFactory();
    // Register the real STATE_CHANGED listener once. Calling start() per test
    // would duplicate it — that is P0-4, out of scope here.
    jest.spyOn(strategyLoader, "init").mockResolvedValue(undefined);
    engine.status = "IDLE";
    await engine.start();
});

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllTimers();
    engine.strategyRecoveryStates.clear();
    engine.strategyCrashCounters.clear();
    engine.recoveryBaseDelay = 5000;
    engine.recoveryMaxDelay = 300000;
    engine.recoveryFactor = 2;
    engine.recoveryMaxAttempts = 10;
    runtimeRegistry.clear();
    stateManager.resetAll();
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

// ── T1: identity — the exact entry is resolved, never a strategy-wide lookup ──
describe("T1 identity resolution", () => {
    it("uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader", async () => {
        const { profile, runtimeId } = await bootRuntime({ strategyName: "StratA" });

        const getSpy = jest.spyOn(runtimeRegistry, "get");
        const forStrategySpy = jest.spyOn(runtimeRegistry, "forStrategy");
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true, runtimeId });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));

        expect(getSpy).not.toHaveBeenCalled(); // nothing resolved before the timer
        await advance(5000);

        expect(getSpy).toHaveBeenCalledWith(runtimeId);
        expect(forStrategySpy).not.toHaveBeenCalled();
        expect(startSpy).toHaveBeenCalledTimes(1);

        const [strategyArg, optionsArg] = startSpy.mock.calls[0];
        expect(strategyArg).toBe(profile.strategyName);
        expect(strategyArg).not.toBe(runtimeId);
        expect(optionsArg).toEqual({
            userId: profile.userId,
            mode: profile.mode,
            symbol: profile.symbol,
            params: {}
        });

        // the runtime really was stopped, by its own runtimeId
        expect(runtimeRegistry.get(runtimeId)).toBeNull();
    });
});

// ── T3: {ok:false} schedules the next attempt and eventually disables ────────
describe("T3 failed attempt handling", () => {
    it("reschedules with base*factor^1, counts attempts, then DISABLED", async () => {
        engine.recoveryMaxAttempts = 3;
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });

        const commitSpy = jest.spyOn(stateManager, "commit");
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: false, reason: "NO_META" });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(1);

        // attempt 1 at t=5000 fails -> next delay 5000 * 2^1 = 10000
        await advance(5000);
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(2);
        expect(engine.strategyRecoveryStates.get(runtimeId).nextDelay).toBe(10000);

        await advance(9999);
        expect(startSpy).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(3);
        expect(engine.strategyRecoveryStates.get(runtimeId).nextDelay).toBe(20000);

        // attempt 2 fails -> next delay 5000 * 2^2 = 20000
        await advance(19999);
        expect(startSpy).toHaveBeenCalledTimes(2);
        await advance(1);
        expect(startSpy).toHaveBeenCalledTimes(3);

        // attempt 3 hits the cap -> DISABLED, nothing scheduled
        expect(commitSpy).toHaveBeenCalledWith(
            runtimeId,
            "DISABLED",
            expect.objectContaining({ reason: "RECOVERY_MAX_ATTEMPTS_EXCEEDED" })
        );
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).toHaveBeenCalledTimes(3);
    });
});

// ── T4: a thrown error also schedules the next attempt ───────────────────────
describe("T4 thrown error", () => {
    it("reschedules after a throw and stops at the cap", async () => {
        engine.recoveryMaxAttempts = 2;
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockRejectedValue(new Error("db down"));

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        await advance(5000);
        expect(startSpy).toHaveBeenCalledTimes(1);

        await advance(10000);
        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);
    });
});

// ── T5: success clears recovery and schedules nothing further ────────────────
describe("T5 successful recovery", () => {
    it("does not reschedule and clears the recovery state", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true, runtimeId });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        await advance(5000);

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).toHaveBeenCalledTimes(1);
    });
});

// ── T6: the attempt counter survives recovery's own STOPPED ──────────────────
describe("T6 attempt counter across STOPPED", () => {
    it("does not reset attempts when recovery's own stop moves the runtime to STOPPED", async () => {
        engine.recoveryMaxAttempts = 5;
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: false, reason: "NO_META" });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        await advance(5000);

        // the stop really happened, so the ledger really is STOPPED
        expect(stateManager.getStatus(runtimeId)).toBe("STOPPED");
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(2);

        // next delay is 10000 (attempts=1), not 5000 (a reset counter)
        expect(engine.strategyRecoveryStates.get(runtimeId).nextDelay).toBe(10000);
        await advance(5000);
        expect(startSpy).toHaveBeenCalledTimes(1);
        await advance(5000);
        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(3);
        expect(engine.strategyRecoveryStates.get(runtimeId).nextDelay).toBe(20000);
    });
});

// ── T7: a user stop clears a pending timer (characterisation) ────────────────
describe("T7 user stop", () => {
    it("clears the pending recovery timer and no attempt runs afterwards", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true, runtimeId });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));

        // the user presses STOP while the retry timer is pending
        await strategyLoader.stopStrategy("u1::StratA", { runtimeId });
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).not.toHaveBeenCalled();
    });
});

// ── T8: siblings are never touched ──────────────────────────────────────────
describe("T8 sibling isolation", () => {
    it("stops and restarts only the crashed runtime", async () => {
        const a = await bootRuntime({ strategyName: "StratA", symbol: "EURUSD", mode: "PAPER" });
        const b = await bootRuntime({ strategyName: "StratA", symbol: "GBPUSD", mode: "PAPER" });

        const brokerA = runtimeRegistry.get(a.runtimeId).broker;
        const brokerB = runtimeRegistry.get(b.runtimeId).broker;
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true, runtimeId: a.runtimeId });

        engine.handleStrategyCrash(a.runtimeId, new Error("boom"));
        await advance(5000);

        // A was stopped
        expect(runtimeRegistry.get(a.runtimeId)).toBeNull();
        expect(brokerA.destroyCalls).toBe(1);
        expect(a.instance.destroyCalls).toBe(1);

        // B is untouched
        expect(runtimeRegistry.get(b.runtimeId)).not.toBeNull();
        expect(brokerB.destroyCalls).toBe(0);
        expect(b.instance.destroyCalls).toBe(0);

        // restarted with A's symbol/mode only
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(startSpy.mock.calls[0][0]).toBe(a.profile.strategyName);
        expect(startSpy.mock.calls[0][1]).toEqual({
            userId: "u1",
            mode: "PAPER",
            symbol: "EURUSD",
            params: {}
        });
    });
});

// ── T9: unresolvable target is a failed attempt, never a success ─────────────
describe("T9 unresolvable target", () => {
    it("counts as failed attempts and terminates without ever reporting success", async () => {
        engine.recoveryMaxAttempts = 2;
        const ghostId = "u1::Ghost::EURUSD::PAPER";
        // a ledger without a registry entry: the runtime is gone
        stateManager.commit(ghostId, "STAGED");
        stateManager.commit(ghostId, "WARMING_UP");
        stateManager.commit(ghostId, "ACTIVE");

        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true });
        const stopSpy = jest.spyOn(strategyLoader, "stopStrategy");

        engine.handleStrategyCrash(ghostId, new Error("boom"));
        await advance(5000);
        expect(engine.strategyRecoveryStates.get(ghostId).attempts).toBe(2);

        await advance(10000);
        expect(startSpy).not.toHaveBeenCalled();
        expect(stopSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(ghostId)).toBe(false);
    });
});