"use strict";

const ParamSchema = require("../../src/ParamSchema");
const StrategyParamUtils = require("../../src/StrategyParamUtils");
const ParamResolver = require("../../src/ParamResolver");
const params = require("../../src/params");

describe("parameter compatibility façades delegate to src/params", () => {
    test("ParamResolver is a compatibility entry point for the shared resolver", () => {
        const schema = { period: { type: "integer", default: 5 } };
        expect(ParamResolver.resolveParams(schema, { period: 6 }, { period: 7 }))
            .toEqual(params.resolve(schema, { period: 6 }, { period: 7 }));
        expect(ParamResolver.ParamResolutionError).toBe(params.ParamResolutionError);
    });

    test("ParamSchema delegates static collection, defaults, serialization and patches", () => {
        class Parent {}
        Parent.params = { period: { type: "integer", default: 8 }, mode: "safe" };
        class Child extends Parent {}
        Child.params = { period: { type: "integer", default: 5 } };

        const collected = ParamSchema.collectFromClass(Child);
        expect(collected).toEqual({ period: { type: "integer", default: 5 }, mode: "safe" });
        const schema = ParamSchema.toSchema(collected);
        expect(ParamSchema.applyDefaults({}, schema)).toEqual({ period: 5, mode: "safe" });
        expect(ParamSchema.serialize(schema)).toEqual(params.serializeSchema(schema));
        expect(ParamSchema.applyPatch({ period: 5 }, { period: 6 }, schema))
            .toEqual(params.applyPatch({ period: 5 }, { period: 6 }, schema));
    });

    test("StrategyParamUtils is a thin compatibility façade with no updateParams mixin", () => {
        expect(StrategyParamUtils.updateParams).toBeUndefined();
        expect(StrategyParamUtils.serializeSchema).toBe(params.serializeSchema);
        expect(StrategyParamUtils.applyParamPatch).toBe(params.applyPatch);
        expect(StrategyParamUtils.diffParams).toBe(params.diffParams);
    });
});
