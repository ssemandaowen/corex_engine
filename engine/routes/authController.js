"use strict";

/**
 * Auth Controller
 *
 * Routes:
 *   POST /api/auth/signin       — returns JWT
 *   POST /api/auth/signout      — revokes the session in corex_sessions
 *   POST /api/auth/register     — creates a new BASIC user (not admin)
 *   POST /api/auth/bootstrap    — creates the first admin (requires ADMIN_SECRET)
 *   GET  /api/auth/me           — returns current user profile
 */

const express = require("express");
const router  = express.Router();
const crypto  = require("crypto");
const db      = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const { hashPassword, verifyPassword, signToken, verifyToken } = require("@core/services/authService");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeUser(user) {
    const role = user.role === "basic" ? "user" : user.role;
    return {
        id:          user.id,
        email:       user.email,
        name:        user.name,
        role,
        status:      user.status,
        subscriptionTier: user.subscriptionTier || user.subscription_tier || "developer",
        lastLoginAt: user.lastLoginAt || user.last_login_at || null,
    };
}

function readBearerToken(req) {
    const header = String(req.headers.authorization || "").trim();
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign in
// ─────────────────────────────────────────────────────────────────────────────
// Inside your auth router configuration
const handleRegister = async (req, res) => {
    try {
        const email    = String(req.body?.email    || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const name     = String(req.body?.name     || "").trim() || email;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: "EMAIL_PASSWORD_REQUIRED" });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, error: "PASSWORD_TOO_SHORT" });
        }

        const existing = await pgStore.getAuthUserByEmail(email);
        if (existing) {
            return res.status(409).json({ success: false, error: "EMAIL_EXISTS" });
        }

        const passwordHash = await hashPassword(password);

        // New public registrations are BASIC role — not operator, not admin
        const user = await pgStore.createUser({
            email,
            name,
            passwordHash,
            role:   "basic",
            status: "active",
        });

        const sessionId = crypto.randomUUID();
        if (db.hasDbConfig()) {
            await db.query(
                `INSERT INTO corex_sessions (session_id, user_id, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [
                    sessionId,
                    user.id,
                    req.ip || null,
                    String(req.headers["user-agent"] || "").slice(0, 512) || null,
                ]
            ).catch(() => {});
        }

        const token = signToken({
            sub: user.id,
            role: user.role,
            email: user.email,
            sessionId,
        });

        return res.json({
            success: true,
            payload: {
                token,
                sessionId,
                authKey: null,
                user: sanitizeUser(user),
            },
        });

    } catch (err) {
        return res.status(500).json({ success: false, error: "REGISTRATION_FAILED", message: err.message });
    }
};

router.post("/signup", handleRegister);
router.post("/register", handleRegister);

router.post("/signin", async (req, res) => {
    try {
        const email    = String(req.body?.email    || "").trim().toLowerCase();
        const password = String(req.body?.password || "");

        if (!email || !password) {
            return res.status(400).json({ success: false, error: "EMAIL_PASSWORD_REQUIRED" });
        }

        const user = await pgStore.getAuthUserByEmail(email);
        if (!user || user.status !== "active") {
            return res.status(401).json({ success: false, error: "INVALID_CREDENTIALS" });
        }

        const ok = await verifyPassword(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ success: false, error: "INVALID_CREDENTIALS" });
        }

        // Create a session record for revocation support
        const sessionId = crypto.randomUUID();
        if (db.hasDbConfig()) {
            await db.query(
                `INSERT INTO corex_sessions (session_id, user_id, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [
                    sessionId,
                    user.id,
                    req.ip || null,
                    String(req.headers["user-agent"] || "").slice(0, 512) || null,
                ]
            ).catch(() => {});
        }

        await pgStore.markLastLogin(user.id).catch(() => {});

        const token = signToken({
            sub:       user.id,
            role:      user.role,
            email:     user.email,
            sessionId,
        });

        return res.json({
            success: true,
            payload: {
                token,
                sessionId,
                user: sanitizeUser(user),
            },
        });

    } catch (err) {
        return res.status(500).json({ success: false, error: "SIGNIN_FAILED", message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sign out — revokes the session
// ─────────────────────────────────────────────────────────────────────────────

router.post("/signout", async (req, res) => {
    try {
        const token = readBearerToken(req);
        if (token && db.hasDbConfig()) {
            try {
                const payload = verifyToken(token);
                if (payload.sessionId) {
                    await db.query(
                        `UPDATE corex_sessions
                         SET revoked_at = NOW()
                         WHERE session_id = $1 AND user_id = $2`,
                        [payload.sessionId, payload.sub]
                    );
                }
            } catch {
                // Token may already be expired — that is fine for sign-out
            }
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: "SIGNOUT_FAILED", message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Register — creates a BASIC user (not admin, not pro)
// ─────────────────────────────────────────────────────────────────────────────

// Registration handled above via handleRegister

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap — creates the first admin account
// Requires ADMIN_SECRET env var to be set
// ─────────────────────────────────────────────────────────────────────────────

router.post("/bootstrap", async (req, res) => {
    try {
        const secret = process.env.ADMIN_SECRET;
        const key    = req.headers["x-admin-key"];

        if (!secret || key !== secret) {
            return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        }

        const email    = String(req.body?.email    || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const name     = String(req.body?.name     || "Admin").trim();

        if (!email || !password) {
            return res.status(400).json({ success: false, error: "EMAIL_PASSWORD_REQUIRED" });
        }

        const passwordHash = await hashPassword(password);
        const user = await pgStore.createUser({
            email,
            name,
            role:         "admin",
            status:       "active",
            passwordHash,
        });

        return res.json({ success: true, payload: sanitizeUser(user) });

    } catch (err) {
        return res.status(400).json({ success: false, error: "BOOTSTRAP_FAILED", message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Current user profile
// ─────────────────────────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
    try {
        const token = readBearerToken(req);
        if (!token) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const payload = verifyToken(token);
        const user    = await pgStore.getUserById(payload.sub);
        if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });

        return res.json({ success: true, payload: sanitizeUser(user) });
    } catch (err) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: err.message });
    }
});

module.exports = router;
