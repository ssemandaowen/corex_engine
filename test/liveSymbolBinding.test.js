"use strict";

/**
 * P0-B — live start binds the requested chart symbol to the strategy's
 * declared universe. An undeclared symbol is an error, never a silent
 * fallback; the runtimeId keeps the declared identity spelling.
 */

jest.mock("@core/services/postgres", () => {
    const query = jest.fn(async (sql) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        if (text.startsWith("SELECT name, script_body")) {
            return {
                rows: [{
                    name: "placeholder",
                    script_body: "class S {}",
                    updated_at: new Date("2026-01-01T00:00:00Z"),
                    runtime_mode: "PAPER",
                    runtime_params: {},
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
                instance: new global.__liveStrategyClass(),
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

const strategyLoader = require("../engine/strategyLoader");
const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");

class FakeStrategy {
    constructor() {
        this.symbols = ["EURUSD"];
        this.timeframe = "1m";
        this.lookback = 3;
        this.max_data_history = 500;
        this.params = {};
        this.dataManager = {};
        this.state = {};
    }
    _attachRuntime(opts) {
        this.attachCall = opts;
        this.env = {
            mode: opts.mode,
            runtimeId: opts.runtimeId,
            symbol: opts.symbol,
            pipScale: opts.instrument?.pipScale,
            assetClass: opts.instrument?.assetClass
        };
    }
    destroy() {}
}

function install({ symbols, instanceSymbols = ["EURUSD"] }) {
    global.__liveMetadata = { symbols, timeframe: "1m" };
    global.__liveStrategyClass = class extends FakeStrategy {
        constructor() {
            super();
            this.symbols = instanceSymbols;
        }
    };
}

beforeEach(() => {
    runtimeRegistry.clear();
    global.__liveBootCalls = [];
});

test("an undeclared symbol is rejected instead of silently falling back", async () => {
    install({ symbols: ["EURUSD"] });

    const result = await strategyLoader.startStrategy("u1::S1", { symbol: "GBPUSD", mode: "PAPER" });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not supported by this strategy");
    expect(result.reason).toContain("GBPUSD");
    expect(global.__liveBootCalls).toHaveLength(0);
});

test("a declared symbol starts with the historical runtime id", async () => {
    install({ symbols: ["EURUSD"] });

    const result = await strategyLoader.startStrategy("u1::S2", { symbol: "EURUSD", mode: "PAPER" });

    expect(result).toMatchObject({
        ok: true,
        runtimeId: "u1::S2::EURUSD::PAPER",
        symbol: "EURUSD",
        mode: "PAPER"
    });

    const boot = global.__liveBootCalls[0];
    expect(boot.profile.symbol).toBe("EURUSD");
    expect(boot.profile.instrument.canonical).toBe("EURUSD");
    expect(boot.strategyInstance.symbols).toEqual(["EURUSD"]);
});

test("declared 'BTC/USD' bound to a 'BTCUSD' request keeps the legacy runtime id", async () => {
    install({ symbols: ["BTC/USD"], instanceSymbols: ["BTC/USD"] });

    const result = await strategyLoader.startStrategy("u1::S3", { symbol: "BTCUSD", mode: "PAPER" });

    expect(result.ok).toBe(true);
    expect(result.runtimeId).toBe("u1::S3::BTC/USD::PAPER"); // identity spelling preserved
    expect(result.symbol).toBe("BTCUSD");                    // canonical identity for data/registry

    const boot = global.__liveBootCalls[0];
    expect(boot.profile.symbol).toBe("BTCUSD");
    expect(boot.profile.instrument.assetClass).toBe("crypto");
    expect(boot.strategyInstance.symbols).toEqual(["BTCUSD"]);
    expect(boot.strategyInstance.env.symbol).toBe("BTCUSD");
    expect(boot.strategyInstance.env.pipScale).toBeDefined();
});

test("a defensively empty universe (legacy metadata) accepts the requested symbol", async () => {
    install({ symbols: [] });

    const result = await strategyLoader.startStrategy("u1::S4", { symbol: "GBP/USD", mode: "PAPER" });

    expect(result.ok).toBe(true);
    expect(result.runtimeId).toBe("u1::S4::GBPUSD::PAPER");
    expect(result.symbol).toBe("GBPUSD");
    expect(global.__liveBootCalls[0].strategyInstance.symbols).toEqual(["GBPUSD"]);
});
