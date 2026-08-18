"use strict";

const StrategyParamUtils = {
    _applyDefaults() {
        for (const [key, spec] of Object.entries(this.schema || {})) {
            const def = spec && Object.prototype.hasOwnProperty.call(spec, "default") ? spec.default : null;
            // Avoid shared object references between strategy instances.
            if (def && typeof def === "object") {
                try { this.params[key] = JSON.parse(JSON.stringify(def)); } catch { this.params[key] = def; }
            } else {
                this.params[key] = def;
            }
        }
    },

    updateParams(newParams = {}) {
        if (!newParams || typeof newParams !== "object" || Array.isArray(newParams)) return;

        let changed = false;
        for (const [key, raw] of Object.entries(newParams)) {
            let spec = this.schema?.[key];
            if (!spec && this.params && Object.prototype.hasOwnProperty.call(this.params, key)) {
                const current = this.params[key];
                spec = { type: Number.isInteger(current) ? "integer" : typeof current };
            }
            if (!spec) continue;

            let val = raw;
            let valid = true;
            const specType = String(spec.type || "string").toLowerCase();
            const enumValues = Array.isArray(spec.enum) ? spec.enum : null;

            switch (specType) {
            case "boolean":
                val = this._coerceBoolean(raw);
                if (val === null) valid = false;
                break;
            case "integer":
                val = this._coerceNumber(raw, true);
                if (val === null) valid = false;
                break;
            case "number":
            case "float":
                val = this._coerceNumber(raw, false);
                if (val === null) valid = false;
                break;
            default:
                if (raw == null) val = raw;
                else val = String(raw);
                break;
            }

            if (valid && enumValues) {
                const ok = enumValues.some((v) => v === val);
                if (!ok) valid = false;
            }

            if (valid && ["number", "float", "integer"].includes(specType)) {
                if (typeof spec.min === "number" && val < spec.min) valid = false;
                if (typeof spec.max === "number" && val > spec.max) valid = false;
                if (valid && typeof spec.step === "number" && Number.isFinite(spec.step) && spec.step > 0) {
                    const step = Number(spec.step);
                    const snapped = Math.round(Number(val) / step) * step;
                    val = specType === "integer" ? Math.trunc(snapped) : snapped;
                }
            }

            if (valid && specType === "string") {
                if (typeof spec.minLength === "number" && String(val || "").length < spec.minLength) valid = false;
                if (typeof spec.maxLength === "number" && String(val || "").length > spec.maxLength) valid = false;
                if (spec.pattern) {
                    try {
                        const re = spec.pattern instanceof RegExp ? spec.pattern : new RegExp(String(spec.pattern));
                        if (!re.test(String(val || ""))) valid = false;
                    } catch {
                        // Ignore invalid patterns (schema bug), don't reject user input for it.
                    }
                }
            }

            if (!valid) continue;
            const prev = this.params[key];
            if (prev !== val && !(Number.isNaN(prev) && Number.isNaN(val))) {
                this.params[key] = val;
                changed = true;
            }
        }
        if (changed) this.log?.info("Strategy parameters updated", { id: this.id });
    },

    _coerceBoolean(v) {
        if (typeof v === "boolean") return v;
        if (v === "true" || v === "1" || v === 1) return true;
        if (v === "false" || v === "0" || v === 0) return false;
        return null;
    },

    _coerceNumber(v, integer = false) {
        const n = Number(v);
        if (!Number.isFinite(n) || v === "" || v == null) return null;
        return integer ? Math.trunc(n) : n;
    }
};

/**
 * serializeSchema(schema)
 * 
 * Converts defineSchema() output to a flat UI-renderable array.
 * Each schema entry is standardized to include label and description for UI rendering.
 * 
 * @param {Object} schema - Schema object { key: { default, type, min?, max?, step?, label?, description? } }
 * @returns {Array<Object>} Array of { key, default, type, min, max, step, label, description }
 */
