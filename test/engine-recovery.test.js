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

// Compiler-side dependencies of the real startStrategy (T10). The strategy class
// under test is supplied by the test, not by the real compiler.
jest.mock("@utils/security", () => ({ validateStrategyCode: () => true }));

jest.mock("@core/services/hashVerifier", () => ({
    verifyStrategyFile: jest.fn(async () => ({ ok: true }))
}));

jest.mock("@core/services/strategyCompiler", () => ({
    StrategyCompiler: class {
        async compile() {
            return {
                success: true,
                instance: new global.__corexP01StrategyClass(),
                schema: {},
                metadata: { symbols: ["EURUSD"] }
            };
        }
    }
}));

const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const RuntimeLifecycle = require("@core/core/runtime/RuntimeLifecycle");
const strategyLoader = require("@core/strategyLoader");
const stateManager = require("@utils/stateController");
const { bus, EVENTS } = require("@events/bus");
const engine = require("@core/core/engine");
const log = require("@utils/logger");
const db = require("@core/services/postgres");

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

/** Strategy class handed to the mocked compiler (T10). */
class FakeStrategy {
    constructor() {
        this.symbols = ["EURUSD"];
        this.timeframe = "1m";
        this.lookback = 5;
        this.params = {};
        this.dataManager = { ingestBar: jest.fn() };
        this.state = {};
        this.destroyCalls = 0;
    }
    _attachRuntime() {}
    destroy() { this.destroyCalls += 1; }
}

function installStrategyClass() {
    global.__corexP01StrategyClass = FakeStrategy;
}

