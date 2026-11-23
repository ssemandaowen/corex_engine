"use strict";

const { resolveParams, ParamResolutionError } = require("../src/ParamResolver");

const schema = {
    risk: { default: 1, type: "number", min: 0.1, max: 5 },
    mode: { default: "safe", type: "string", enum: ["safe", "aggressive"] },
    size: { default: 2, type: "integer", minimum: 1, maximum: 10 }
};

describe("resolveParams", () => {
    test("applies defaults first", () => {
        const { params, provenance } = resolveParams(schema, {}, {});
        expect(params).toEqual({ risk: 1, mode: "safe", size: 2 });
        expect(provenance).toEqual({ risk: "default", mode: "default", size: "default" });
    });

    test("precedence is defaults < saved < overrides", () => {
        const { params, provenance } = resolveParams(
            schema,
            { risk: 2, mode: "aggressive" },
            { risk: 3 }
        );
        expect(params).toEqual({ risk: 3, mode: "aggressive", size: 2 });
        expect(provenance).toEqual({ risk: "override", mode: "saved", size: "default" });
    });

    test("coerces numeric strings and booleans", () => {
        const { params, errors } = resolveParams(
            { qty: { default: 1, type: "integer" }, flag: { default: false, type: "boolean" } },
            {},
            { qty: "7", flag: "true" }
        );
        expect(errors).toEqual([]);
        expect(params).toEqual({ qty: 7, flag: true });
    });

    test("rejects fractional values for integer parameters without truncating", () => {
        const { params, errors } = resolveParams(schema, { size: 3 }, { size: 2.8 });
        expect(errors).toEqual([
            expect.objectContaining({ code: "PARAM_INVALID", key: "size", source: "override" })
        ]);
        expect(params.size).toBe(3); // previous value retained, not truncated to 2
    });

    test("accepts integral numeric strings for integer parameters", () => {
        expect(resolveParams(schema, {}, { size: "4" })).toMatchObject({
            params: { size: 4 },
            errors: []
        });
    });

    test("accepts minimum/maximum as aliases for min/max", () => {
        expect(resolveParams(schema, { size: 0 }).errors[0]).toMatchObject({
            code: "PARAM_INVALID",
            key: "size"
        });
        expect(resolveParams(schema, { size: 11 }).errors[0]).toMatchObject({
            code: "PARAM_INVALID",
            key: "size"
        });
        expect(resolveParams(schema, { size: 10 }).errors).toEqual([]);
    });

    test("rejects type, enum and bound violations but keeps the previous value", () => {
        const { params, errors } = resolveParams(
            schema,
            { risk: 2 },
            { risk: "not-a-number", mode: "unknown", size: 99 }
        );
        expect(params.risk).toBe(2); // invalid override does not clobber saved value
        const codes = errors.map((e) => e.code);
        expect(codes).toEqual(["PARAM_INVALID", "PARAM_INVALID", "PARAM_INVALID"]);
        expect(errors.map((e) => e.key)).toEqual(["risk", "mode", "size"]);
    });

    test("required parameters must be present after merging", () => {
        const { errors } = resolveParams({ token: { type: "string", required: true } }, {}, {});
        expect(errors).toEqual([expect.objectContaining({ code: "PARAM_REQUIRED", key: "token" })]);
    });

    test("unknown override keys are errors", () => {
        const { params, errors } = resolveParams(schema, {}, { bogus: 1 });
        expect(params).toEqual({ risk: 1, mode: "safe", size: 2 });
        expect(errors).toEqual([
            expect.objectContaining({ code: "PARAM_UNKNOWN", key: "bogus" })
        ]);
    });

    test("stale saved keys are only warnings and are dropped", () => {
        const { params, errors, warnings } = resolveParams(schema, { removed: 42 }, {});
        expect(errors).toEqual([]);
        expect(warnings).toEqual([
            expect.objectContaining({ code: "PARAM_STALE", key: "removed" })
        ]);
        expect(params).not.toHaveProperty("removed");
    });

    test("ParamResolutionError carries the first code and is non-retryable", () => {
        const err = new ParamResolutionError([{ code: "PARAM_UNKNOWN", key: "x", message: "bad" }]);
        expect(err.code).toBe("PARAM_UNKNOWN");
        expect(err.retryable).toBe(false);
        expect(err.errors).toHaveLength(1);
    });
});
