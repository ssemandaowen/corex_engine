"use strict";

/**
 * CoreX Auth Guard
 *
 * Two authentication paths:
 *
 * 1. Bearer JWT token (web UI sessions)
 *    → decode JWT → check expiry → check corex_sessions for revocation → attach req.user
 *
 * 2. API key (x-auth-key header or ApiKey scheme)
 *    → resolve from DB → check status/expiry → cache for TTL → attach req.user
 *
 * The legacy admin key bypass has been removed.
 * A revoked JWT (user signed out) returns 401 even if the token is not expired.
 */

const logger     = require("@utils/logger");
const db         = require("@core/services/postgres");
const pgStore    = require("@core/services/pgStore");
const { verifyToken } = require("@core/services/authService");

// API key cache config
const KEY_CACHE_TTL_MS = Math.max(5_000, Number(process.env.AUTH_KEY_CACHE_TTL_MS || 60_000));
const KEY_CACHE_MAX    = Math.max(100,   Number(process.env.AUTH_KEY_CACHE_MAX    || 5_000));
const keyCache = new Map();

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

function readApiKey(req) {
    const fromHeader = String(req.headers["x-auth-key"] || "").trim();
    if (fromHeader) return fromHeader;
    const header = String(req.headers.authorization || "").trim();
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (String(scheme || "").toLowerCase() === "apikey" && token) return token.trim();
    return null;
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
// API key cache helpers
// ─────────────────────────────────────────────────────────────────────────────

function getCachedApiKeyUser(apiKey) {
    const hit = keyCache.get(apiKey);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
        keyCache.delete(apiKey);
        return null;
    }
    return { user: hit.user, keyId: hit.keyId };
}

function setCachedApiKeyUser(apiKey, user, keyId) {
    if (keyCache.size >= KEY_CACHE_MAX) {
        // Evict oldest entry
        const firstKey = keyCache.keys().next().value;
        if (firstKey) keyCache.delete(firstKey);
    }
    keyCache.set(apiKey, {
        expiresAt: Date.now() + KEY_CACHE_TTL_MS,
        user,
        keyId,
    });
}

async function verifyApiKeyStillActive(keyId) {
    if (!keyId) return false;
    try {
        const { rows } = await db.query(
            "SELECT status, expires_at FROM user_api_keys WHERE id = $1",
            [String(keyId)]
        );
        if (!rows[0]) return false;
        if (String(rows[0].status || "").toLowerCase() !== "active") return false;
        const expiresAt = rows[0].expires_at;
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return false;
        return true;
    } catch {
        return false; // Deny on error
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main middleware
// ─────────────────────────────────────────────────────────────────────────────

async function authGuard(req, res, next) {
    // ── Path 1: JWT Bearer token ─────────────────────────────────────────────
    const token = readBearerToken(req);
    if (token) {
        try {
            const payload = await verifyJwtWithSession(token);
            req.user = {
                sub:       payload.sub,
                role:      payload.role,
                email:     payload.email,
                sessionId: payload.sessionId,
                authType:  "jwt",
            };
            return next();
        } catch (err) {
            const msg = err.message || "";
            if (msg === "SESSION_REVOKED" || msg === "SESSION_NOT_FOUND") {
                logger.warn(`[authGuard] Revoked session attempt from ${req.ip}`);
                return res.status(401).json({ success: false, error: "SESSION_REVOKED" });
            }
            // Token is expired or malformed — fall through to API key
        }
    }

    // ── Path 2: API key ──────────────────────────────────────────────────────
    const apiKey = readApiKey(req);
    if (apiKey) {
        // Check cache first
        const cached = getCachedApiKeyUser(apiKey);
        if (cached) {
            // Always verify revocation — cache only saves the DB lookup, not the status check
            const isActive = await verifyApiKeyStillActive(cached.keyId);
            if (!isActive) {
                keyCache.delete(apiKey);
                logger.warn(`[authGuard] Revoked API key attempt: ${cached.keyId}`);
                return res.status(401).json({ success: false, error: "KEY_REVOKED" });
            }
            req.user = { ...cached.user, authType: "api_key" };
            return next();
        }

        // Not cached — do a full DB lookup
        try {
            const resolved = await pgStore.resolveUserByApiKey(apiKey);
            if (resolved?.user?.id) {
                const userPayload = {
                    sub:      resolved.user.id,
                    role:     resolved.user.role,
                    email:    resolved.user.email,
                    name:     resolved.user.name,
                    keyId:    resolved.keyId,
                    authType: "api_key",
                };
                setCachedApiKeyUser(apiKey, userPayload, resolved.keyId);
                pgStore.touchApiKeyUsage(resolved.keyId).catch(() => {});
                req.user = userPayload;
                return next();
            }
        } catch (err) {
            logger.warn(`[authGuard] API key DB lookup failed: ${err.message}`);
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