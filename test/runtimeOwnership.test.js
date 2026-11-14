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

/**
 * Test synchronization only (never a concurrency guard): waits until a condition
 * produced by the implementation under test becomes true.
 */
async function waitFor(predicate, label) {
    for (let i = 0; i < 500; i++) {
        if (predicate()) return;
        await new Promise((r) => setImmediate(r));
    }
    throw new Error(`waitFor timed out: ${label}`);
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

    // Reservation expiry / rollback ownership ──────────────────────────────────
    test("13. a slow boot keeps its claim: a competing boot cannot acquire the identity", async () => {
        const runtimeId = "u1::SlowA::EURUSD::PAPER";
        const gate = deferred();
        control.onInitialize = () => gate.promise;

        const booting = boot(makeStrategy("SlowA"));
        await new Promise((r) => setImmediate(r));

        const reservation = runtimeRegistry.getReservation(runtimeId);
        expect(reservation).not.toBeNull();

        // Age the claim far beyond any plausible TTL: it must still be owned.
        reservation.createdAt = Date.now() - (24 * 60 * 60 * 1000);
        expect(runtimeRegistry.isReserved(runtimeId)).toBe(true);
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(true);

        await expect(boot(makeStrategy("SlowA"))).rejects.toThrow(/already owned/i);

        gate.resolve();
        await expect(booting).resolves.toBe(true);
        expect(runtimeRegistry.get(runtimeId).actualState).toBe("ACTIVE");

        await new RuntimeLifecycle().terminate(runtimeId);
    }, 15000);

    test("14. a stale boot's rollback cannot delete a newer boot's entry", async () => {
        const runtimeId = "u1::FenceA::EURUSD::PAPER";
        const strategyName = "u1::FenceA";

        // Boot A claims the identity.
        const staleToken = runtimeRegistry.reserve({
            runtimeId,
            userId: "u1",
            accountId: "u1",
            strategyName,
            symbol: "EURUSD",
            mode: "PAPER",
            owner: "bootA"
        });

        // Boot A loses the claim (released), boot B takes it and commits.
        expect(runtimeRegistry.releaseReservation(staleToken)).toBe(true);
        const freshToken = runtimeRegistry.reserve({
            runtimeId,
            userId: "u1",
            accountId: "u1",
            strategyName,
            symbol: "EURUSD",
            mode: "PAPER",
            owner: "bootB"
        });
        const entryB = { instance: makeStrategy("FenceA"), broker: { id: "brokerB" }, symbol: "EURUSD", mode: "PAPER" };
        runtimeRegistry.commitReservation(freshToken, entryB);

        expect(runtimeRegistry.isOwnedBy(runtimeId, freshToken)).toBe(true);
        expect(runtimeRegistry.isOwnedBy(runtimeId, staleToken)).toBe(false);

        // Boot A's rollback must not remove boot B's entry.
        expect(runtimeRegistry.delete(runtimeId, { token: staleToken })).toBe(false);
        expect(runtimeRegistry.has(runtimeId)).toBe(true);
        expect(runtimeRegistry.get(runtimeId).instance).toBe(entryB.instance);

        // Its own rollback path can remove it.
        expect(runtimeRegistry.delete(runtimeId, { token: freshToken })).toBe(true);
        expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    test("15. a post-registration failure keeps the identity owned until cleanup completes", async () => {
        const runtimeId = "u1::PostRegA::EURUSD::PAPER";
        const strategy = makeStrategy("PostRegA");
        const lifecycle = new RuntimeLifecycle();

        const cleanupGate = deferred();
        let observedDuringCleanup = null;
        control.onInitialize = async () => {};
        control.onDestroy = async () => {
            // While the rollback is destroying the broker: the runtime must not
            // be dispatchable, but the identity must still be owned by this boot.
            observedDuringCleanup = {
                owned: runtimeRegistry.has(runtimeId),
                dispatchable: runtimeRegistry.forSymbol("EURUSD").length > 0,
                state: runtimeRegistry.get(runtimeId)?.actualState || null
            };
            await cleanupGate.promise;
        };

        // Commit succeeds, then wiring throws (post-registration failure).
        strategy._attachRuntime = () => { throw new Error("WIRE_FAILED"); };

        const booting = lifecycle.boot({
            runtimeId,
            strategyInstance: strategy,
            profile: profile("PostRegA")
        });
        const rejection = expect(booting).rejects.toThrow("WIRE_FAILED");

        // Observe the registry while the rollback is still cleaning up.
        await waitFor(() => observedDuringCleanup !== null, "rollback cleanup to start");
        cleanupGate.resolve();
        await rejection;

        expect(observedDuringCleanup).toEqual({ owned: true, dispatchable: false, state: "STOPPING" });
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(false);
        expect(runtimeRegistry.pendingSize).toBe(0);
        expect(strategy.destroyCalls).toBe(1);
    }, 15000);

    // Deletion claims ──────────────────────────────────────────────────────────
    test("16. a deletion claim blocks a concurrent runtime creation", async () => {
        const strategyName = "u1::DelClaimA";
        const token = runtimeRegistry.claimStrategyDeletion({ strategyName, userId: "u1" });
        expect(runtimeRegistry.isDeletionClaimed(strategyName)).toBe(true);

        const lifecycle = new RuntimeLifecycle();
        await expect(lifecycle.boot({
            runtimeId: "u1::DelClaimA::EURUSD::PAPER",
            strategyInstance: makeStrategy("DelClaimA"),
            profile: profile("DelClaimA")
        })).rejects.toThrow(/being deleted/i);

        expect(runtimeRegistry.has("u1::DelClaimA::EURUSD::PAPER")).toBe(false);

        expect(runtimeRegistry.releaseStrategyDeletion(token)).toBe(true);
        expect(runtimeRegistry.isDeletionClaimed(strategyName)).toBe(false);
    });

    test("17. a creation reservation prevents a deletion claim", async () => {
        const gate = deferred();
        control.onInitialize = () => gate.promise;
        const booting = boot(makeStrategy("ResvDelA"));

        await new Promise((r) => setImmediate(r));
        expect(runtimeRegistry.isReserved("u1::ResvDelA::EURUSD::PAPER")).toBe(true);

        expect(() => runtimeRegistry.claimStrategyDeletion({
            strategyName: "u1::ResvDelA",
            userId: "u1"
        })).toThrow(/still owns a runtime/i);
        expect(runtimeRegistry.isDeletionClaimed("u1::ResvDelA")).toBe(false);

        gate.resolve();
        await expect(booting).resolves.toBe(true);
        await new RuntimeLifecycle().terminate("u1::ResvDelA::EURUSD::PAPER");
    }, 15000);

    test("18. a failed database delete releases the claim and allows a later start", async () => {
        db.query.mockRejectedValueOnce(new Error("DB_UNAVAILABLE"));

        const failed = await invokeDelete({ userId: "u1", entityId: "DbFailA" });
        expect(failed.statusCode).toBe(500);
        expect(failed.body.error).toBe("DELETE_FAILED");

        // Claim released → a later start is not blocked.
        expect(runtimeRegistry.isDeletionClaimed("u1::DbFailA")).toBe(false);

        const strategy = makeStrategy("DbFailA");
        await expect(boot(strategy)).resolves.toBe(true);
        expect(runtimeRegistry.has("u1::DbFailA::EURUSD::PAPER")).toBe(true);

        await new RuntimeLifecycle().terminate("u1::DbFailA::EURUSD::PAPER");
    });

    test("19. two concurrent deletions: only one owns the operation", async () => {
        const deleteGate = deferred();
        db.query.mockImplementationOnce(() => deleteGate.promise);

        const first = invokeDelete({ userId: "u1", entityId: "DupDelA" });
        await new Promise((r) => setImmediate(r));

        // Second request while the first still holds the claim.
        const second = await invokeDelete({ userId: "u1", entityId: "DupDelA" });
        expect(second.statusCode).toBe(409);
        expect(second.body.error).toBe("DELETE_IN_PROGRESS");

        deleteGate.resolve({ rows: [], rowCount: 1 });
        const firstRes = await first;
        expect(firstRes.statusCode).toBe(200);

        // Claim released after success.
        expect(runtimeRegistry.isDeletionClaimed("u1::DupDelA")).toBe(false);

        // A later request is no longer blocked by a claim (row is gone → 404).
        db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const third = await invokeDelete({ userId: "u1", entityId: "DupDelA" });
        expect(third.statusCode).toBe(404);
    });

    // Rollback cleanup is success/failure, not best-effort ────────────────────
    test("21. a broker destroy failure in post-registration rollback retains the entry, broker and ownership", async () => {
        const strategy = makeStrategy("RollBrokerA");
        strategy._attachRuntime = () => { throw new Error("WIRE_FAILED"); };
        control.destroyError = new Error("BROKER_DESTROY_FAILED");

        const runtimeId = "u1::RollBrokerA::EURUSD::PAPER";
        await expect(boot(strategy)).rejects.toThrow("WIRE_FAILED");

        const entry = runtimeRegistry.get(runtimeId);
        expect(entry).not.toBeNull();
        expect(entry.actualState).toBe("STOPPING");
        // Broker could not be destroyed → its reference is preserved.
        expect(entry.broker).not.toBeNull();
        expect(entry.cleanupFailures.join(" ")).toMatch(/BROKER_DESTROY_FAILED/);
        // Ownership is retained: no other boot can take this identity.
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(true);
        expect(runtimeRegistry.getReservation(runtimeId)).toBeNull();

        // Steps that succeeded are recorded, so a retry does not repeat them.
        expect(strategy.destroyCalls).toBe(1);
        expect(MarketFeed.unsubscribe).toHaveBeenCalledTimes(1);
    }, 15000);

    test("22. a strategy destroy failure in rollback retains the instance reference and ownership", async () => {
        const strategy = makeStrategy("RollStratA");
        strategy._attachRuntime = () => { throw new Error("WIRE_FAILED"); };
        strategy.destroy = () => { strategy.destroyCalls += 1; throw new Error("STRATEGY_DESTROY_FAILED"); };

        const runtimeId = "u1::RollStratA::EURUSD::PAPER";
        await expect(boot(strategy)).rejects.toThrow("WIRE_FAILED");

        const entry = runtimeRegistry.get(runtimeId);
        expect(entry).not.toBeNull();
        expect(entry.actualState).toBe("STOPPING");
        expect(entry.instance).toBe(strategy);
        // The broker was destroyed successfully and must not be retried.
        expect(entry.broker).toBeNull();
        expect(entry.cleanupFailures.join(" ")).toMatch(/STRATEGY_DESTROY_FAILED/);
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(true);
    }, 15000);

    test("23. a later terminate() finishes a failed rollback cleanup without repeating successful steps", async () => {
        const strategy = makeStrategy("RollRetryA");
        strategy._attachRuntime = () => { throw new Error("WIRE_FAILED"); };
        control.destroyError = new Error("BROKER_DESTROY_FAILED");

        const runtimeId = "u1::RollRetryA::EURUSD::PAPER";
        const lifecycle = new RuntimeLifecycle();
        await expect(boot(strategy)).rejects.toThrow("WIRE_FAILED");

        const broker = control.brokers[control.brokers.length - 1];
        expect(runtimeRegistry.has(runtimeId)).toBe(true);
        expect(broker.destroyCalls).toBe(1);
        expect(strategy.destroyCalls).toBe(1);
        expect(MarketFeed.unsubscribe).toHaveBeenCalledTimes(1);

        // Broker can be destroyed now: the retry finishes the job.
        control.destroyError = null;
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(true);

        expect(runtimeRegistry.has(runtimeId)).toBe(false);
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(false);
        expect(broker.destroyCalls).toBe(2);          // broker retried once
        expect(strategy.destroyCalls).toBe(1);        // strategy not destroyed twice
        expect(MarketFeed.unsubscribe).toHaveBeenCalledTimes(1); // feed not re-unsubscribed

        // A further terminate() has nothing left to destroy.
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(false);
        expect(broker.destroyCalls).toBe(2);
        expect(strategy.destroyCalls).toBe(1);
    }, 15000);

    test("24. a successful rollback removes the entry and releases the identity immediately", async () => {
        const strategy = makeStrategy("RollCleanA");
        strategy._attachRuntime = () => { throw new Error("WIRE_FAILED"); };

        const runtimeId = "u1::RollCleanA::EURUSD::PAPER";
        const lifecycle = new RuntimeLifecycle();
        await expect(boot(strategy)).rejects.toThrow("WIRE_FAILED");

        expect(runtimeRegistry.has(runtimeId)).toBe(false);
        expect(runtimeRegistry.isOwned(runtimeId)).toBe(false);
        expect(strategy.destroyCalls).toBe(1);

        const broker = control.brokers[control.brokers.length - 1];
        expect(broker.destroyCalls).toBe(1);

        // Nothing left to clean up: a retry destroys nothing.
        await expect(lifecycle.terminate(runtimeId)).resolves.toBe(false);
        expect(broker.destroyCalls).toBe(1);
        expect(strategy.destroyCalls).toBe(1);
    }, 15000);

    test("25. a stale rollback cannot remove or release a newer owner's state", async () => {
        const runtimeId = "u1::FenceRollA::EURUSD::PAPER";
        const strategyName = "u1::FenceRollA";
        const lifecycle = new RuntimeLifecycle();

        // Boot A claims the identity, then loses the claim (released) before it
        // commits. Boot B takes the claim and registers.
        const staleToken = runtimeRegistry.reserve({
            runtimeId, userId: "u1", accountId: "u1",
            strategyName, symbol: "EURUSD", mode: "PAPER", owner: "bootA"
        });
        runtimeRegistry.releaseReservation(staleToken);

        const fresh = makeStrategy("FenceRollA");
        await expect(boot(fresh)).resolves.toBe(true);

        const freshBroker = control.brokers[control.brokers.length - 1];
        const freshEntry = runtimeRegistry.get(runtimeId);
        expect(freshEntry).not.toBeNull();
        expect(freshEntry.ownerToken).not.toBe(staleToken);

        // Boot A's rollback: it never committed, so it must not touch boot B.
        const staleResult = await lifecycle._rollbackBoot({
            runtimeId,
            token: staleToken,
            broker: null,
            strategyInstance: null,
            profile: profile("FenceRollA"),
            registered: false
        });

        expect(staleResult).toBe(false);
        expect(runtimeRegistry.get(runtimeId)).toBe(freshEntry);
        expect(runtimeRegistry.get(runtimeId).instance).toBe(fresh);
        expect(freshBroker.destroyCalls).toBe(0);
        expect(fresh.destroyCalls).toBe(0);

        // A committed-but-lost boot is equally fenced.
        const committedRollback = await lifecycle._rollbackBoot({
            runtimeId,
            token: staleToken,
            broker: { destroy: async () => { throw new Error("STALE_BROKER_DESTROY"); } },
            strategyInstance: { destroy: async () => { throw new Error("STALE_STRATEGY_DESTROY"); } },
            profile: profile("FenceRollA"),
            registered: true
        });

        expect(committedRollback).toBe(false);
        expect(runtimeRegistry.get(runtimeId)).toBe(freshEntry);
        expect(runtimeRegistry.get(runtimeId).actualState).toBe("ACTIVE");
        expect(freshBroker.destroyCalls).toBe(0);

        await lifecycle.terminate(runtimeId);
        expect(runtimeRegistry.has(runtimeId)).toBe(false);
    }, 15000);

    test("26. an entry that no longer holds its collaborators is not reported as active", async () => {
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