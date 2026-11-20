"use strict";

const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");

describe("StrategyCompiler instance-safety integration", () => {
    let adaptSpy;

    beforeEach(() => {
        adaptSpy = jest.spyOn(StrategyContract, "adapt");
    });

    afterEach(() => {
        adaptSpy.mockRestore();
    });

    const foreignReturningSource = [
        "class UnsafeStrategy {",
        "  constructor() { return {}; }",
        "}",
        "module.exports = UnsafeStrategy;"
    ].join("\n");

    test("rejects unsafe temporary instances before contract adaptation", async () => {
        const compiler = new StrategyCompiler();

        const result = await compiler.validateAndExtractClass(foreignReturningSource, "unsafe-temp");

        expect(result.ok).toBe(false);
        expect(result.error).toContain("PROTOTYPE_MISMATCH");
        expect(adaptSpy).not.toHaveBeenCalled();
    });

    test("rejects unsafe compile instances before contract adaptation", async () => {
        const compiler = new StrategyCompiler();

        const result = await compiler.compile(foreignReturningSource, "unsafe-compile");

        expect(result.success).toBe(false);
        expect(result.error).toContain("PROTOTYPE_MISMATCH");
        expect(adaptSpy).not.toHaveBeenCalled();
    });
});
