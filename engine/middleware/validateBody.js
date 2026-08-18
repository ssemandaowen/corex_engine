"use strict";

function validateBody(schema) {
    return (req, res, next) => {
        if (!schema || typeof schema !== "object") {
            return res.status(500).json({ success: false, error: "SERVER_ERROR", message: "validateBody requires a schema object" });
        }

        const errors = [];
        const body = req.body || {};

        for (const [key, rule] of Object.entries(schema)) {
            const val = body[key];

            if (rule.required && (val === undefined || val === null || val === "")) {
                errors.push(`${key} is required`);
                continue;
            }

            if (val !== undefined && val !== null && rule.type && typeof val !== rule.type) {
                errors.push(`${key} must be of type ${rule.type}`);
            }

            if (val !== undefined && val !== null && rule.enum && !rule.enum.includes(val)) {
                errors.push(`${key} must be one of: ${rule.enum.join(", ")}`);
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: "VALIDATION_ERROR", details: errors });
        }

        next();
    };
}

module.exports = validateBody;
