"use strict";

/**
 * ENGINE-01 Stage 2 — Runtime ownership and atomic lifecycle.
 *
 * Exercises the REAL ownership mechanism: engine/core/runtime/RuntimeRegistry
 * (reservations, atomic commit, transition guards) and
 * engine/core/runtime/RuntimeLifecycle (boot/terminate/rollback), plus the real
 * DELETE /api/strategies/:id handler for the deletion path.
 *
 * Only external I/O is mocked: the broker factory (no broker/network) and the
 * market-data provider/feed. The ownership mechanism itself is never mocked.
 */

jest.mock("@data", () => ({
    MarketFeed: { subscribe: jest.fn(), unsubscribe: jest.fn(), setDeps: jest.fn() },
    DataProviderFactory: { fetchHistorical: jest.fn(async () => []) },
    legacyMarketData: {}
}));

jest.mock("@core/services/postgres", () => ({
    hasDbConfig: () => false,
    query: jest.fn(async () => ({ rows: [], rowCount: 0 }))
}));

// strategyController only needs metadata lookup/invalidation and stop from the
// loader facade; keeping it real would pull in the compiler and the DB.
jest.mock("@core/core/loader/StrategyLoader", () => ({
    invalidate: jest.fn(),
    stop: jest.fn(async () => true),
    getMeta: jest.fn(() => null)
}));

jest.mock("corex-broker-contract", () => {
    const actual = jest.requireActual("corex-broker-contract");
    return {
        ...actual,
        RuntimeBrokerFactory: {
            createBroker: (mode, config) => global.__corexTestCreateBroker(mode, config)
        }
    };
});

const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const RuntimeLifecycle = require("@core/core/runtime/RuntimeLifecycle");
const strategyRouter = require("@core/routes/strategyController");
const loader = require("@core/core/loader/StrategyLoader");
const db = require("@core/services/postgres");
const { MarketFeed } = require("@data");

// ── Broker double (external I/O) ─────────────────────────────────────────────
const control = {
    brokers: [],
    onInitialize: null,
    onDestroy: null,
    initializeError: null,
    destroyError: null
};

global.__corexTestCreateBroker = (mode, config) => {
    const broker = {
        runtimeId: config.runtimeId,
        mode,
        config,
        initializeCalls: 0,
        destroyCalls: 0,
        async initialize(options) {
            this.initializeCalls += 1;
            if (control.onInitialize) await control.onInitialize(this, options);
            if (control.initializeError) throw control.initializeError;
        },
        async destroy() {
            this.destroyCalls += 1;
            if (control.onDestroy) await control.onDestroy(this);
            if (control.destroyError) throw control.destroyError;
        },
        getPerformanceMetrics: () => ({ trades: [], finalEquity: 0 }),
        getPositionSnapshot: () => ({ positions: {}, openCount: 0, totalUnrealized: 0 })
    };
    control.brokers.push(broker);
    return broker;
};

// ── Strategy double ──────────────────────────────────────────────────────────
function makeStrategy(strategyName = "StratA") {
    return {
        id: strategyName,
        symbols: ["EURUSD"],
        timeframe: "1m",
        lookback: 5,
        params: {},
        dataManager: { ingestBar: jest.fn() },
        state: {},
        attached: null,
        destroyCalls: 0,
        _attachRuntime(bindings) { this.attached = bindings; },
        destroy() { this.destroyCalls += 1; }
    };
}

