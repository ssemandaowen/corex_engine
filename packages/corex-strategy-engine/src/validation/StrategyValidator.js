"use strict";

const path = require("path");
const {
    ENTRYPOINT_METHODS,
    CORE_METHOD_MANIFEST,
    getIndicatorNameSet,
    getIndicatorNameLowerSet
} = require("./StrategyManifest");
const { Strategy } = require("../Strategy");

const NUMERIC_TYPES = new Set(["integer", "number", "float"]);

class StrategyValidator {
    static validate(StrategyClass, options = {}) {
        const errors = [];
        const warnings = [];
        const info = [];

        const result = () => ({
            valid: errors.length === 0,
            errors,
            warnings,
            info,
            summary: this._generateSummary(errors, warnings, info),
        });

        if (typeof StrategyClass !== "function") {
            errors.push(this._issue("INVALID_CLASS", "Strategy must be a class or constructor function", "error"));
            return result();
        }

        if (!this._extendsBaseStrategy(StrategyClass)) {
            errors.push(
                this._issue("MISSING_INHERITANCE", "Strategy must extend Strategy", "error", {
                    fix: "class MyStrategy extends Strategy { ... }",
                })
            );
        }

        let instance;
        try {
            instance = new StrategyClass();
        } catch (err) {
            errors.push(
                this._issue("INSTANTIATION_FAILED", `Failed to instantiate strategy: ${err.message}`, "error", {
                    details: err.stack,
                })
            );
            return result();
        }

        try {
            this._validateProperties(instance, errors, warnings, info);
            this._validateMethods(instance, errors, warnings, info);
            this._validateSchema(instance, warnings, info);
            this._validateIndicatorUsage(StrategyClass, warnings, info);
            this._checkAntiPatterns(StrategyClass, errors, warnings);
            this._checkBestPractices(StrategyClass, warnings, info);
            if (options.checkPerformance) this._checkPerformance(instance, warnings);
        } catch (err) {
            errors.push(
                this._issue("VALIDATION_ERROR", `Validation failed: ${err.message}`, "error", {
                    details: err.stack,
                })
            );
        }

        return result();
    }

    static _issue(code, message, severity = "warning", extra = {}) {
        return { code, message, severity, ...extra };
    }

    static _extendsBaseStrategy(StrategyClass) {
        return (
            StrategyClass === Strategy ||
            StrategyClass.prototype instanceof Strategy
        );
    }

    static _validateProperties(instance, errors, warnings, info) {
        if (!Array.isArray(instance.symbols)) {
            errors.push(
                this._issue("INVALID_SYMBOLS", "Strategy must define symbols as an array", "error", {
                    fix: "symbols: [\"BTC/USD\"]",
                })
            );
        } else if (instance.symbols.length === 0) {
            errors.push(
                this._issue("EMPTY_SYMBOLS", "Strategy must define at least one symbol", "error", {
                    fix: "symbols: [\"BTC/USD\"]",
                })
            );
        } else {
            info.push(this._issue("SYMBOLS_OK", `Strategy defines ${instance.symbols.length} symbol(s): ${instance.symbols.join(", ")}`, "info"));
        }

        if (!instance.name || typeof instance.name !== "string") {
            warnings.push(
                this._issue("MISSING_NAME", "Strategy should define a name", "warning", {
                    fix: "name: \"my_strategy\"",
                })
            );
        } else {
            info.push(this._issue("NAME_OK", `Strategy name: ${instance.name}`, "info"));
        }

        if (!instance.timeframe) {
            warnings.push(
                this._issue("MISSING_TIMEFRAME", "Strategy should define a timeframe", "warning", {
                    fix: "timeframe: \"15m\"",
                })
            );
        } else {
            info.push(this._issue("TIMEFRAME_OK", `Strategy timeframe: ${instance.timeframe}`, "info"));
        }

        if (!Number.isFinite(instance.lookback) || instance.lookback <= 0) {
            errors.push(
                this._issue("INVALID_LOOKBACK", "Strategy lookback must be a positive finite number", "error", {
                    fix: "lookback: 100",
                })
            );
        } else if (instance.lookback > 100000) {
            errors.push(
                this._issue("EXCESSIVE_LOOKBACK", `Strategy lookback (${instance.lookback}) exceeds maximum allowed limit (100000)`, "error", {
                    fix: "Reduce lookback to <= 100000",
                })
            );
        } else if (instance.lookback < 10) {
            warnings.push(
                this._issue("LOW_LOOKBACK", `Lookback period (${instance.lookback}) is very low, may cause indicator issues`, "warning", {
                    fix: "Consider increasing lookback to at least 50-100",
                })
            );
        } else {
            info.push(this._issue("LOOKBACK_OK", `Strategy lookback: ${instance.lookback}`, "info"));
        }

        if (instance.__corexStandardized) {
            info.push(this._issue("STANDARDIZED", "Strategy follows CoreX standardization", "info"));
        }
    }

