"use strict";

/**
 * B10 — strategy lifecycle persistence consistency.
 *
 * The fake below behaves like the two tables involved instead of matching SQL
 * strings: `strategies` (name -> row) and `strategy_runtimes` (runtime_id ->
 * row). That keeps the assertions on observable state — which desired-state rows
 * are still ACTIVE, and what restoration was asked to start — rather than on the
 * text of the statements.
 */

// Loading the real market-data package opens a live provider socket, which would
// keep the worker alive after the suite finishes. Nothing here exercises data.
jest.mock("@data", () => ({
    MarketFeed: { subscribe: jest.fn(), unsubscribe: jest.fn(), setDeps: jest.fn() },
    DataProviderFactory: { fetchHistorical: jest.fn(async () => []) },
    legacyMarketData: {}
}));

jest.mock("@core/services/postgres", () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    return {
        hasDbConfig: () => true,
        query,
        withTransaction: jest.fn(async (fn) => fn({ query }))
    };
});

jest.mock("@core/services/hashVerifier", () => ({
    verifyStrategyFile: jest.fn(async () => ({ ok: true }))
}));

jest.mock("@utils/security", () => ({ validateStrategyCode: () => true }));

const db = require("@core/services/postgres");
const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const strategyLoader = require("@core/strategyLoader");

function makeFakeDb({ strategies = [], runtimes = [] } = {}) {
    const state = {
        strategies: new Map(strategies.map((row) => [row.name, row])),
        runtimes: new Map(runtimes.map((row) => [row.runtime_id, row]))
    };
    const calls = [];

    const query = jest.fn(async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        calls.push({ text, params });

        if (text.startsWith("UPDATE strategy_runtimes")) {
            const reconciled = [];
            for (const [runtimeId, row] of state.runtimes) {
                if (row.actual_state !== "ACTIVE") continue;
                if (state.strategies.has(row.strategy_name)) continue;
                state.runtimes.set(runtimeId, { ...row, actual_state: "STOPPED" });
                reconciled.push({ runtime_id: runtimeId, strategy_name: row.strategy_name });
            }
            return { rows: reconciled, rowCount: reconciled.length };
        }

        if (text.startsWith("SELECT runtime_id, strategy_name, user_id, symbol")) {
            const rows = [...state.runtimes.values()].filter((r) => r.actual_state === "ACTIVE");
            return { rows, rowCount: rows.length };
        }

        if (text.startsWith("SELECT name, script_body")) {
            const row = state.strategies.get(params[0]);
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("DELETE FROM strategies")) {
            const existed = state.strategies.delete(params[0]);
            return { rows: [], rowCount: existed ? 1 : 0 };
        }

        if (text.startsWith("DELETE FROM strategy_runtimes")) {
            let n = 0;
            for (const [runtimeId, row] of state.runtimes) {
                if (row.strategy_name === params[0]) { state.runtimes.delete(runtimeId); n++; }
            }
            return { rows: [], rowCount: n };
        }

        return { rows: [], rowCount: 0 };
    });

    return { state, calls, query };
}

const ACTIVE = (runtimeId, strategyName, extra = {}) => ({
    runtime_id: runtimeId,
    user_id: "u1",
    strategy_name: strategyName,
    symbol: "EURUSD",
    runtime_mode: "PAPER",
    actual_state: "ACTIVE",
    params: {},
    ...extra
});