function serializeSchema(schema) {
    if (!schema || typeof schema !== "object") return [];
    
    return Object.entries(schema).map(([key, spec]) => ({
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

/**
 * applyParamPatch(params, patch, schema)
 * 
 * Validates patch against schema types and applies it to params object.
 * Returns a validation result with applied changes or errors.
 * 
 * @param {Object} params - Current params object
 * @param {Object} patch - Partial params to update
 * @param {Object} schema - Schema to validate against
 * @returns {Object} { valid: boolean, applied: Object, errors: Object }
 */
function applyParamPatch(params, patch, schema) {
    const result = {
        valid: true,
        applied: {},
        errors: {}
    };

    if (!patch || typeof patch !== "object") {
        result.valid = false;
        result.errors.patch = "Patch must be an object";
        return result;
    }

    for (const [key, value] of Object.entries(patch)) {
        const spec = schema?.[key];
        
        // Allow patching unknown keys if no schema exists for validation
        if (!spec && !schema) {
            result.applied[key] = value;
            continue;
        }
        
        if (!spec) {
            result.errors[key] = `No schema definition for parameter '${key}'`;
            result.valid = false;
            continue;
        }

        let coercedValue = value;
        let valid = true;
        const specType = String(spec.type || "string").toLowerCase();

        // Type coercion and validation
        switch (specType) {
        case "boolean": {
            if (typeof value === "boolean") {
                coercedValue = value;
            } else if (value === "true" || value === "1" || value === 1) {
                coercedValue = true;
            } else if (value === "false" || value === "0" || value === 0) {
                coercedValue = false;
            } else {
                valid = false;
            }
            break;
        }
        case "integer": {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                valid = false;
            } else {
                coercedValue = Math.trunc(n);
            }
            break;
        }
        case "number":
        case "float": {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                valid = false;
            } else {
                coercedValue = n;
            }
            break;
        }
        default: {
            coercedValue = String(value ?? "");
            break;
        }
        }

        // Range validation for numbers
        if (valid && ["number", "float", "integer"].includes(specType)) {
            if (typeof spec.min === "number" && coercedValue < spec.min) {
                valid = false;
                result.errors[key] = `Value ${coercedValue} is below minimum ${spec.min}`;
            }
            if (valid && typeof spec.max === "number" && coercedValue > spec.max) {
                valid = false;
                result.errors[key] = `Value ${coercedValue} exceeds maximum ${spec.max}`;
            }
        }

        // String validation
        if (valid && specType === "string") {
            if (typeof spec.minLength === "number" && String(coercedValue).length < spec.minLength) {
                valid = false;
                result.errors[key] = `String length ${String(coercedValue).length} is below minimum ${spec.minLength}`;
            }
            if (valid && typeof spec.maxLength === "number" && String(coercedValue).length > spec.maxLength) {
                valid = false;
                result.errors[key] = `String length ${String(coercedValue).length} exceeds maximum ${spec.maxLength}`;
            }
            if (valid && spec.pattern) {
                try {
                    const re = spec.pattern instanceof RegExp ? spec.pattern : new RegExp(String(spec.pattern));
                    if (!re.test(String(coercedValue))) {
                        valid = false;
                        result.errors[key] = `Value does not match pattern ${spec.pattern}`;
                    }
                } catch (err) {
                    // Invalid regex in schema, don't reject user input
                }
            }
        }

        // Enum validation
        if (valid && Array.isArray(spec.enum)) {
            if (!spec.enum.some(v => v === coercedValue)) {
                valid = false;
                result.errors[key] = `Value must be one of: ${spec.enum.join(", ")}`;
            }
        }

        if (!valid) {
            result.valid = false;
        } else {
            result.applied[key] = coercedValue;
        }
    }

    return result;
}

/**
 * diffParams(currentParams, newParams, schema)
 * 
 * Returns only the keys that have changed between currentParams and newParams,
 * along with their old and new values.
 * 
 * @param {Object} currentParams - Current parameter values
 * @param {Object} newParams - New parameter values to compare
 * @param {Object} [schema] - Optional schema for type hints
 * @returns {Object} { changed: boolean, diff: { key: { old, new }, ... } }
 */
function diffParams(currentParams, newParams, schema) {
    const result = {
        changed: false,
        diff: {}
    };

    if (!newParams || typeof newParams !== "object") {
        return result;
    }

    const keysToCheck = new Set([
        ...Object.keys(currentParams || {}),
        ...Object.keys(newParams || {})
    ]);

    for (const key of keysToCheck) {
        const old = currentParams?.[key];
        const neu = newParams?.[key];

        // Deep equality check for objects
        let isEqual = old === neu;
        if (!isEqual && typeof old === "object" && typeof neu === "object") {
            try {
                isEqual = JSON.stringify(old) === JSON.stringify(neu);
            } catch {
                // If stringify fails, they're different
                isEqual = false;
            }
        }

        if (!isEqual) {
            result.changed = true;
            result.diff[key] = { old, new: neu };
        }
    }

    return result;
}

module.exports = StrategyParamUtils;
module.exports.serializeSchema = serializeSchema;
module.exports.applyParamPatch = applyParamPatch;
module.exports.diffParams = diffParams;