    static _validateMethods(instance, errors, warnings, info) {
        const availableEntrypoints = ENTRYPOINT_METHODS.filter((name) => typeof instance[name] === "function");
        if (availableEntrypoints.length === 0) {
            errors.push(
                this._issue("MISSING_ENTRYPOINT", `Strategy must implement at least one entrypoint: ${ENTRYPOINT_METHODS.join(", ")}`, "error", {
                    fix: "Implement onBar(ctx, bar) { return null; } or onTick(ctx, tick) { return null; }",
                })
            );
        } else {
            info.push(this._issue("ENTRYPOINT_OK", `Strategy entrypoints available: ${availableEntrypoints.join(", ")}`, "info"));
        }

        if (typeof instance._applyDefaults !== "function") {
            warnings.push(
                this._issue("MISSING__APPLYDEFAULTS", "Strategy should implement _applyDefaults to apply schema defaults", "warning", {
                    fix: "_applyDefaults() { ... }",
                })
            );
        } else {
            info.push(this._issue("APPLYDEFAULTS_OK", "Strategy implements _applyDefaults()", "info"));
        }

        for (const method of ["generateSignal", "onMarketData", "onBar", "onTick"]) {
            if (typeof instance[method] === "function") {
                info.push(this._issue("CONTRACT_METHOD", `Strategy implements ${method}() method`, "info"));
            }
        }

        const helperMethods = [
            "isWarmedUp",
            ...CORE_METHOD_MANIFEST.map((m) => m.label),
        ];
        const available = helperMethods.filter((name) => typeof instance[name] === "function");
        if (available.length > 0) {
            info.push(this._issue("HELPERS_AVAILABLE", `${available.length} helper methods available`, "info"));
        }
    }

    static _validateIndicatorUsage(StrategyClass, warnings, info) {
        const src = String(StrategyClass || "");
        const indicatorMatches = [...src.matchAll(/this\.indicators\.([A-Za-z_][A-Za-z0-9_]*)/g)];
        if (indicatorMatches.length === 0) return;

        const used = Array.from(new Set(indicatorMatches.map((m) => m[1])));
        const known = getIndicatorNameSet();
        const knownLower = getIndicatorNameLowerSet();

        used.forEach((name) => {
            if (known.has(name)) {
                info.push(this._issue("INDICATOR_USED", `Uses indicator: ${name}`, "info"));
                return;
            }
            const lowered = String(name).toLowerCase();
            if (knownLower.has(lowered)) {
                warnings.push(
                    this._issue("INDICATOR_CASE_MISMATCH", `Indicator '${name}' has casing mismatch`, "warning", {
                        fix: `Use correct casing.`,
                    })
                );
                return;
            }
            warnings.push(
                this._issue("UNKNOWN_INDICATOR", `Indicator '${name}' is not exported by technicalindicators`, "warning", {
                    fix: "Use a valid indicator name.",
                })
            );
        });
    }

    static _validateSchema(instance, warnings, info) {
        if (!instance.schema || typeof instance.schema !== "object") {
            warnings.push(
                this._issue("MISSING_SCHEMA", "Strategy should define a parameter schema", "warning", {
                    fix: "this.schema = { period: { type: \"integer\", min: 2, max: 200, default: 20 } };",
                })
            );
            return;
        }

        const keys = Object.keys(instance.schema);
        if (keys.length === 0) {
            warnings.push(this._issue("EMPTY_SCHEMA", "Strategy schema is empty"));
            return;
        }

        info.push(this._issue("SCHEMA_OK", `Strategy defines ${keys.length} parameter(s): ${keys.join(", ")}`, "info"));

        for (const key of keys) {
            const spec = instance.schema[key];
            if (!spec || typeof spec !== "object") {
                warnings.push(this._issue("INVALID_SCHEMA_ENTRY", `Schema entry '${key}' is invalid`));
                continue;
            }

            if (!spec.type) {
                warnings.push(this._issue("MISSING_TYPE", `Schema entry '${key}' missing type`, "warning", {
                    fix: `${key}: { type: "integer", ... }`,
                }));
            }

            if (spec.default === undefined) {
                warnings.push(this._issue("MISSING_DEFAULT", `Schema entry '${key}' missing default value`, "warning", {
                    fix: `${key}: { ..., default: 20 }`,
                }));
            }

            const specType = spec.type;

            if (Array.isArray(spec.enum) && spec.enum.length > 0) {
                const raw = instance[key];
                if (raw !== undefined) {
                    const ok = spec.enum.some((v) => v === raw);
                    if (!ok) {
                        warnings.push(
                            this._issue("ENUM_VIOLATION", `Parameter '${key}' value ${JSON.stringify(raw)} is not in allowed enum values`, "warning")
                        );
                    }
                }
            }

            if (specType === "array") {
                const raw = instance[key];
                if (raw !== undefined && !Array.isArray(raw)) {
                    warnings.push(
                        this._issue("WRONG_TYPE", `Parameter '${key}' should be type Array but got ${typeof raw}`, "warning")
                    );
                }
            }

            if (NUMERIC_TYPES.has(specType)) {
                if (spec.min === undefined) {
                    warnings.push(this._issue("MISSING_MIN", `Numeric parameter '${key}' should define min value`, "warning"));
                }
                if (spec.max === undefined) {
                    warnings.push(this._issue("MISSING_MAX", `Numeric parameter '${key}' should define max value`, "warning"));
                }

                const val = instance[key];
                if (val !== undefined && typeof val === "number") {
                    if (typeof spec.min === "number" && val < spec.min) {
                        warnings.push(
                            this._issue("BELOW_MIN", `Parameter '${key}' value ${val} is below minimum ${spec.min}`, "warning")
                        );
                    }
                    if (typeof spec.max === "number" && val > spec.max) {
                        warnings.push(
                            this._issue("ABOVE_MAX", `Parameter '${key}' value ${val} exceeds maximum ${spec.max}`, "warning")
                        );
                    }
                }
            }
        }
    }

