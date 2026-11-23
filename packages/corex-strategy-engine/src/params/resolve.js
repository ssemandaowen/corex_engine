"use strict";

const { normalizeSchema } = require("./spec");
const { validateValue } = require("./validate");

function clone(value) {
    if (value && typeof value === "object") {
        try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
    }
    return value;
}

function resolve(schema, saved = {}, overrides = {}) {
    const specs = normalizeSchema(schema);
    const params = {};
    const provenance = {};
    const errors = [];
    const warnings = [];

    for (const [key, spec] of Object.entries(specs)) {
        if (spec.default !== undefined) {
            params[key] = clone(spec.default);
            provenance[key] = "default";
        }
    }

    const apply = (source, label) => {
        if (!source || typeof source !== "object" || Array.isArray(source)) return;
        for (const [key, raw] of Object.entries(source)) {
            const spec = specs[key];
            if (!spec) {
                const entry = {
                    code: label === "override" ? "PARAM_UNKNOWN" : "PARAM_STALE",
                    key,
                    message: label === "override"
                        ? `Unknown parameter '${key}' is not defined by this strategy`
                        : `Stored parameter '${key}' is no longer defined by this strategy and was dropped`
                };
                (label === "override" ? errors : warnings).push(entry);
                continue;
            }
            const result = validateValue(spec, raw, { key, mode: "patch" });
            if (!result.valid) {
                errors.push({ ...result.error.errors[0], source: label });
                continue;
            }
            params[key] = result.value;
            provenance[key] = label;
        }
    };

    apply(saved, "saved");
    apply(overrides, "override");

    for (const [key, spec] of Object.entries(specs)) {
        if (spec.required && (params[key] === undefined || params[key] === null)) {
            errors.push({
                code: "PARAM_REQUIRED",
                key,
                message: `Parameter '${key}' is required`
            });
        }
    }

    return { params, provenance, errors, warnings };
}

module.exports = { resolve };
