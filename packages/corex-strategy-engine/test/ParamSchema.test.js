"use strict";

const ParamSchema = require("../src/ParamSchema");
const { Strategy } = require("../src/Strategy");

describe("ParamSchema & serializeSchema Integration", () => {
    class DummyStrategy extends Strategy {
        static symbols = ["EURUSD"];
        static params = {
            threshold: { type: "number", default: 1.1500, min: 1.0, max: 2.0, label: "Threshold", description: "Entry threshold" },
            period: { type: "integer", default: 14, min: 2, max: 100, label: "Period" }
        };
    }

    test("serializeSchema serializes static params correctly for frontend settings pane", () => {
        const schema = ParamSchema.toSchema(DummyStrategy.params);
        const serialized = ParamSchema.serialize(schema);

        expect(Array.isArray(serialized)).toBe(true);
        expect(serialized.length).toBe(2);
        
        const thresh = serialized.find(s => s.key === "threshold");
        expect(thresh).toBeDefined();
        expect(thresh.default).toBe(1.1500);
        expect(thresh.type).toBe("number");
        expect(thresh.min).toBe(1.0);
        expect(thresh.max).toBe(2.0);
        expect(thresh.label).toBe("Threshold");
        expect(thresh.description).toBe("Entry threshold");

        const period = serialized.find(s => s.key === "period");
        expect(period).toBeDefined();
        expect(period.default).toBe(14);
        expect(period.type).toBe("integer");
    });

    test("applyPatch validates and coerces parameter patches", () => {
        const schema = ParamSchema.toSchema(DummyStrategy.params);
        const params = { threshold: 1.15, period: 14 };

        const res = ParamSchema.applyPatch(params, { threshold: "1.1800", period: 20 }, schema);
        expect(res.valid).toBe(true);
        expect(res.applied.threshold).toBe(1.18);
        expect(res.applied.period).toBe(20);

        // Out of bounds
        const resInvalid = ParamSchema.applyPatch(params, { period: 500 }, schema);
        expect(resInvalid.valid).toBe(false);
        expect(resInvalid.errors.period).toBeDefined();
    });
});
