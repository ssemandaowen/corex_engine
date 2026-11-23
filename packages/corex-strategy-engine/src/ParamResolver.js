"use strict";

// Backward-compatible public entry point. The parameter contract is owned by
// ./params; this file remains for existing engine imports.
const { resolve } = require("./params/resolve");
const { ParamResolutionError } = require("./params/errors");

function resolveParams(schema, saved = {}, overrides = {}) {
    return resolve(schema, saved, overrides);
}

module.exports = { resolveParams, ParamResolutionError };
