"use strict";

const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { Strategy, assertSafeInstance, UnsafeStrategyInstanceError } = require("corex-strategy-engine");

describe("StrategyCompiler instance-safety integration", () => {
    const foreignReturningSource = [
        "class UnsafeStrategy {",
        "  constructor() { return {}; }",
        "}",
        "module.exports = UnsafeStrategy;"
    ].join("\n");

    test("rejects unsafe temporary instances before strategy construction", async () => {
        const compiler = new StrategyCompiler();

        const result = await compiler.validateAndExtractClass(foreignReturningSource, "unsafe-temp");

        expect(result.ok).toBe(false);
        expect(result.error).toContain("PROTOTYPE_MISMATCH");
    });

    test("rejects unsafe compile instances before strategy construction", async () => {
        const compiler = new StrategyCompiler();

        const result = await compiler.compile(foreignReturningSource, "unsafe-compile");

        expect(result.success).toBe(false);
        expect(result.error).toContain("PROTOTYPE_MISMATCH");
    });

    test("assertSafeInstance rejects instances whose prototype does not match Strategy", () => {
        const badInstance = Object.create(null);
        expect(() => assertSafeInstance(badInstance, Strategy)).toThrow(UnsafeStrategyInstanceError);
    });

    test("assertSafeInstance accepts valid Strategy instances", () => {
        const instance = new Strategy({ symbols: ["EURUSD"], timeframe: "1m" });
        expect(assertSafeInstance(instance, Strategy)).toBe(instance);
    });

    test("compile produces a valid package Strategy instance", async () => {
        const source = [
            'const { Strategy } = require("corex-strategy-engine");',
            "class SafeStrategy extends Strategy {",
            '  constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 20 }); }',
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = SafeStrategy;",
        ].join("\n");

        const compiler = new StrategyCompiler();
        const result = await compiler.compile(source, "compiler-safe-instance");

        expect(result.success).toBe(true);
        expect(result.instance).toBeInstanceOf(Strategy);

        if (typeof result.instance?.destroy === "function") {
            result.instance.destroy();
        }
    });
});
