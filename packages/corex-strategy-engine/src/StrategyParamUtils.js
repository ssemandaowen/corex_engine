"use strict";

// Compatibility façade for callers that still import StrategyParamUtils.
// Parameter semantics live exclusively under ./params.
const {
    normalizeSpec,
    normalizeSchema,
    serializeSchema,
    applyDefaults,
    diffParams
} = require("./params/spec");
const { applyPatch } = require("./params/patch");

module.exports = {
    normalizeParamSpec: normalizeSpec,
    normalizeSchema,
    serializeSchema,
    applyDefaults,
    applyParamPatch: applyPatch,
    diffParams
};
