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

module.exports = StrategyParamUtils;
