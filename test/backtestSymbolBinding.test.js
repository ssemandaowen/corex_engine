"use strict";

/**
 * P0-B — backtest jobs must bind the requested chart symbol to the strategy's
 * declared universe (same contract as live start) instead of running the
 * strategy on a symbol it never declared.
 */

jest.mock("@core/services/postgres", () => ({
    hasDbConfig: () => true,
    query: jest.fn(async () => ({
        rows: [{ script_body: "class S {}", runtime_params: {} }],
        rowCount: 1
    }))
}));

const mockRun = jest.fn(async () => ({ meta: { id: "report-1" }, performance: {} }));
jest.mock("@core/backtestManager", () => ({
    run: (...args) => mockRun(...args)
}));

jest.mock("@core/core/loader/StrategyLoader", () => ({
    instantiateFromSource: async () => global.__btStrategyInstance
}));

const backtestRun = require("../engine/workers/jobs/backtestRun");
const { Strategy } = require("corex-strategy-engine");

class DeclaredStrategy extends Strategy {
    constructor(symbols) {
        super({ symbols, timeframe: "1m", lookback: 3 });
    }
}

function makeCtx() {
    return {
        emitProgress: jest.fn(async () => {}),
        isAbortRequested: () => false
    };
}

function makeJob({ symbol, allowOutsideUniverse } = {}) {
    return {
        userId: "u1",
        payload: {
            strategyId: "u1::S",
            options: {
                symbol,
                ...(allowOutsideUniverse === undefined ? {} : { allowOutsideUniverse })
            }
        }
    };
}

beforeEach(() => {
    mockRun.mockClear();
});

test("EURUSD strategy backtested on GBPUSD is rejected without the opt-in flag", async () => {
    global.__btStrategyInstance = new DeclaredStrategy(["EURUSD"]);

    await expect(backtestRun.run(makeJob({ symbol: "GBPUSD" }), makeCtx()))
        .rejects.toMatchObject({
            code: "SYMBOL_NOT_SUPPORTED_BY_STRATEGY",
            retryable: false,
            requestedSymbol: "GBPUSD",
            declaredSymbols: ["EURUSD"]
        });

    expect(mockRun).not.toHaveBeenCalled();
});

test("with allowOutsideUniverse the run is rescoped to GBPUSD", async () => {
    global.__btStrategyInstance = new DeclaredStrategy(["EURUSD"]);

    const result = await backtestRun.run(
        makeJob({ symbol: "GBPUSD", allowOutsideUniverse: true }),
        makeCtx()
    );

    expect(result.report.meta).toEqual({ id: "report-1" });

    const [instance, options] = mockRun.mock.calls[0];
    expect(options.symbol).toBe("GBPUSD"); // data is loaded under the bound identity
    expect(instance.symbols).toEqual(["GBPUSD"]);
    expect(instance.env.symbol).toBe("GBPUSD");
    expect(instance.env.assetClass).toBe("fx");
    expect(instance.env.isBacktest).toBe(true);
});

test("a declared 'BTC/USD' matches a backtest request for 'BTCUSD'", async () => {
    global.__btStrategyInstance = new DeclaredStrategy(["BTC/USD"]);

    await backtestRun.run(makeJob({ symbol: "BTCUSD" }), makeCtx());

    const [instance, options] = mockRun.mock.calls[0];
    expect(options.symbol).toBe("BTCUSD");
    expect(instance.symbols).toEqual(["BTCUSD"]);
    expect(instance.env.assetClass).toBe("crypto");
    expect(instance.env.pipScale).toBeDefined();
});

test("a defensively empty universe (legacy metadata) accepts the requested symbol", async () => {
    // Strategies must declare at least one symbol, so this state cannot come
    // from normal construction/compilation; it models legacy metadata only.
    global.__btStrategyInstance = new DeclaredStrategy(["EURUSD"]);
    global.__btStrategyInstance.symbols = [];

    await backtestRun.run(makeJob({ symbol: "EUR/USD" }), makeCtx());

    const [instance, options] = mockRun.mock.calls[0];
    expect(options.symbol).toBe("EURUSD");
    expect(instance.symbols).toEqual(["EURUSD"]);
});