function profile(strategyName, overrides = {}) {
    return {
        runtimeId: `u1::${strategyName}::EURUSD::PAPER`,
        strategyName: `u1::${strategyName}`,
        userId: "u1",
        accountId: "u1",
        symbol: "EURUSD",
        mode: "PAPER",
        params: {},
        ...overrides
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// ── DELETE handler (real route) ──────────────────────────────────────────────
function deleteHandler() {
    const layer = strategyRouter.stack.find(
        (l) => l.route && l.route.path === "/:id" && l.route.methods.delete
    );
    if (!layer) throw new Error("DELETE /:id route not found");
    return layer.route.stack[0].handle;
}

function invokeDelete({ userId, entityId }) {
    const req = { user: { sub: userId }, params: { id: entityId } };
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    return deleteHandler()(req, res).then(() => res);
}

// The broker-settings lookup inside boot also goes through the db facade, so
// "was the strategy row deleted?" has to be asserted on the SQL, not the mock.
function deleteStatements() {
    return db.query.mock.calls
        .map(([sql]) => String(sql))
        .filter((sql) => sql.includes("DELETE FROM strategies"));
}

// ── Boot helper ──────────────────────────────────────────────────────────────
function boot(strategy, overrides = {}) {
    const lifecycle = new RuntimeLifecycle();
    const cfg = profile(strategy.id.split("::").pop(), overrides);
    return lifecycle.boot({ runtimeId: cfg.runtimeId, strategyInstance: strategy, profile: cfg });
}

describe("ENGINE-01 Stage 2 — runtime ownership", () => {
    beforeEach(() => {
        runtimeRegistry.clear();
        control.brokers = [];
        control.onInitialize = null;
        control.onDestroy = null;
        control.initializeError = null;
        control.destroyError = null;
        MarketFeed.subscribe.mockClear();
        MarketFeed.unsubscribe.mockClear();
        loader.invalidate.mockClear();
        loader.stop.mockClear();
        db.query.mockClear();
    });

    afterAll(async () => {
        for (const entry of runtimeRegistry.registeredEntries()) {
            await new RuntimeLifecycle().terminate(entry.runtimeId).catch(() => {});
        }
        runtimeRegistry.clear();
    });

    // 1 ─────────────────────────────────────────────────────────────────────
    test("1. two simultaneous creations of the same runtimeId produce one owner", async () => {
        const gate = deferred();
        control.onInitialize = () => gate.promise;

        const first = boot(makeStrategy("RaceA"));
        const second = boot(makeStrategy("RaceA"));

        // The competing request is rejected on ownership, before building a broker.
        await expect(second).rejects.toThrow(/already owned/i);

        gate.resolve();
        await expect(first).resolves.toBe(true);

        expect(runtimeRegistry.size).toBe(1);
        expect(runtimeRegistry.pendingSize).toBe(0);
        // Only the winner ever created a broker.
        expect(control.brokers.length).toBe(1);

        await new RuntimeLifecycle().terminate("u1::RaceA::EURUSD::PAPER");
    });

    // 2 ─────────────────────────────────────────────────────────────────────
    test("2. a failed initialization rolls back the reservation and releases the identity", async () => {
        control.initializeError = new Error("BROKER_INIT_FAILED");

        await expect(boot(makeStrategy("FailA"))).rejects.toThrow("BROKER_INIT_FAILED");

        expect(runtimeRegistry.has("u1::FailA::EURUSD::PAPER")).toBe(false);
        expect(runtimeRegistry.isOwned("u1::FailA::EURUSD::PAPER")).toBe(false);
        // Partially built broker is destroyed, not leaked.
        expect(control.brokers[0].destroyCalls).toBe(1);

        // No phantom blocks a later, valid creation of the same identity.
        control.initializeError = null;
        const retry = makeStrategy("FailA");
        await expect(boot(retry)).resolves.toBe(true);
        expect(runtimeRegistry.size).toBe(1);
        expect(runtimeRegistry.get("u1::FailA::EURUSD::PAPER").instance).toBe(retry);

        await new RuntimeLifecycle().terminate("u1::FailA::EURUSD::PAPER");
    });

    // 3 ─────────────────────────────────────────────────────────────────────
    test("3. a successful creation reserves, initializes, then activates", async () => {
        const strategy = makeStrategy("OkA");

        await expect(boot(strategy)).resolves.toBe(true);

        const entry = runtimeRegistry.get("u1::OkA::EURUSD::PAPER");
        expect(entry).not.toBeNull();
        expect(entry.actualState).toBe("ACTIVE");
        expect(entry.instance).toBe(strategy);
        expect(entry.broker.initializeCalls).toBe(1);
        expect(strategy.attached).toMatchObject({ runtimeId: "u1::OkA::EURUSD::PAPER", mode: "PAPER" });
        expect(runtimeRegistry.pendingSize).toBe(0);
        expect(MarketFeed.subscribe).toHaveBeenCalledWith("u1::OkA::EURUSD::PAPER", "EURUSD");

        await new RuntimeLifecycle().terminate("u1::OkA::EURUSD::PAPER");
    });

    // 4 ─────────────────────────────────────────────────────────────────────
    test("4a. a terminate during creation cancels the boot instead of racing it", async () => {
        const gate = deferred();
        control.onInitialize = () => gate.promise;

        const strategy = makeStrategy("AbortA");
        const booting = boot(strategy);
        const lifecycle = new RuntimeLifecycle();

        // Creation is in flight: the identity is already owned.
        expect(runtimeRegistry.isReserved("u1::AbortA::EURUSD::PAPER")).toBe(true);
        await expect(lifecycle.terminate("u1::AbortA::EURUSD::PAPER")).resolves.toBe(false);

        gate.resolve();
        await expect(booting).rejects.toThrow(/aborted/i);

        expect(runtimeRegistry.has("u1::AbortA::EURUSD::PAPER")).toBe(false);
        expect(runtimeRegistry.pendingSize).toBe(0);
        expect(control.brokers[0].destroyCalls).toBe(1);
    });

    test("4b. two concurrent terminates share one cleanup and converge", async () => {
        const strategy = makeStrategy("DblA");
        await boot(strategy);
        const runtimeId = "u1::DblA::EURUSD::PAPER";

        const lifecycle = new RuntimeLifecycle();
        const results = await Promise.all([
            lifecycle.terminate(runtimeId),
            lifecycle.terminate(runtimeId)
        ]);

        // Concurrent callers observe the same outcome — no competing teardown.
        expect(results[0]).toBe(results[1]);
        expect(results[0]).toBe(true);
        expect(runtimeRegistry.has(runtimeId)).toBe(false);
        expect(strategy.destroyCalls).toBe(1);
        expect(control.brokers[0].destroyCalls).toBe(1);
    });

    // 5 ─────────────────────────────────────────────────────────────────────
    test("5. repeated termination is safe and idempotent", async () => {
        const strategy = makeStrategy("RepA");
        await boot(strategy);
        const runtimeId = "u1::RepA::EURUSD::PAPER";
        const lifecycle = new RuntimeLifecycle();

        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(true);
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(false);
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(false);

        expect(runtimeRegistry.has(runtimeId)).toBe(false);
        expect(strategy.destroyCalls).toBe(1);
        expect(control.brokers[0].destroyCalls).toBe(1);
        expect(MarketFeed.unsubscribe).toHaveBeenCalledTimes(1);
    });

    // 6 ─────────────────────────────────────────────────────────────────────
    test("6. deletion is refused while creation or a runtime is in progress", async () => {
        const gate = deferred();
        control.onInitialize = () => gate.promise;
        const booting = boot(makeStrategy("DelA"));

        await new Promise((r) => setImmediate(r));

        // Reserved (creation in flight) → refused.
        const duringCreation = await invokeDelete({ userId: "u1", entityId: "DelA" });
        expect(duringCreation.statusCode).toBe(403);
        expect(duringCreation.body.error).toBe("Cannot delete while strategy is active");
        expect(deleteStatements()).toHaveLength(0);

        gate.resolve();
        await booting;

        // Registered and active → refused.
        const duringRun = await invokeDelete({ userId: "u1", entityId: "DelA" });
        expect(duringRun.statusCode).toBe(403);
        expect(deleteStatements()).toHaveLength(0);

        await new RuntimeLifecycle().terminate("u1::DelA::EURUSD::PAPER");
    });

    // 7 ─────────────────────────────────────────────────────────────────────
    test("7. a failed termination blocks a successful deletion report", async () => {
        const strategy = makeStrategy("FailStopA");
        await boot(strategy);
        const runtimeId = "u1::FailStopA::EURUSD::PAPER";

        control.destroyError = new Error("BROKER_DESTROY_FAILED");
        const lifecycle = new RuntimeLifecycle();
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(false);

        // Still registered, marked STOPPING, failure recorded (not swallowed).
        const entry = runtimeRegistry.get(runtimeId);
        expect(entry).not.toBeNull();
        expect(entry.actualState).toBe("STOPPING");
        expect(entry.cleanupFailures.join(";")).toMatch(/BROKER_DESTROY_FAILED/);

        const res = await invokeDelete({ userId: "u1", entityId: "FailStopA" });
        expect(res.statusCode).toBe(403);
        expect(deleteStatements()).toHaveLength(0);

        // Retry after the fault clears completes the cleanup.
        control.destroyError = null;
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(true);
        expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    // 8 ─────────────────────────────────────────────────────────────────────
    test("8. a deletion with no owning runtime purges and invalidates metadata", async () => {
        db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await invokeDelete({ userId: "u1", entityId: "GoneA" });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, message: "Purged." });
        expect(db.query).toHaveBeenCalledWith("DELETE FROM strategies WHERE name = $1", ["u1::GoneA"]);
        expect(loader.invalidate).toHaveBeenCalledWith("u1::GoneA");
        expect(runtimeRegistry.size).toBe(0);
        expect(runtimeRegistry.pendingSize).toBe(0);
    });

    // 9 ─────────────────────────────────────────────────────────────────────
    test("9. ownership is isolated per user and the delete of a foreign identity is a 404", async () => {
        await boot(makeStrategy("IsoA"), { runtimeId: "u1::IsoA::EURUSD::PAPER", userId: "u1" });

        // Another user asking for the same unscoped name must not be blocked by,
        // or able to delete, u1's runtime.
        const res = await invokeDelete({ userId: "u2", entityId: "IsoA" });

        expect(res.statusCode).toBe(404);
        expect(db.query).toHaveBeenCalledWith("DELETE FROM strategies WHERE name = $1", ["u2::IsoA"]);
        expect(runtimeRegistry.has("u1::IsoA::EURUSD::PAPER")).toBe(true);

        // The same symbol/mode is still free for a different account.
        const other = makeStrategy("IsoB");
        const otherLifecycle = new RuntimeLifecycle();
        await expect(otherLifecycle.boot({
            runtimeId: "u2::IsoB::EURUSD::PAPER",
            strategyInstance: other,
            profile: profile("IsoB", { runtimeId: "u2::IsoB::EURUSD::PAPER", userId: "u2", accountId: "u2" })
        })).resolves.toBe(true);
        expect(runtimeRegistry.size).toBe(2);

        await otherLifecycle.terminate("u2::IsoB::EURUSD::PAPER");
        await new RuntimeLifecycle().terminate("u1::IsoA::EURUSD::PAPER");
    });

    // 10 ────────────────────────────────────────────────────────────────────
    test("10. a runtime can be recreated after a failed creation and after deletion", async () => {
        const runtimeId = "u1::RecA::EURUSD::PAPER";

        control.initializeError = new Error("FIRST_BOOT_FAILED");
        await expect(boot(makeStrategy("RecA"))).rejects.toThrow("FIRST_BOOT_FAILED");
        control.initializeError = null;

        // Recreated after the failed creation.
        const first = makeStrategy("RecA");
        await expect(boot(first)).resolves.toBe(true);
        expect(runtimeRegistry.get(runtimeId).instance).toBe(first);

        // Terminated, then purged, then recreated with a fresh instance.
        await expect(new RuntimeLifecycle().terminate(runtimeId)).resolves.toBe(true);

        db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await expect(invokeDelete({ userId: "u1", entityId: "RecA" })).resolves.toMatchObject({ statusCode: 200 });
        expect(runtimeRegistry.has(runtimeId)).toBe(false);

        const second = makeStrategy("RecA");
        await expect(boot(second)).resolves.toBe(true);
        expect(runtimeRegistry.get(runtimeId).instance).toBe(second);
        expect(runtimeRegistry.get(runtimeId).instance).not.toBe(first);
        expect(runtimeRegistry.size).toBe(1);

        await new RuntimeLifecycle().terminate(runtimeId);
    });

    // Stale protection ───────────────────────────────────────────────────────
    test("11. a stale reservation cannot block creation forever", async () => {
        const runtimeId = "u1::StaleA::EURUSD::PAPER";
        const lifecycle = new RuntimeLifecycle();
        const gate = deferred();
        control.onInitialize = () => gate.promise;

        const booting = lifecycle.boot({
            runtimeId,
            strategyInstance: makeStrategy("StaleA"),
            profile: profile("StaleA")
        });

        await new Promise((r) => setImmediate(r));
        expect(runtimeRegistry.isReserved(runtimeId)).toBe(true);

        // Age the reservation beyond the recovery TTL, then let the boot fail so
        // it releases the (now stale) claim without registering.
        const reservation = runtimeRegistry.getReservation(runtimeId);
        reservation.createdAt = Date.now() - (60 * 60 * 1000);
        expect(runtimeRegistry.isReserved(runtimeId)).toBe(false);

        gate.resolve();
        await expect(booting).resolves.toBe(true);

        expect(runtimeRegistry.has(runtimeId)).toBe(true);
        expect(runtimeRegistry.pendingSize).toBe(0);

        await new RuntimeLifecycle().terminate(runtimeId);
    });

    test("12. an entry that no longer holds its collaborators is not reported as active", async () => {
        const strategy = makeStrategy("GhostA");
        await boot(strategy);
        const runtimeId = "u1::GhostA::EURUSD::PAPER";

        // Simulate a partially torn-down entry (cleanup failure path).
        const entry = runtimeRegistry.get(runtimeId);
        entry.instance = null;

        expect(runtimeRegistry.all().map((e) => e.runtimeId)).not.toContain(runtimeId);
        expect(runtimeRegistry.forSymbol("EURUSD")).toHaveLength(0);
        expect(runtimeRegistry.hasActiveForAccountSymbolMode({
            accountId: "u1", symbol: "EURUSD", mode: "PAPER"
        })).toBeNull();
        expect(runtimeRegistry.has(runtimeId)).toBe(true);

        entry.instance = strategy;
        await new RuntimeLifecycle().terminate(runtimeId);
    });
});