"use strict";
const { IndicatorRegistry, UnknownIndicatorError, globalIndicatorRegistry, indicators } = require("../../src/IndicatorRegistry");
const { IndicatorManager } = require("../../src/IndicatorManager");
describe("IndicatorRegistry lazy loading and fail-fast lookup", () => {
    test("registerLazy does not load until get, then caches the constructor", () => {
        const registry = new IndicatorRegistry();
        let loads = 0;
        class Example {}
        registry.registerLazy("Example", () => { loads += 1; return Example; });
        expect(registry.has("example")).toBe(true);
        expect(registry.listTypes()).toEqual(["EXAMPLE"]);
        expect(loads).toBe(0);
        expect(registry.get("EXAMPLE")).toBe(Example);
        expect(registry.get("example")).toBe(Example);
        expect(loads).toBe(1);
    });
    test("unknown indicator lookup throws a typed error", () => {
        const registry = new IndicatorRegistry();
        expect(() => registry.get("Missing")).toThrow(UnknownIndicatorError);
        try { registry.get("Missing"); } catch (error) {
            expect(error.code).toBe("UNKNOWN_INDICATOR");
            expect(error.type).toBe("MISSING");
        }
    });
    test("global registry exposes all 50 types and loads the selected class", () => {
        expect(globalIndicatorRegistry.listTypes()).toHaveLength(50);
        expect(globalIndicatorRegistry.get("EMA")).toBe(indicators.EMA);
        expect(() => globalIndicatorRegistry.get("NOT_REGISTERED")).toThrow(UnknownIndicatorError);
    });
    test("IndicatorManager fails immediately for an unknown configured type", () => {
        class UnknownStrategy {
            static indicators = { unknown: { type: "NOT_REGISTERED" } };
        }
        const manager = new IndicatorManager(new UnknownStrategy());
        expect(() => manager.initialize()).toThrow(UnknownIndicatorError);
    });
    test("enumerating the compatibility object does not eagerly invoke getters", () => {
        expect(Object.keys(indicators)).toHaveLength(50);
        expect(Object.getOwnPropertyDescriptor(indicators, "SMA").get).toBeDefined();
    });
});
