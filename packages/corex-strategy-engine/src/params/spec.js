"use strict";

function normalizeSpec(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        const type = typeof raw === "number" ? (Number.isInteger(raw) ? "integer" : "number")
            : typeof raw === "boolean" ? "boolean" : "string";
        return { default: raw, type };
    }
    const spec = { ...raw };
    if (spec.min === undefined && spec.minimum !== undefined) spec.min = spec.minimum;
    if (spec.max === undefined && spec.maximum !== undefined) spec.max = spec.maximum;
    if (!spec.type) {
        const value = spec.default;
        if (typeof value === "number") spec.type = Number.isInteger(value) ? "integer" : "number";
        else if (typeof value === "boolean") spec.type = "boolean";
        else spec.type = "string";
    }
    spec.type = String(spec.type).toLowerCase();
    return spec;
}

function normalizeSchema(schema) {
    const result = {};
    for (const [key, raw] of Object.entries(schema || {})) result[key] = normalizeSpec(raw);
    return result;
}

function clone(value) {
    if (value && typeof value === "object") {
        try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
    }
    return value;
}

function serializeSchema(schema) {
    if (!schema || typeof schema !== "object") return [];
    return Object.entries(normalizeSchema(schema)).map(([key, spec]) => ({
        key,
        default: spec.default ?? null,
        type: spec.type ?? "string",
        min: spec.min,
        max: spec.max,
        step: spec.step,
        label: spec.label ?? key,
        description: spec.description ?? "",
        enum: spec.enum,
        minLength: spec.minLength,
        maxLength: spec.maxLength,
        pattern: spec.pattern
    }));
}

function applyDefaults(params, schema) {
    const result = { ...(params || {}) };
    for (const [key, spec] of Object.entries(normalizeSchema(schema))) {
        if (result[key] === undefined && spec.default !== undefined) {
            result[key] = clone(spec.default);
        }
    }
    return result;
}

function diffParams(currentParams, newParams) {
    const result = { changed: false, diff: {} };
    if (!newParams || typeof newParams !== "object" || Array.isArray(newParams)) return result;

    const keys = new Set([
        ...Object.keys(currentParams || {}),
        ...Object.keys(newParams)
    ]);
    for (const key of keys) {
        const oldValue = currentParams?.[key];
        const newValue = newParams?.[key];
        let equal = oldValue === newValue;
        if (!equal && oldValue && newValue &&
            typeof oldValue === "object" && typeof newValue === "object") {
            try { equal = JSON.stringify(oldValue) === JSON.stringify(newValue); } catch { equal = false; }
        }
        if (!equal) {
            result.changed = true;
            result.diff[key] = { old: oldValue, new: newValue };
        }
    }
    return result;
}

module.exports = {
    normalizeSpec,
    normalizeSchema,
    serializeSchema,
    applyDefaults,
    diffParams
};
