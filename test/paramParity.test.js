"use strict";

/**
 * P0-C — live start and backtest must resolve parameters through the same
 * precedence/validation rules: identical defaults + saved + overrides produce
 * an identical effective parameter set in both paths.
 */

jest.mock("@core/services/postgres", () => {
    const query = jest.fn(async (sql) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        if (text.includes("script_body")) {
            return {
                rows: [{
                    name: "placeholder",
                    script_body: "class S {}",
                    updated_at: new Date("2026-01-01T00:00:00Z"),
                    runtime_mode: "PAPER",
                    runtime_params: global.__savedParams || {},
                    runtime_state: "STOPPED",
                    schema: null,
                    compiled_hash: null,
                    compiled_metadata: null
                }],
                rowCount: 1
            };
        }
        return { rows: [], rowCount: 0 };
    });
    return { hasDbConfig: () => true, query };
});

jest.mock("@utils/security", () => ({ validateStrategyCode: () => true }));

jest.mock("@core/services/hashVerifier", () => ({
    verifyStrategyFile: jest.fn(async () => ({ ok: true }))
}));

jest.mock("@core/services/strategyCompiler", () => ({
    StrategyCompiler: class {
        async compile() {
            return {
                success: true,
                instance: new global.__paramStrategyClass(),
                metadata: global.__liveMetadata
            };
        }
    }
}));

jest.mock("@core/core/runtime/RuntimeLifecycle", () => class {
    async boot(opts) {
        global.__liveBootCalls.push(opts);
    }
});

const mockRun = jest.fn(async () => ({ meta: { id: "report-1" }, performance: {} }));
jest.mock("@core/backtestManager", () => ({
    run: (...args) => mockRun(...args)
}));

jest.mock("@core/core/loader/StrategyLoader", () => ({
    instantiateFromSource: async () => new global.__paramStrategyClass()
}));

const strategyLoader = require("../engine/strategyLoader");
const backtestRun = require("../engine/workers/jobs/backtestRun");
const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const { Strategy, ParamSchema } = require("corex-strategy-engine");

class ParamStrategy extends Strategy {
    static params = {
        risk: { default: 1, type: "number", min: 0.1, max: 5 },
        mode: { default: "safe", type: "string", enum: ["safe", "aggressive"] }
    };

    constructor() {
        super({ symbols: ["EURUSD"], timeframe: "1m", lookback: 3 });
    }
}

function makeCtx() {
    return { emitProgress: jest.fn(async () => {}), isAbortRequested: () => false };
}

beforeEach(() => {
    runtimeRegistry.clear();
    global.__paramStrategyClass = ParamStrategy;
    global.__liveMetadata = {
        symbols: ["EURUSD"],
        timeframe: "1m",
        schema: ParamSchema.toSchema(ParamStrategy.params)
    };
    global.__savedParams = {};
    global.__liveBootCalls = [];
    mockRun.mockClear();
});

test("identical inputs resolve to identical parameters in live and backtest", async () => {
    global.__savedParams = { risk: 2, staleKey: 9 };

    const live = await strategyLoader.startStrategy("u1::P1", {
        symbol: "EURUSD",
        mode: "PAPER",
        params: { mode: "aggressive" }
    });
    expect(live.ok).toBe(true);
    const liveParams = global.__liveBootCalls[0].strategyInstance.params;

    await backtestRun.run({
        userId: "u1",
        payload: {
            strategyId: "u1::P1",
            params: { mode: "aggressive" },
            options: { symbol: "EURUSD" }
        }
    }, makeCtx());
    const btParams = mockRun.mock.calls[0][0].params;

    expect(liveParams).toEqual({ risk: 2, mode: "aggressive" });
    expect(btParams).toEqual(liveParams);
});

test("an unknown override is rejected by live start", async () => {
    const result = await strategyLoader.startStrategy("u1::P2", {
        symbol: "EURUSD",
        mode: "PAPER",
        params: { bogus: 1 }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown parameter 'bogus'");
    expect(global.__liveBootCalls).toHaveLength(0);
});

test("an unknown override is rejected by backtest with a non-retryable code", async () => {
    await expect(backtestRun.run({
        userId: "u1",
        payload: {
            strategyId: "u1::P2",
            params: { bogus: 1 },
            options: { symbol: "EURUSD" }
        }
    }, makeCtx())).rejects.toMatchObject({
        code: "PARAM_UNKNOWN",
        retryable: false
    });

    expect(mockRun).not.toHaveBeenCalled();
});

test("an invalid value is rejected by both paths", async () => {
    const live = await strategyLoader.startStrategy("u1::P3", {
        symbol: "EURUSD",
        mode: "PAPER",
        params: { risk: 99 }
    });
    expect(live.ok).toBe(false);
    expect(live.reason).toContain("exceeds maximum");

    await expect(backtestRun.run({
        userId: "u1",
        payload: {
            strategyId: "u1::P3",
            params: { risk: 99 },
            options: { symbol: "EURUSD" }
        }
    }, makeCtx())).rejects.toMatchObject({ code: "PARAM_INVALID", retryable: false });
});
