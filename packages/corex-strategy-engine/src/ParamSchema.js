"use strict";

const StrategyParamUtils = require("@utils/strategy/StrategyParamUtils");

function collectStaticParams(StrategyClass, stopAt) {
    let curr = StrategyClass;
    let result = {};
    while (curr && curr !== stopAt && curr !== Object) {
        if (curr.params) {
            result = Object.assign({}, curr.params, result);
        }
        curr = Object.getPrototypeOf(curr);
    }
    return result;
}

function normalizeParamSpec(spec) {
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
        return { default: spec };
    }
    return { ...spec };
}

function toSchema(staticParams) {
    if (!staticParams || typeof staticParams !== "object") return {};
    const schema = {};
    for (const [key, def] of Object.entries(staticParams)) {
        schema[key] = normalizeParamSpec(def);
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
        return StrategyParamUtils.serializeSchema(schema);
    }

    static applyDefaults(params, schema) {
        const result = Object.assign({}, params);
        for (const [key, spec] of Object.entries(schema || {})) {
            if (result[key] === undefined && spec.default !== undefined) {
                const def = spec.default;
                if (def && typeof def === "object" && !Array.isArray(def)) {
                    try {
                        result[key] = JSON.parse(JSON.stringify(def));
                    } catch (_) {
                        result[key] = def;
                    }
                } else {
                    result[key] = def;
                }
            }
        }
        return result;
    }

    static applyPatch(params, patch, schema) {
        const result = StrategyParamUtils.applyParamPatch(params, patch, schema);
        return result;
    }

    static diffParams(currentParams, newParams, schema) {
        return StrategyParamUtils.diffParams(currentParams, newParams, schema);
    }
}

ParamSchema.serializeSchema = StrategyParamUtils.serializeSchema;
ParamSchema.applyParamPatch = StrategyParamUtils.applyParamPatch;
ParamSchema.diffParams = StrategyParamUtils.diffParams;

module.exports = ParamSchema;
module.exports.collectStaticParams = collectStaticParams;
module.exports.toSchema = toSchema;
module.exports.normalizeParamSpec = normalizeParamSpec;
