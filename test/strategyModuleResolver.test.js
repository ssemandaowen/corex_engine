"use strict";

const {
    loadStrategyModule,
    StrategyModuleResolutionError,
} = require("@core/services/strategyModuleResolver");
const { Strategy } = require("corex-strategy-engine");
const BaseStrategy = require("@utils/BaseStrategy");

function captureError(run) {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("Expected strategy module resolution to fail");
}

function expectModuleDenied(source, id = "module-denied") {
    const error = captureError(() => loadStrategyModule(source, id));
    expect(error).toBeInstanceOf(StrategyModuleResolutionError);
    expect(error.code).toBe("STRATEGY_MODULE_NOT_ALLOWED");
    return error;
}

describe("strategy module resolver", () => {
    test("loads the public corex-strategy-engine package root", () => {
        const exportedStrategy = loadStrategyModule(
            'module.exports = require("corex-strategy-engine").Strategy;',
            "allowed-corex-root"
        );

        expect(exportedStrategy).toBe(Strategy);
    });

    test("loads exact mathjs and technicalindicators dependencies", () => {
        const mathResult = loadStrategyModule(
            'module.exports = require("mathjs").add(2, 3);',
            "allowed-mathjs"
        );
        const hasSma = loadStrategyModule(
            'module.exports = typeof require("technicalindicators").SMA === "function";',
            "allowed-technicalindicators"
        );

        expect(mathResult).toBe(5);
        expect(hasSma).toBe(true);
    });

    test("loads only the exact temporary template BaseStrategy specifier", () => {
        const exportedBase = loadStrategyModule(
            'module.exports = require("@utils/BaseStrategy");',
            "allowed-legacy-template"
        );

        expect(exportedBase).toBe(BaseStrategy);
    });

    test.each(["fs", "node:fs", "child_process", "node:module", "lodash"])(
        "rejects forbidden or unknown module %s",
        (specifier) => {
            const error = expectModuleDenied(
                `module.exports = require(${JSON.stringify(specifier)});`,
                "denied-module"
            );
            expect(error.specifier).toBe(specifier);
        }
    );

    test("rejects aliased require even when the scanner cannot see the call", () => {
        const error = expectModuleDenied(
            'const load = require; module.exports = load("fs");',
            "aliased-require"
        );

        expect(error.specifier).toBe("fs");
    });

    test.each([
        "corex-strategy-engine/src/Strategy",
        "corex-strategy-engine/src/indicators/ema",
        "mathjs/lib/core",
        "technicalindicators/lib",
        "@utils/BaseStrategy/internal",
    ])("rejects package subpath %s", (specifier) => {
        expectModuleDenied(
            `module.exports = require(${JSON.stringify(specifier)});`,
            "denied-subpath"
        );
    });

    test.each([
        "./helper",
        "../helper",
        "../../package.json",
        "C:/Users/Public/example.js",
        "/etc/passwd",
    ])("rejects relative, traversal, and absolute path %s", (specifier) => {
        expectModuleDenied(
            `module.exports = require(${JSON.stringify(specifier)});`,
            "denied-path"
        );
    });

    test("rejects computed and non-string require specifiers", () => {
        const computedError = expectModuleDenied(
            'const specifier = "fs"; module.exports = require(specifier);',
            "computed-require"
        );
        expect(computedError.specifier).toBe("fs");

        const nonStringError = expectModuleDenied(
            "module.exports = require(123);",
            "non-string-require"
        );
        expect(nonStringError.specifierType).toBe("number");
    });

    test("does not expose Node require or module loader properties", () => {
        const surfaces = loadStrategyModule(
            'module.exports = { resolve: typeof require.resolve, cache: typeof require.cache, extensions: typeof require.extensions, main: typeof require.main, paths: typeof require.paths, moduleRequire: typeof module.require };',
            "hidden-require-surfaces"
        );

        expect(surfaces).toEqual({
            resolve: "undefined",
            cache: "undefined",
            extensions: "undefined",
            main: "undefined",
            paths: "undefined",
            moduleRequire: "undefined",
        });
    });

    test("dynamic import cannot load modules without a VM import callback", async () => {
        const result = loadStrategyModule(
            'module.exports = import("node:fs").then(() => "loaded", (error) => error.code);',
            "dynamic-import"
        );

        await expect(result).resolves.toBe("ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING");
    });

    test("preserves CommonJS exports and wrapper this binding", () => {
        const result = loadStrategyModule(
            "exports.first = 1; module.exports.second = 2; module.exports.boundThis = this === module.exports;",
            "commonjs-semantics"
        );

        expect(result).toEqual({
            first: 1,
            second: 2,
            boundThis: true,
        });
    });

    test("preserves CommonJS exports reassignment semantics", () => {
        const result = loadStrategyModule(
            "exports.before = true; module.exports = { after: true };",
            "commonjs-reassignment"
        );

        expect(result).toEqual({ after: true });
    });

    test("uses the strategy filename in compilation stack traces", () => {
        const error = captureError(() => loadStrategyModule(
            'throw new Error("strategy compile failure");',
            "stack-filename"
        ));

        expect(error.stack).toContain("db://strategies/stack-filename.js");
    });
});
