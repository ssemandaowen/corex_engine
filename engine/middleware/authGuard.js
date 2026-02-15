"use strict";

const logger = require("@utils/logger");
const { verifyToken } = require("@core/services/authService");

function readBearerToken(req) {
    const header = req.headers.authorization;
    if (!header || typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

function authGuard(req, res, next) {
    const token = readBearerToken(req);
    if (token) {
        try {
            req.user = verifyToken(token);
            return next();
        } catch {
            // Continue to legacy fallback if enabled
        }
    }

    const allowLegacy = String(process.env.ALLOW_LEGACY_ADMIN_KEY || "true").toLowerCase() === "true";
    const key = req.headers["x-admin-key"];
    if (allowLegacy && process.env.ADMIN_SECRET && key === process.env.ADMIN_SECRET) {
        req.user = { sub: "legacy-admin", role: "admin", legacy: true };
        return next();
    }

    logger.warn(`Unauthorized REST access from ${req.ip}`);
    return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
}

module.exports = authGuard;
