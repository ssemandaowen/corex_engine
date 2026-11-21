"use strict";

const fs = require("fs");
const path = require("path");
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { Strategy } = require("corex-strategy-engine");
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
