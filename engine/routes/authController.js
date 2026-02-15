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

        return res.json({
            success: true,
            payload: {
                token,
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
        const header = String(req.headers.authorization || "");
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;
        if (!token) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const payload = verifyToken(token);
        const user = await pgStore.getUserById(payload.sub);
        if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
        return res.json({ success: true, payload: sanitizeUser(user) });
    } catch (err) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: err.message });
    }
});

module.exports = router;
