"use strict";

const { normalizeSchema } = require("./spec");
const { validateValue } = require("./validate");

function applyPatch(params = {}, patch, schema) {
    const result = { valid: true, applied: {}, errors: {} };
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return { valid: false, applied: {}, errors: { patch: "Patch must be an object" } };
    }
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        result.applied = { ...patch };
        return result;
    }
    const specs = normalizeSchema(schema);
    for (const [key, raw] of Object.entries(patch)) {
        const spec = specs[key];
        if (!spec) {
            result.valid = false;
            result.errors[key] = `No schema definition for parameter '${key}'`;
            continue;
        }
        const checked = validateValue(spec, raw, { key, mode: "patch" });
        if (!checked.valid) {
            result.valid = false;
            result.errors[key] = checked.error.message;
        } else {
            result.applied[key] = checked.value;
        }
    }
    return result;
}

module.exports = { applyPatch };
