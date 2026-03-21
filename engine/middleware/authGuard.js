"use strict";

const logger = require("@utils/logger");
const pgStore = require("@core/services/pgStore");
const { verifyToken } = require("@core/services/authService");

const KEY_CACHE_TTL_MS = Math.max(5_000, Number(process.env.AUTH_KEY_CACHE_TTL_MS || 30_000));
const KEY_CACHE_MAX = Math.max(100, Number(process.env.AUTH_KEY_CACHE_MAX || 5000));
const keyCache = new Map();

function readBearerToken(req) {
    const header = req.headers.authorization;
    if (!header || typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

function readApiKey(req) {
    const fromHeader = String(req.headers["x-auth-key"] || "").trim();
    if (fromHeader) return fromHeader;
    const header = String(req.headers.authorization || "").trim();
    if (!header) return "";
    const [scheme, token] = header.split(" ");
    if (String(scheme || "").toLowerCase() === "apikey" && token) return token.trim();
    return "";
}

function getCachedApiKeyUser(apiKey) {
    const hit = keyCache.get(apiKey);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
        keyCache.delete(apiKey);
        return null;
    }
    return hit.user || null;
}

function setCachedApiKeyUser(apiKey, user) {
    if (keyCache.size >= KEY_CACHE_MAX) {
        const firstKey = keyCache.keys().next().value;
        if (firstKey) keyCache.delete(firstKey);
    }
    keyCache.set(apiKey, {
        expiresAt: Date.now() + KEY_CACHE_TTL_MS,
        user
    });
}

async function authGuard(req, res, next) {
    const token = readBearerToken(req);
    if (token) {
        try {
            req.user = verifyToken(token);
            return next();
        } catch {
            // Continue to API key fallback if token is expired/invalid
        }
    }

    const apiKey = readApiKey(req);
    if (apiKey) {
        const cached = getCachedApiKeyUser(apiKey);
        if (cached) {
            req.user = { ...cached, authType: "api_key" };
            return next();
        }
        try {
            const resolved = await pgStore.resolveUserByApiKey(apiKey);
            if (resolved?.user?.id) {
                req.user = {
                    sub: resolved.user.id,
                    role: resolved.user.role,
                    email: resolved.user.email,
                    name: resolved.user.name,
                    keyId: resolved.keyId,
                    authType: "api_key"
                };
                setCachedApiKeyUser(apiKey, req.user);
                pgStore.touchApiKeyUsage(resolved.keyId).catch(() => {});
                return next();
            }
        } catch (err) {
            logger.warn(`API key auth lookup failed: ${err.message}`);
        }
    }

    const allowLegacy = String(process.env.ALLOW_LEGACY_ADMIN_KEY || "false").toLowerCase() === "true";
    const key = req.headers["x-admin-key"];
    if (allowLegacy && process.env.ADMIN_SECRET && key === process.env.ADMIN_SECRET) {
        req.user = { sub: "legacy-admin", role: "admin", legacy: true };
        return next();
    }

    logger.warn(`Unauthorized REST access from ${req.ip}`);
    return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
}

module.exports = authGuard;
