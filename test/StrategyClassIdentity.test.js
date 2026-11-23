"use strict";

/**
 * P2 Regression: Strategy class identity across compiler, loader/runtime and backtest.
 *
 * Proves that the public `corex-strategy-engine` `Strategy` constructor is the
 * single authoritative base class — compiler output, loader-created instances
 * and backtest-supplied instances all resolve to the exact same constructor.
 */

const { Strategy } = require("corex-strategy-engine");
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const backtestManager = require("@core/backtestManager");
const db = require("@core/services/postgres");

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "corex-p2-identity-"));
const CSV_PATH = path.join(TMP_DIR, "identity_1m.csv");

function buildSyntheticCsv(bars = 30) {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const rows = ["time,open,high,low,close,volume"];
    let price = 100;
    for (let i = 0; i < bars; i++) {
        const close = Number((price + 0.01).toFixed(2));
        rows.push(
            `${base + i * 60000},${price.toFixed(2)},${(price + 0.02).toFixed(2)},` +
            `${(price - 0.02).toFixed(2)},${close.toFixed(2)},10`
        );
        price = close;
    }
    return rows.join("\n");
}

beforeAll(() => {
    fs.writeFileSync(CSV_PATH, buildSyntheticCsv(30), "utf8");
    jest
        .spyOn(db, "hasDbConfig")
        .mockReturnValue(true);
    jest
        .spyOn(db, "query")
        .mockResolvedValue({ rows: [], rowCount: 1 });
});

afterAll(() => {
    jest.restoreAllMocks();
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

describe("Strategy class identity regression (P2)", () => {
    test("public Strategy constructor is directly usable and self-identical", () => {
        expect(typeof Strategy).toBe("function");

        class IdentityStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            onBar(ctx, bar) {
                return null;
            }
        }

        const instance = new IdentityStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        // Prototype chain resolves to the public Strategy (instanceof walks the chain)
        expect(instance instanceof Strategy).toBe(true);
        // IdentityStrategy.prototype's prototype is Strategy.prototype
        expect(Object.getPrototypeOf(Object.getPrototypeOf(instance))).toBe(Strategy.prototype);

        // getStateSnapshot() is available without engine-side adaptation
        const snapshot = instance.getStateSnapshot();
        expect(snapshot).toHaveProperty("id");
        expect(snapshot).toHaveProperty("name");
        expect(snapshot).toHaveProperty("symbols");
        expect(snapshot).toHaveProperty("timeframe");
        expect(snapshot).toHaveProperty("mode");
        expect(Array.isArray(snapshot.symbols)).toBe(true);

        // __corexApi is populated and immutable
        expect(Array.isArray(instance.__corexApi)).toBe(true);
        expect(Object.isFrozen(instance.__corexApi)).toBe(true);

        instance.destroy();
    });

    test("singular config.symbol is normalized to canonical symbols array", () => {
        class SymbolNormStrategy extends Strategy {
            static symbols = ["EURUSD"];
        }
        const instance = new SymbolNormStrategy({ symbol: "btc/usd" });
        expect(instance.symbols).toEqual(["BTC/USD"]);
        instance.destroy();
    });

    test("compiler output uses the same public Strategy constructor", async () => {
        const source = [
            "const { Strategy } = require('corex-strategy-engine');",
            "class IdentityStrategy extends Strategy {",
            "  static symbols = ['EURUSD'];",
            "  static timeframe = '1m';",
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = IdentityStrategy;",
        ].join("\n");

        const compiler = new StrategyCompiler();
        const result = await compiler.compile(source, "identity-compiler-strategy");

        expect(result.success).toBe(true);
        expect(result.instance).toBeDefined();
        expect(result.instance instanceof Strategy).toBe(true);
        expect(Object.getPrototypeOf(Object.getPrototypeOf(result.instance))).toBe(Strategy.prototype);

        if (typeof result.instance.destroy === "function") {
            result.instance.destroy();
        }
    });

    test("backtest accepts canonical Strategy instance and produces a report", async () => {
        class BacktestIdentityStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            onBar(ctx, bar) {
                return null;
            }
        }

        const strategy = new BacktestIdentityStrategy({
            symbols: ["EURUSD"],
            timeframe: "1m",
        });

        const report = await backtestManager.run(strategy, {
            runtimeId: "p2-identity-bt",
            userId: "p2-user",
            dataMode: "offline",
            symbol: "EURUSD",
            interval: "1m",
            initialCapital: 10000,
            file: { path: CSV_PATH },
            rangeMode: "points",
            rangePoints: 30,
            includeTrades: true,
        });

        expect(report).toBeTruthy();
        expect(report.meta).toBeTruthy();
        expect(report.meta.symbol).toBe("EURUSD");
        expect(Array.isArray(report.trades)).toBe(true);

        strategy.destroy();
    });
});
