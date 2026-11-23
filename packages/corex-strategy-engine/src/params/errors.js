"use strict";

class ParamResolutionError extends Error {
    /**
     * @param {Array<{code: string, key?: string, message: string}>} errors
     */
    constructor(errors = []) {
        const summary = errors.map((entry) => entry.message).filter(Boolean).join("; ");
        super(summary || "Invalid strategy parameters");
        this.name = "ParamResolutionError";
        this.code = errors[0]?.code || "PARAM_INVALID";
        this.errors = errors;
        this.retryable = false;
    }
}

class ConfigError extends ParamResolutionError {
    constructor(key, message, code = "PARAM_INVALID", details = {}) {
        super([{ code, key, message, ...details }]);
        this.name = "ConfigError";
        this.configKey = key;
    }
}

module.exports = { ParamResolutionError, ConfigError };
