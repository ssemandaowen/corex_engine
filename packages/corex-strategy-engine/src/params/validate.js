"use strict";

const { normalizeSpec } = require("./spec");
const { ConfigError } = require("./errors");

function fail(key, message, code = "PARAM_INVALID", details = {}) {
    throw new ConfigError(key, message, code, details);
}

function coerceBoolean(value) {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return null;
}

/**
 * Validate one value using the shared parameter contract.
 * mode="strict" throws ConfigError; mode="patch" returns a structured invalid result.
 * Numeric step values snap to the nearest step before bounds are checked.
 */
function validateValue(rawSpec, rawValue, options = {}) {
    const { key = "parameter", mode = "strict" } = options;
    if (mode !== "strict" && mode !== "patch") throw new TypeError(`Unknown validation mode '${mode}'`);
    const spec = normalizeSpec(rawSpec);
    const type = spec.type;
    let value = rawValue;

    const invalid = (message, code = "PARAM_INVALID") => {
        const error = new ConfigError(key, message, code);
        if (mode === "strict") throw error;
        return { valid: false, value: undefined, error };
    };

    if (["integer", "number", "float"].includes(type)) {
        if (rawValue === "" || rawValue == null || !Number.isFinite(Number(rawValue))) {
            return invalid(`Parameter '${key}' must be a valid ${type}`);
        }
        value = Number(rawValue);
        if (type === "integer" && !Number.isInteger(value)) {
            return invalid(`Parameter '${key}' must be an integer; fractional values are rejected`);
        }
        if (typeof spec.step === "number" && Number.isFinite(spec.step) && spec.step > 0) {
            value = Math.round(value / spec.step) * spec.step;
            value = Number(value.toPrecision(14));
            if (type === "integer" && !Number.isInteger(value)) {
                return invalid(`Parameter '${key}' step snapping produced a fractional integer`);
            }
        }
    } else if (type === "boolean") {
        value = coerceBoolean(rawValue);
        if (value === null) return invalid(`Parameter '${key}' must be a valid boolean`);
    } else if (type === "string") {
        value = rawValue == null ? rawValue : String(rawValue);
    } else if (type === "array") {
        if (!Array.isArray(rawValue)) return invalid(`Parameter '${key}' must be an array`);
    } else if (type === "object") {
        if (rawValue === null || typeof rawValue !== "object" || Array.isArray(rawValue)) {
            return invalid(`Parameter '${key}' must be an object`);
        }
    } else {
        return invalid(`Parameter '${key}' has unsupported type '${type}'`);
    }

    if (Array.isArray(spec.enum) && !spec.enum.some((entry) => entry === value)) {
        return invalid(`Parameter '${key}' must be one of: ${spec.enum.join(", ")}`);
    }

    if (["integer", "number", "float"].includes(type)) {
        if (typeof spec.min === "number" && value < spec.min) {
            return invalid(`Parameter '${key}' (${value}) is below minimum ${spec.min}`);
        }
        if (typeof spec.max === "number" && value > spec.max) {
            return invalid(`Parameter '${key}' (${value}) exceeds maximum ${spec.max}`);
        }
    }

    if (type === "string" && value != null) {
        const stringValue = String(value);
        if (typeof spec.minLength === "number" && stringValue.length < spec.minLength) {
            return invalid(`Parameter '${key}' is shorter than ${spec.minLength} characters`);
        }
        if (typeof spec.maxLength === "number" && stringValue.length > spec.maxLength) {
            return invalid(`Parameter '${key}' is longer than ${spec.maxLength} characters`);
        }
        if (spec.pattern) {
            try {
                const pattern = spec.pattern instanceof RegExp ? spec.pattern : new RegExp(String(spec.pattern));
                pattern.lastIndex = 0;
                if (!pattern.test(stringValue)) return invalid(`Parameter '${key}' does not match pattern ${spec.pattern}`);
            } catch (error) {
                if (error instanceof ConfigError) throw error;
            }
        }
    }

    return mode === "patch" ? { valid: true, value } : value;
}

module.exports = { validateValue };