    static _checkAntiPatterns(StrategyClass, errors, warnings) {
        const src = String(StrategyClass);

        if (/throw\s+new\s+Error\s*\(/.test(src) && !/safeRule\s*\(/.test(src)) {
            warnings.push(
                this._issue("UNGUARDED_THROW", "Strategy throws errors without safeRule protection", "warning")
            );
        }

        if (!/isWarmedUp\s*\(/.test(src)) {
            warnings.push(
                this._issue("MISSING_WARMUP_GUARD", "Strategy does not check warmup status", "warning")
            );
        }



        if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(src)) {
            errors.push(
                this._issue("INFINITE_LOOP", "Strategy contains potential infinite loop", "error")
            );
        }
    }

    static _checkBestPractices(StrategyClass, warnings, info) {
        const src = String(StrategyClass);

        if (!/\/\*\*/.test(src)) {
            warnings.push(
                this._issue("MISSING_JSDOC", "Strategy lacks JSDoc documentation", "warning")
            );
        }

        if (/this\.log\./.test(src)) {
            info.push(this._issue("USES_LOGGING", "Strategy includes logging (best practice)", "info"));
        }
    }

    static _checkPerformance(instance, warnings) {
        if (Number.isFinite(instance.lookback) && instance.lookback > 1000) {
            warnings.push(
                this._issue("LARGE_LOOKBACK", `Large lookback period (${instance.lookback}) may impact performance`, "warning")
            );
        }
    }

    static _generateSummary(errors, warnings, info) {
        const total = errors.length + warnings.length + info.length;
        return {
            total,
            errors: errors.length,
            warnings: warnings.length,
            info: info.length,
            status: errors.length === 0 ? "PASS" : "FAIL",
            grade: this._calculateGrade(errors.length, warnings.length),
        };
    }

    static _calculateGrade(errorCount, warningCount) {
        if (errorCount > 0) return "F";
        const score = Math.max(0, 100 - warningCount * 5);
        if (score >= 95) return "A+";
        if (score >= 90) return "A";
        if (score >= 85) return "B+";
        if (score >= 80) return "B";
        if (score >= 75) return "C+";
        if (score >= 70) return "C";
        if (score >= 65) return "D";
        return "F";
    }

    static formatResult(result) {
        const summary = result?.summary || { status: "FAIL", grade: "F", total: 0, errors: 0, warnings: 0, info: 0 };
        const lines = [
            "=".repeat(60),
            "CoreX Strategy Validation Report",
            "=".repeat(60),
            "",
            `Status: ${summary.status}`,
            `Grade: ${summary.grade}`,
            `Total Issues: ${summary.total}`,
            `  - Errors: ${summary.errors}`,
            `  - Warnings: ${summary.warnings}`,
            `  - Info: ${summary.info}`,
            "",
        ];

        this._appendIssues(lines, "ERRORS", result.errors);
        this._appendIssues(lines, "WARNINGS", result.warnings);
        this._appendIssues(lines, "INFO", result.info, false);

        lines.push("=".repeat(60));
        return lines.join("\n");
    }

    static _appendIssues(lines, title, issues, withFix = true) {
        if (!Array.isArray(issues) || issues.length === 0) return;
        lines.push(`${title}:`);
        lines.push("-".repeat(60));
        issues.forEach((item, idx) => {
            lines.push(`${idx + 1}. [${item.code}] ${item.message}`);
            if (withFix && item.fix) lines.push(`   Fix: ${item.fix}`);
            lines.push("");
        });
    }

    static async validateFile(filePath) {
        const absolutePath = path.resolve(filePath);
        try {
            delete require.cache[require.resolve(absolutePath)];
            let loaded = require(absolutePath);
            if (loaded && typeof loaded === "object" && typeof loaded.default === "function") {
                loaded = loaded.default;
            }

            const result = this.validate(loaded);
            result.file = absolutePath;
            return result;
        } catch (err) {
            return {
                valid: false,
                file: absolutePath,
                errors: [
                    this._issue("FILE_ERROR", `Failed to load strategy file: ${err.message}`, "error", {
                        details: err.stack,
                    }),
                ],
                warnings: [],
                info: [],
                summary: { total: 1, errors: 1, warnings: 0, info: 0, status: "FAIL", grade: "F" },
            };
        }
    }
}

StrategyValidator.DEFAULT_VALIDATION_OPTS = { checkPerformance: true };

module.exports = StrategyValidator;
