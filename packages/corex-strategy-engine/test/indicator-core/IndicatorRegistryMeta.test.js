"use strict";

const { globalIndicatorRegistry, IndicatorRegistry } = require("../../src/IndicatorRegistry");

describe("IndicatorRegistry metadata contract", () => {
    test("publishes aliases, complexity and version without eagerly loading implementations", () => {
        const registry = new IndicatorRegistry();
        class DemoIndicator {}
        registry.registerLazy("DEMO", () => DemoIndicator, {
            aliases: ["DemoAlias"],
            cost: "O(1)",
            version: 7
        });
        expect(registry.has("demoalias")).toBe(true);
        expect(registry.getMeta("DEMO")).toEqual({
            aliases: ["DemoAlias"],
            cost: "O(1)",
            version: 7
        });
        expect(registry.get("DemoAlias")).toBe(DemoIndicator);
    });

    test("global metadata is complete and EMA/ATR versions are current", () => {
        const types = globalIndicatorRegistry.listTypes();
        expect(types).toHaveLength(50);
        for (const type of types) {
            const meta = globalIndicatorRegistry.getMeta(type);
            expect(Array.isArray(meta.aliases)).toBe(true);
            expect(["O(1)", "O(n)"]).toContain(meta.cost);
            expect(Number.isInteger(meta.version)).toBe(true);
        }
        expect(globalIndicatorRegistry.getMeta("EMA").version).toBe(2);
        expect(globalIndicatorRegistry.getMeta("ATR").version).toBe(2);
        expect(globalIndicatorRegistry.getMeta("DPO").version).toBe(2);
        expect(globalIndicatorRegistry.getMeta("BollingerBands").version).toBe(2);
        expect(globalIndicatorRegistry.getMeta("ZScore").version).toBe(2);
        expect(globalIndicatorRegistry.getMeta("DPO").cost).toBe("O(1)");
        expect(globalIndicatorRegistry.has("ExponentialMovingAverage")).toBe(true);
    });
});