describe("B10 startup reconciliation", () => {
    let fake;

    beforeEach(() => {
        db.query.mockReset();
        // The loader and the runtime registry are module singletons: a start that
        // failed in an earlier test must not suppress a later test's restore.
        runtimeRegistry.clear();
        jest.restoreAllMocks();
    });

    function install({ strategies = [], runtimes = [] } = {}) {
        fake = makeFakeDb({ strategies, runtimes });
        db.query.mockImplementation(fake.query);
        return fake;
    }

    /** Statements in the order the implementation issued them. */
    const statements = () => fake.calls.map((c) => c.text);

    test("1. an orphaned ACTIVE runtime is reconciled before restoration", async () => {
        install({
            runtimes: [ACTIVE("u1::Orphan::EURUSD::PAPER", "u1::Orphan")]
        });

        await strategyLoader.init({});

        const text = statements();
        const updateAt = text.findIndex((s) => s.startsWith("UPDATE strategy_runtimes"));
        const selectAt = text.findIndex((s) => s.startsWith("SELECT runtime_id, strategy_name"));
        expect(updateAt).toBeGreaterThanOrEqual(0);
        expect(selectAt).toBeGreaterThan(updateAt);

        // the orphan is no longer restorable
        expect(fake.state.runtimes.get("u1::Orphan::EURUSD::PAPER").actual_state).toBe("STOPPED");
        // and nothing tried to start it: no strategy lookup for the orphan
        expect(text.some((s) => s.startsWith("SELECT name, script_body"))).toBe(false);
    });

    test("2. a valid ACTIVE runtime is still restored", async () => {
        install({
            strategies: [{ name: "u1::Good", script_body: "class X {}" }],
            runtimes: [ACTIVE("u1::Good::EURUSD::PAPER", "u1::Good")]
        });

        await strategyLoader.init({});

        const restored = fake.calls.find((c) => c.text.startsWith("SELECT name, script_body"));
        expect(restored).toBeDefined();
        expect(restored.params).toEqual(["u1::Good"]);
    });

    test("3. reconciliation leaves unrelated valid runtimes untouched", async () => {
        install({
            strategies: [
                { name: "u1::GoodB", script_body: "class X {}" },
                { name: "u2::OtherB", script_body: "class Y {}" }
            ],
            runtimes: [
                ACTIVE("u1::GoodB::EURUSD::PAPER", "u1::GoodB"),
                ACTIVE("u2::OtherB::GBPUSD::LIVE", "u2::OtherB", { user_id: "u2" }),
                ACTIVE("u1::OrphanB::EURUSD::PAPER", "u1::OrphanB")
            ]
        });

        await strategyLoader.init({});

        expect(fake.state.runtimes.get("u1::GoodB::EURUSD::PAPER").actual_state).toBe("ACTIVE");
        expect(fake.state.runtimes.get("u2::OtherB::GBPUSD::LIVE").actual_state).toBe("ACTIVE");
        expect(fake.state.runtimes.get("u1::OrphanB::EURUSD::PAPER").actual_state).toBe("STOPPED");

        // both valid runtimes were offered to restoration, the orphan was not
        const attempted = fake.calls
            .filter((c) => c.text.startsWith("SELECT name, script_body"))
            .map((c) => c.params[0]);
        expect(attempted).toEqual(expect.arrayContaining(["u1::GoodB", "u2::OtherB"]));
        expect(attempted).not.toContain("u1::OrphanB");
    });

    test("7. a second startup does not retry the reconciled orphan", async () => {
        install({
            strategies: [{ name: "u1::Good", script_body: "class X {}" }],
            runtimes: [ACTIVE("u1::Orphan::EURUSD::PAPER", "u1::Orphan")]
        });

        await strategyLoader.init({});
        const firstPass = statements().filter((s) => s.startsWith("SELECT name, script_body"));
        expect(firstPass).toHaveLength(0);

        db.query.mockClear();
        fake.calls.length = 0;
        await strategyLoader.init({});

        // the orphan is STOPPED now, so nothing is reconciled and nothing is started
        expect(statements().some((s) => s.startsWith("SELECT name, script_body"))).toBe(false);
        const update = fake.calls.find((c) => c.text.startsWith("UPDATE strategy_runtimes"));
        expect(update).toBeDefined();
        expect(fake.state.runtimes.get("u1::Orphan::EURUSD::PAPER").actual_state).toBe("STOPPED");
    });

    test("reconciliation failure never blocks restoration", async () => {
        install({
            strategies: [{ name: "u1::GoodC", script_body: "class X {}" }],
            runtimes: [ACTIVE("u1::GoodC::EURUSD::PAPER", "u1::GoodC")]
        });
        const realQuery = fake.query;
        db.query.mockImplementation(async (sql, params) => {
            if (String(sql).startsWith("UPDATE strategy_runtimes")) throw new Error("db down");
            return realQuery(sql, params);
        });

        await expect(strategyLoader.init({})).resolves.toBeUndefined();
        expect(
            fake.calls.some((c) => c.text.startsWith("SELECT name, script_body"))
        ).toBe(true);
    });
});