/** Ledger states recorded for an id, oldest first. */
function ledgerStates(id) {
    const ledger = stateManager.registry.get(id);
    const states = [];
    for (let node = ledger?.head || null; node; node = node.next) states.push(node.state);
    return states;
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
    installStrategyClass();
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
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    strategyLoader.invalidateMeta("u1::StratA");
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

// ── T3: {ok:false} schedules the next attempt and then stops recovery ────────
describe("T3 failed attempt handling", () => {
    it("reschedules with base*factor^1, counts attempts, then stops recovery at the cap", async () => {
        engine.recoveryMaxAttempts = 3;
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });

        const commitSpy = jest.spyOn(stateManager, "commit");
        const logErrorSpy = jest.spyOn(log, "error").mockImplementation(() => {});
        // Targeted timer check: the recovery record owns exactly one handle
        // (strategyRecoveryStates.get(id).timer). Watching clearTimeout lets us
        // prove THAT handle was cleared, without depending on unrelated timers
        // the DISABLED transition emits in this suite.
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: false, reason: "NO_META" });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(1);
        expect(engine.strategyRecoveryStates.get(runtimeId).timer).toBeTruthy();

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

        // the 20000 retry is the live handle this recovery owns. Only the terminal
        // attempt can clear it: it was created for the 20000 delay.
        const retryTimer = engine.strategyRecoveryStates.get(runtimeId).timer;
        expect(retryTimer).toBeTruthy();

        // attempt 3 fails -> the cap is reached on the reschedule
        await advance(1);
        expect(startSpy).toHaveBeenCalledTimes(3);

        // the recovery's own retry handle was cleared: no retry is left behind.
        // This is a handle-identity check, so unrelated timers the DISABLED
        // transition emits in this suite cannot satisfy or break it.
        expect(clearTimeoutSpy).toHaveBeenCalledWith(retryTimer);

        // The commit is made on the runtime ledger, and the state controller
        // accepts it: STOPPED -> DISABLED is now a legal transition.
        expect(commitSpy).toHaveBeenCalledWith(
            runtimeId,
            "DISABLED",
            expect.objectContaining({ reason: "RECOVERY_MAX_ATTEMPTS_EXCEEDED", attempts: 3 })
        );
        expect(stateManager.getStatus(runtimeId)).toBe("DISABLED");

        // the ledger entry itself carries the reason
        const ledger = stateManager.registry.get(runtimeId);
        expect(ledger.tail.state).toBe("DISABLED");
        expect(ledger.tail.meta.reason).toBe("RECOVERY_MAX_ATTEMPTS_EXCEEDED");
        expect(ledger.tail.meta.attempts).toBe(3);

        // nothing claims a rejection any more
        expect(logErrorSpy.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(
            "DISABLED was rejected by the state controller"
        );

        // terminal: no recovery record (it owns the only retry timer), and no
        // retry fires afterwards
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);
        expect(engine.strategyRecoveryStates.size).toBe(0);

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

// ── T7: a user stop cancels recovery and is never a failed attempt ───────────
describe("T7 user stop", () => {
    it("clears the pending recovery timer, and a later _attemptRecovery is a no-op", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const startSpy = jest
            .spyOn(strategyLoader, "startStrategy")
            .mockResolvedValue({ ok: true, runtimeId });
        const stopSpy = jest.spyOn(strategyLoader, "stopStrategy");

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(true);

        // the user presses STOP while the retry timer is pending
        await strategyLoader.stopStrategy("u1::StratA", { runtimeId });
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        const callsAfterStop = stopSpy.mock.calls.length;

        // a late attempt for a cancelled recovery does nothing at all
        await engine._attemptRecovery(runtimeId);
        await flush();

        expect(stopSpy.mock.calls.length).toBe(callsAfterStop);
        expect(startSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        // and the cancelled recovery is not resurrected by the clock
        await advance(600000);
        expect(startSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);
    });

    it("does not reschedule when a stop request for the strategy lands during the restart", async () => {
        const a = await bootRuntime({ strategyName: "StratA", symbol: "EURUSD", mode: "PAPER" });
        await bootRuntime({ strategyName: "StratA", symbol: "GBPUSD", mode: "PAPER" });
        // the real startStrategy commits ACTIVE for the strategy id (strategyLoader.js:474);
        // startStrategy is mocked here, so the ledger state is reproduced.
        stateManager.commit(a.profile.strategyName, "WARMING_UP");
        stateManager.commit(a.profile.strategyName, "ACTIVE");

        // the restart hangs until the test resolves it, so the stop can land first
        let resolveStart;
        const startSpy = jest.spyOn(strategyLoader, "startStrategy").mockImplementation(
            () => new Promise((resolve) => { resolveStart = resolve; })
        );

        engine.handleStrategyCrash(a.runtimeId, new Error("boom"));
        await advance(5000); // attempt begins: real stop, then the pending start
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(engine.strategyRecoveryStates.has(a.runtimeId)).toBe(true);

        // The user stops the whole strategy while the restart is in flight. The
        // sibling is still registered, so stopStrategy emits STATE_CHANGED(STOPPED)
        // for the strategy id — the signal the engine can see once the crashed
        // runtime's entry is already gone.
        await strategyLoader.stopStrategy(a.profile.strategyName);
        expect(engine.strategyRecoveryStates.has(a.runtimeId)).toBe(false);

        // the restart finishes rejected; a cancelled recovery must not retry
        resolveStart({ ok: false, reason: "STOPPED_BY_USER" });
        await flush();

        expect(engine.strategyRecoveryStates.has(a.runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(engine.strategyRecoveryStates.has(a.runtimeId)).toBe(false);
    });

    it("treats a runtime removed by a concurrent stop as cancelled, not as a failed attempt", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });

        // The user's stop landed before recovery's: the entry is gone, so the real
        // stopStrategy had nothing left to terminate and reports false without
        // emitting anything (stopStrategy only commits STOPPED when anyOk).
        const stopSpy = jest.spyOn(strategyLoader, "stopStrategy").mockImplementation(async () => {
            runtimeRegistry.delete(runtimeId);
            return false;
        });
        const startSpy = jest.spyOn(strategyLoader, "startStrategy").mockResolvedValue({ ok: true });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        await advance(5000);

        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(startSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);
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
// ── T10: a DISABLED runtime can be re-enabled by a manual start ──────────────
describe("T10 re-enable after DISABLED", () => {
    it("boots through the real startStrategy and crashes back into recovery with a fresh counter", async () => {
        engine.recoveryMaxAttempts = 1;
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });

        // recovery gives up on the first failed attempt
        jest.spyOn(strategyLoader, "startStrategy").mockResolvedValue({ ok: false, reason: "NO_META" });
        engine.handleStrategyCrash(runtimeId, new Error("boom"));
        await advance(5000);

        expect(stateManager.getStatus(runtimeId)).toBe("DISABLED");
        expect(runtimeRegistry.get(runtimeId)).toBeNull();

        // the manual re-enable path: the REAL startStrategy, with only the DB,
        // broker, feed and compiler boundary mocked
        jest.restoreAllMocks();
        db.query.mockResolvedValue({
            rows: [{
                name: "u1::StratA",
                script_body: "class X {}",
                updated_at: new Date().toISOString(),
                runtime_mode: "PAPER",
                runtime_params: {},
                runtime_state: "STOPPED",
                schema: null,
                compiled_hash: null,
                compiled_metadata: null
            }],
            rowCount: 1
        });

        const result = await strategyLoader.startStrategy("u1::StratA", {
            userId: "u1",
            mode: "PAPER",
            symbol: "EURUSD"
        });
        expect(result.ok).toBe(true);
        expect(result.runtimeId).toBe(runtimeId);

// DISABLED was reopened, then booted: the ledger ends ACTIVE
        expect(ledgerStates(runtimeId)).toEqual([
            "WARMING_UP", "ACTIVE",           // initial boot
            "ERROR", "STOPPED", "DISABLED",   // crash, recovery stop, exhausted recovery
            "STAGED", "WARMING_UP", "ACTIVE"  // manual re-enable + boot
        ]);
        expect(stateManager.getStatus(runtimeId)).toBe("ACTIVE");
        expect(runtimeRegistry.get(runtimeId)).not.toBeNull();

// a later crash schedules recovery again, with a fresh attempt counter
        engine.recoveryMaxAttempts = 3;
        jest.spyOn(strategyLoader, "startStrategy").mockResolvedValue({ ok: false, reason: "STILL_BAD" });
        engine.handleStrategyCrash(runtimeId, new Error("boom again"));
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(1);

        await advance(5000);
        expect(engine.strategyRecoveryStates.get(runtimeId).attempts).toBe(2);
    });
});

// ── P1: runtime instance guard runs before lifecycle registration ───────────
describe("P1 strategy instance-safety guard", () => {
    it("rejects a foreign runtime instance before lifecycle boot or registry ownership", async () => {
        class UnsafeRuntimeStrategy {
            constructor() {
                const foreign = {
                    symbols: ["EURUSD"],
                    timeframe: "1m",
                    lookback: 5,
                    max_data_history: 500,
                    params: {},
                    schema: {}
                };
                Object.defineProperty(foreign, "constructor", {
                    configurable: true,
                    value: UnsafeRuntimeStrategy
                });
                return foreign;
            }
        }

        global.__corexP01StrategyClass = UnsafeRuntimeStrategy;
        db.query.mockResolvedValue({
            rows: [{
                name: "u1::Unsafe",
                script_body: "class UnsafeRuntimeStrategy {}",
                updated_at: new Date().toISOString(),
                runtime_mode: "PAPER",
                runtime_params: {},
                runtime_state: "STOPPED",
                schema: null,
                compiled_hash: null,
                compiled_metadata: null
            }],
            rowCount: 1
        });

        const lifecycleBootSpy = jest.spyOn(RuntimeLifecycle.prototype, "boot");
        const result = await strategyLoader.startStrategy("u1::Unsafe", {
            userId: "u1",
            mode: "PAPER",
            symbol: "EURUSD"
        });
        const runtimeId = "u1::Unsafe::EURUSD::PAPER";

        expect(result.ok).toBe(false);
        expect(result.reason).toContain("Unsafe strategy instance");
        expect(lifecycleBootSpy).not.toHaveBeenCalled();
        expect(runtimeRegistry.get(runtimeId)).toBeNull();
        expect(runtimeRegistry.isReserved(runtimeId)).toBe(false);
        expect(stateManager.getStatus(runtimeId)).not.toBe("ACTIVE");

        global.__corexP01StrategyClass = FakeStrategy;
    });
});

// ── T11: the state machine differs from main by exactly one edge ─────────────
describe("T11 state machine rules", () => {
    it("adds only STOPPED -> DISABLED to the rules table", () => {
        // Baseline copied from utils/stateController.js on main (467e79c).
        const MAIN_RULES = {
            "OFFLINE": ["STAGED", "WARMING_UP", "STOPPING"],
            "STOPPED": ["STAGED", "WARMING_UP", "STOPPING"],
            "STAGED": ["WARMING_UP", "ACTIVE", "OFFLINE", "STOPPED", "STOPPING"],
            "WARMING_UP": ["ACTIVE", "ERROR", "OFFLINE", "STOPPED", "DISABLED"],
            "ACTIVE": ["PAUSED", "STOPPING", "ERROR", "OFFLINE", "STOPPED", "DISABLED"],
            "PAUSED": ["ACTIVE", "STOPPING", "OFFLINE", "STOPPED"],
            "STOPPING": ["OFFLINE", "STOPPED"],
            "ERROR": ["STAGED", "OFFLINE", "STOPPED", "WARMING_UP", "STOPPING", "DISABLED"],
            "DISABLED": ["STAGED"]
        };

        const keys = new Set([...Object.keys(MAIN_RULES), ...Object.keys(stateManager.rules)]);
        const changes = [];
        for (const key of keys) {
            const before = MAIN_RULES[key] || [];
            const after = stateManager.rules[key] || [];
            const added = after.filter((s) => !before.includes(s));
            const removed = before.filter((s) => !after.includes(s));
            if (added.length || removed.length) changes.push({ state: key, added, removed });
        }

        expect(changes).toEqual([
            { state: "STOPPED", added: ["DISABLED"], removed: [] }
        ]);

        // and the full table matches that one change
        expect(stateManager.rules).toEqual({
            ...MAIN_RULES,
            "STOPPED": ["STAGED", "WARMING_UP", "STOPPING", "DISABLED"]
        });
    });
});

// ── T12 (B9): a user stop landing inside recovery's own stop must win ────────
describe("T12 stop-during-own-stop (B9)", () => {
    it("does not restart a runtime the user stopped while recovery was stopping it", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });

        // RuntimeLifecycle.terminate is single-flight per identity: a concurrent
        // caller joins the running cleanup. Model exactly that so the user stop
        // joins recovery's stop, which is the production ordering.
        const realTerminate = RuntimeLifecycle.prototype.terminate;
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        let shared = null;
        jest.spyOn(RuntimeLifecycle.prototype, "terminate").mockImplementation(function (id) {
            if (id !== runtimeId) return realTerminate.call(this, id);
            if (!shared) shared = gate.then(() => realTerminate.call(this, id));
            return shared;
        });

        const startSpy = jest.spyOn(strategyLoader, "startStrategy").mockResolvedValue({ ok: true });

        engine.handleStrategyCrash(runtimeId, new Error("boom"));

        // Fire the recovery attempt: it stops the crashed runtime and parks there.
        jest.advanceTimersByTime(5000);
        await flush();
        expect(engine.recoveryStopping.has(runtimeId)).toBe(true);

        // The user stops the strategy while recovery's stop is in flight.
        const userStop = strategyLoader.stopStrategy("u1::StratA", { runtimeId });

        release();
        await userStop;
        await flush();

        // The recovery saw a stop request it did not make: no restart, no retry.
        expect(startSpy).not.toHaveBeenCalled();
        expect(engine.strategyRecoveryStates.has(runtimeId)).toBe(false);

        await advance(600000);
        expect(startSpy).not.toHaveBeenCalled();
    });
});

// ── T12b (B9): the stop-request counter itself ───────────────────────────────
describe("T12 stop-request marker", () => {
    it("counts user stops per runtime and ignores the recovery loop's own stop", async () => {
        const { runtimeId } = await bootRuntime({ strategyName: "StratA" });
        const otherId = "u1::Other::EURUSD::PAPER";

        // Deltas, not absolutes: the counter is per-process production state that
        // other tests in this file also move.
        const before = strategyLoader.getStopRequestSeq(runtimeId);
        const otherBefore = strategyLoader.getStopRequestSeq(otherId);

        await strategyLoader.stopStrategy("u1::StratA", { runtimeId, internal: true });
        expect(strategyLoader.getStopRequestSeq(runtimeId)).toBe(before);

        await strategyLoader.stopStrategy("u1::StratA", { runtimeId });
        expect(strategyLoader.getStopRequestSeq(runtimeId)).toBe(before + 1);

        await strategyLoader.stopStrategy("u1::StratA", { runtimeId });
        expect(strategyLoader.getStopRequestSeq(runtimeId)).toBe(before + 2);

        // a stop of this runtime does not move another runtime's counter
        expect(strategyLoader.getStopRequestSeq(otherId)).toBe(otherBefore);
    });
});
