"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("@core/services/hashVerifier", () => ({
    verifyStrategyFile: jest.fn(async () => ({ ok: true }))
}));

const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { Strategy } = require("corex-strategy-engine");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const strategyLoader = require("@core/strategyLoader");
const BaseStrategy = require("@utils/BaseStrategy");

describe("StrategyCompiler restricted module resolution", () => {
    const compiler = new StrategyCompiler();
    const deniedSource = [
        "const load = require;",
        "load('fs');",
        "module.exports = class UnsafeStrategy {};",
    ].join("\n");

    test("compile rejects aliased built-in imports before strategy construction", async () => {
        const result = await compiler.compile(deniedSource, "compiler-alias-fs");

        expect(result.success).toBe(false);
        expect(result.error).toContain("STRATEGY_MODULE_NOT_ALLOWED");
    });

    test("validateAndExtractClass uses the same restricted resolver", async () => {
        const result = await compiler.validateAndExtractClass(
            deniedSource,
            "extract-alias-fs"
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain("STRATEGY_MODULE_NOT_ALLOWED");
    });

    test("compile preserves the public Strategy class identity", async () => {
        const source = [
            'const { Strategy } = require("corex-strategy-engine");',
            "class SafeStrategy extends Strategy {",
            '  constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 20 }); }',
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = SafeStrategy;",
        ].join("\n");

        const result = await compiler.compile(source, "compiler-public-api");

        expect(result.success).toBe(true);
        expect(result.instance).toBeInstanceOf(Strategy);

        if (typeof result.instance?.destroy === "function") {
            result.instance.destroy();
        }
    });

    test("canonical Strategy compilation uses package-owned metadata without contract adaptation", async () => {
        const source = [
            'const { Strategy } = require("corex-strategy-engine");',
            "class CanonicalStrategy extends Strategy {",
            '  constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 20 }); }',
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = CanonicalStrategy;",
        ].join("\n");
        const adaptSpy = jest.spyOn(StrategyContract, "adapt");
        const validateSpy = jest.spyOn(StrategyContract, "validate");

        try {
            const compiled = await compiler.compile(source, "canonical-contract-free");
            expect(compiled.success).toBe(true);
            expect(compiled.instance).toBeInstanceOf(Strategy);
            expect(compiled.instance.getStateSnapshot().symbols).toEqual(["EURUSD"]);
            expect(compiled.instance.__corexApi).toContain("onBar");
            expect(Object.isFrozen(compiled.instance.__corexApi)).toBe(true);
            expect(adaptSpy).not.toHaveBeenCalled();
            expect(validateSpy).not.toHaveBeenCalled();
            compiled.instance.destroy();

            const extracted = await compiler.validateAndExtractClass(source, "canonical-extract");
            expect(extracted.ok).toBe(true);
            expect(extracted.StrategyClass.prototype).toBeInstanceOf(Strategy);
            expect(adaptSpy).not.toHaveBeenCalled();
            expect(validateSpy).not.toHaveBeenCalled();
        } finally {
            adaptSpy.mockRestore();
            validateSpy.mockRestore();
        }
    });

    test("compiler rejects strategy classes outside the canonical and explicit legacy bases", async () => {
        const source = [
            "class UnownedStrategy {",
            '  constructor() { this.symbols = ["EURUSD"]; }',
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = UnownedStrategy;",
        ].join("\n");

        const result = await compiler.compile(source, "unowned-strategy-base");

        expect(result.success).toBe(false);
        expect(result.error).toContain("UNSUPPORTED_STRATEGY_BASE");
    });

    test("strategy loader preserves the same public Strategy constructor", async () => {
        const source = [
            'const { Strategy } = require("corex-strategy-engine");',
            "class LoaderCanonicalStrategy extends Strategy {",
            '  constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 20 }); }',
            "  onBar(ctx, bar) { return null; }",
            "}",
            "module.exports = LoaderCanonicalStrategy;",
        ].join("\n");
        const adaptSpy = jest.spyOn(StrategyContract, "adapt");

        try {
            const instance = await strategyLoader.instantiateFromSource(source, "loader-canonical");
            expect(instance).toBeInstanceOf(Strategy);
            expect(instance.getStateSnapshot().symbols).toEqual(["EURUSD"]);
            expect(instance.__corexApi).toContain("onBar");
            expect(adaptSpy).not.toHaveBeenCalled();
            instance.destroy();
        } finally {
            adaptSpy.mockRestore();
        }
    });

    test("compile rejects package subpaths even when module-alias maps the prefix", async () => {
        const source = [
            'const { Strategy } = require("corex-strategy-engine/src/Strategy");',
            "module.exports = class UnsafeSubpathStrategy extends Strategy {};",
        ].join("\n");

        const result = await compiler.compile(source, "compiler-subpath");

        expect(result.success).toBe(false);
        expect(result.error).toContain("STRATEGY_MODULE_NOT_ALLOWED");
    });

    test("compiles the current strategy template through its exact legacy import", async () => {
        const templatePath = path.join(__dirname, "..", "utils", "template.txt");
        const source = fs.readFileSync(templatePath, "utf8")
            .split("$" + "{name}").join("B3TemplateCompatibilityProbe");

        const result = await compiler.compile(source, "compiler-template-compatibility");

        expect(result.success).toBe(true);
        expect(result.instance).toBeInstanceOf(BaseStrategy);
        expect(typeof result.instance.next).toBe("function");

        if (typeof result.instance.destroy === "function") {
            result.instance.destroy();
        }
    });
});
