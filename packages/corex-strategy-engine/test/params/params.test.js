"use strict";

const { ParamResolutionError } = require("../../src/ParamResolver");
const {
    collectStatic,
    normalizeSpec,
    normalizeSchema,
    validateValue,
    resolve,
    applyPatch,
    ConfigError
} = require("../../src/params");

describe("additive params module", () => {
    test("ConfigError extends the existing ParamResolutionError contract", () => {
        const error = new ConfigError("period", "bad period");
        expect(error).toBeInstanceOf(ParamResolutionError);
        expect(error.name).toBe("ConfigError");
        expect(error.code).toBe("PARAM_INVALID");
        expect(error.errors[0].key).toBe("period");
    });

    test("collectStatic supports params and indicators with child precedence", () => {
        class Parent {}
        Parent.params = { period: 20, parentOnly: 1 };
        Parent.indicators = { ema: { period: 20 }, rsi: { period: 14 } };
        class Child extends Parent {}
        Child.params = { period: 10 };
        Child.indicators = { ema: { period: 9 } };
        expect(collectStatic(Child, "params")).toEqual({ period: 10, parentOnly: 1 });
        expect(collectStatic(Child, "indicators")).toEqual({
            ema: { period: 9 },
            rsi: { period: 14 }
        });
    });

    test("normalizes schema aliases and infers types", () => {
        expect(normalizeSpec({ default: 10, minimum: 1, maximum: 20 })).toEqual({
            default: 10, minimum: 1, maximum: 20, min: 1, max: 20, type: "integer"
        });
        expect(normalizeSchema({ enabled: { default: false } }).enabled.type).toBe("boolean");
        expect(normalizeSpec(12)).toEqual({ default: 12, type: "integer" });
        expect(normalizeSpec(1.5)).toEqual({ default: 1.5, type: "number" });
    });

    test("strict validation rejects fractional integer with ConfigError", () => {
        expect(() => validateValue({ type: "integer" }, 1.7, { key: "period" }))
            .toThrow(ConfigError);
    });

    test("patch validation reports fractional integer without truncating", () => {
        const result = validateValue({ type: "integer" }, 1.7, { key: "period", mode: "patch" });
        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(ConfigError);
    });

    test("step snapping is shared by strict and patch validation", () => {
        expect(validateValue({ type: "number", step: 0.25 }, 1.12)).toBe(1);
        expect(validateValue({ type: "number", step: 0.25 }, 1.12, { mode: "patch" }))
            .toEqual({ valid: true, value: 1 });
    });

    test("resolution precedence is defaults, saved, then overrides", () => {
        const result = resolve(
            { period: { default: 10, type: "integer" } },
            { period: 20 },
            { period: "30" }
        );
        expect(result.params.period).toBe(30);
        expect(result.provenance.period).toBe("override");
        expect(result.errors).toEqual([]);
    });

    test("invalid override preserves the saved value and unknown override is reported", () => {
        const result = resolve(
            { period: { default: 10, type: "integer" } },
            { period: 20 },
            { period: 2.5, typo: 1 }
        );
        expect(result.params.period).toBe(20);
        expect(result.errors.map((entry) => entry.code)).toEqual(["PARAM_INVALID", "PARAM_UNKNOWN"]);
    });

    test("patch applies valid values and rejects unknown or invalid keys", () => {
        const result = applyPatch(
            { period: 10 },
            { period: 12, typo: 1, fractional: 2.4 },
            { period: { type: "integer" }, fractional: { type: "integer" } }
        );
        expect(result.valid).toBe(false);
        expect(result.applied).toEqual({ period: 12 });
        expect(result.errors).toHaveProperty("typo");
        expect(result.errors).toHaveProperty("fractional");
    });

    test("patch without a schema preserves the legacy pass-through contract", () => {
        const patch = { period: 12, label: "fast" };
        const result = applyPatch({ period: 10 }, patch);
        expect(result).toEqual({ valid: true, applied: patch, errors: {} });
    });

    test("required values are checked after resolution", () => {
        const result = resolve({ token: { type: "string", required: true } });
        expect(result.errors[0].code).toBe("PARAM_REQUIRED");
    });
});
