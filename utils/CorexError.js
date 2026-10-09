"use strict";

class CorexError extends Error {
    constructor(code, message, { hint, details, status, cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "CorexError";
        this.code = String(code || "UNKNOWN_ERROR");
        this.hint = hint != null ? String(hint) : undefined;
        this.details = details !== undefined ? details : undefined;
        this.status = Number.isInteger(status) ? status : 500;
    }

    toJSON() {
        const json = {
            code: this.code,
            message: this.message
        };
        if (this.hint !== undefined) json.hint = this.hint;
        if (this.details !== undefined) json.details = this.details;
        return json;
    }
}

module.exports = CorexError;
