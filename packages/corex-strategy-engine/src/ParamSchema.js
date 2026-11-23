"use strict";

const { collectStatic } = require("./params/collect");
const {
    normalizeSpec,
    serializeSchema,
    applyDefaults,
    diffParams
} = require("./params/spec");
const { applyPatch } = require("./params/patch");

function collectStaticParams(StrategyClass, stopAt) {
    return collectStatic(StrategyClass, "params", stopAt);
}

function toSchema(staticParams) {
    const schema = {};
    for (const [key, spec] of Object.entries(staticParams || {})) {
        schema[key] = normalizeSpec(spec);
    }
    return schema;
}

class ParamSchema {
    static collectFromClass(StrategyClass, stopAt) {
        return collectStaticParams(StrategyClass, stopAt);
    }

    static toSchema(staticParams) {
        return toSchema(staticParams);
    }

    static serialize(schema) {
        return serializeSchema(schema);
    }

    static applyDefaults(params, schema) {
        return applyDefaults(params, schema);
    }

    static applyPatch(params, patch, schema) {
        return applyPatch(params, patch, schema);
    }

    static diffParams(currentParams, newParams, schema) {
        return diffParams(currentParams, newParams, schema);
    }
}

ParamSchema.serializeSchema = serializeSchema;
ParamSchema.applyParamPatch = applyPatch;
ParamSchema.diffParams = diffParams;

module.exports = ParamSchema;
module.exports.collectStaticParams = collectStaticParams;
module.exports.toSchema = toSchema;
module.exports.normalizeParamSpec = normalizeSpec;
