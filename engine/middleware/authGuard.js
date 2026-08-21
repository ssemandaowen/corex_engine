"use strict";

/**
 * CoreX Auth Guard
 *
 * Single authentication path:
 *   Bearer JWT token (web UI sessions)
 *   → decode JWT → check expiry → check corex_sessions for revocation → attach req.user
 *
 * A revoked JWT (user signed out) returns 401 even if the token is not expired.
 */

const logger     = require("@utils/logger");
const db         = require("@core/services/postgres");
const { verifyToken } = require("@core/services/authService");

// ─────────────────────────────────────────────────────────────────────────────
// Token extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

function readBearerToken(req) {
    const header = req.headers.authorization;
    if (!header || typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT session validation (checks corex_sessions table)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a JWT and check it has not been revoked in corex_sessions.
 * Updates last_seen on valid sessions.
 *
 * @param {string} token
 * @returns {object} payload with { sub, role, email, sessionId }
 * @throws {Error} if token is invalid, expired, or session is revoked
 */
async function verifyJwtWithSession(token) {
    // Step 1: decode and verify signature + expiry
    const payload = verifyToken(token);  // throws if invalid or expired

    // Step 2: check session revocation if the token has a sessionId
    if (payload.sessionId && db.hasDbConfig()) {
        try {
            const { rows } = await db.query(
                `SELECT id, revoked_at FROM corex_sessions
                 WHERE session_id = $1 AND user_id = $2
                 LIMIT 1`,
                [payload.sessionId, payload.sub]
            );

            if (!rows.length) {
                // Session not found — may have been deleted or never created
                // Treat as revoked for security
                throw new Error("SESSION_NOT_FOUND");
            }

            if (rows[0].revoked_at) {
                throw new Error("SESSION_REVOKED");
            }

            // Update last_seen asynchronously — do not block the request
            db.query(
                `UPDATE corex_sessions SET last_seen = NOW()
                 WHERE session_id = $1`,
                [payload.sessionId]
            ).catch(() => {});

        } catch (err) {
            // Only re-throw session-specific errors; DB errors fall through
            if (err.message === "SESSION_NOT_FOUND" || err.message === "SESSION_REVOKED") {
                throw err;
            }
            // If DB is unavailable, log and allow (degrade gracefully)
            logger.warn(`[authGuard] Session DB check failed: ${err.message} — allowing token-only auth`);
        }
    }

    return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main middleware
// ─────────────────────────────────────────────────────────────────────────────

async function authGuard(req, res, next) {
    const token = readBearerToken(req);
    if (token) {
        try {
            const payload = await verifyJwtWithSession(token);
            req.user = {
                sub:       payload.sub,
                role:      payload.role,
                email:     payload.email,
                sessionId: payload.sessionId,
            };
            return next();
        } catch (err) {
            const msg = err.message || "";
            if (msg === "SESSION_REVOKED" || msg === "SESSION_NOT_FOUND") {
                logger.warn(`[authGuard] Revoked session attempt from ${req.ip}`);
                return res.status(401).json({ success: false, error: "SESSION_REVOKED" });
            }
        }
    }

    logger.warn(`[authGuard] Unauthorized access attempt from ${req.ip} ${req.method} ${req.path}`);
    return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
}

/**
 * Extract and validate token without Express req/res (used by WS upgrade handler).
 * @param {string} token - raw JWT string
 * @returns {object} user payload
 * @throws if invalid/expired/revoked
 */
async function validateTokenForWs(token) {
    if (!token) throw new Error("NO_TOKEN");
    return verifyJwtWithSession(token);
}

module.exports = authGuard;
module.exports.validateTokenForWs = validateTokenForWs;