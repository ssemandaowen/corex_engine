"use strict";

const express = require("express");
const router = express.Router();
const pgStore = require("@core/services/pgStore");
const { hashPassword, verifyPassword, signToken, verifyToken } = require("@core/services/authService");

const sanitizeUser = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt || user.last_login_at || null
});

function readBearerToken(req) {
    const header = String(req.headers.authorization || "").trim();
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

async function requireAuthUser(req, res) {
    const token = readBearerToken(req);
    if (!token) {
        res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        return null;
    }
    try {
        const payload = verifyToken(token);
        const user = await pgStore.getUserById(payload.sub);
        if (!user) {
            res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
            return null;
        }
        return user;
    } catch (err) {
        res.status(401).json({ success: false, error: "UNAUTHORIZED", message: err.message });
        return null;
    }
}

router.post("/signin", async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
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

        await pgStore.markLastLogin(user.id);
        const token = signToken({
            sub: user.id,
            role: user.role,
            email: user.email
        });

        let authKey = null;
        if (req.body?.issueAuthKey === true) {
            const ttlDaysRaw = Number(req.body?.authKeyTtlDays ?? 30);
            const ttlDays = Math.max(1, Math.min(180, Number.isFinite(ttlDaysRaw) ? ttlDaysRaw : 30));
            const expiresAt = new Date(Date.now() + (ttlDays * 24 * 60 * 60 * 1000)).toISOString();
            const issued = await pgStore.createApiKey(user.id, {
                label: "web-session",
                expiresAt
            });
            authKey = {
                key: issued.key,
                id: issued.id,
                expiresAt: issued.expiresAt
            };
        }

        return res.json({
            success: true,
            payload: {
                token,
                authKey,
                user: sanitizeUser(user)
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "SIGNIN_FAILED", message: err.message });
    }
});

router.post("/bootstrap", async (req, res) => {
    try {
        const key = req.headers["x-admin-key"];
        if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        }

        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const name = String(req.body?.name || "Admin");

        if (!email || !password) {
            return res.status(400).json({ success: false, error: "EMAIL_PASSWORD_REQUIRED" });
        }

        const passwordHash = await hashPassword(password);
        const user = await pgStore.createUser({
            email,
            name,
            role: "admin",
            status: "active",
            passwordHash
        });

        return res.json({ success: true, payload: user });
    } catch (err) {
        return res.status(400).json({ success: false, error: "BOOTSTRAP_FAILED", message: err.message });
    }
});

router.get("/me", async (req, res) => {
    try {
        const token = readBearerToken(req);
        if (!token) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const payload = verifyToken(token);
        const user = await pgStore.getUserById(payload.sub);
        if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
        return res.json({ success: true, payload: sanitizeUser(user) });
    } catch (err) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: err.message });
    }
});

router.get("/apikeys", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    try {
        const keys = await pgStore.listApiKeysForUser(user.id);
        return res.json({ success: true, payload: keys });
    } catch (err) {
        return res.status(500).json({ success: false, error: "API_KEYS_READ_FAILED", message: err.message });
    }
});

router.post("/apikeys", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    try {
        const label = String(req.body?.label || "manual").trim() || "manual";
        const ttlDaysRaw = Number(req.body?.ttlDays ?? 90);
        const ttlDays = Math.max(1, Math.min(365, Number.isFinite(ttlDaysRaw) ? ttlDaysRaw : 90));
        const expiresAt = req.body?.neverExpires === true
            ? null
            : new Date(Date.now() + (ttlDays * 24 * 60 * 60 * 1000)).toISOString();
        const issued = await pgStore.createApiKey(user.id, { label, expiresAt });
        return res.json({
            success: true,
            payload: {
                id: issued.id,
                label: issued.label,
                status: issued.status,
                key: issued.key,
                expiresAt: issued.expiresAt,
                createdAt: issued.createdAt
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "API_KEY_CREATE_FAILED", message: err.message });
    }
});

router.delete("/apikeys/:id", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    try {
        const ok = await pgStore.revokeApiKey(user.id, String(req.params.id || ""));
        if (!ok) return res.status(404).json({ success: false, error: "API_KEY_NOT_FOUND" });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: "API_KEY_REVOKE_FAILED", message: err.message });
    }
});

module.exports = router;
