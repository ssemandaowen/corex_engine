"use strict";

const express = require("express");
const { TradingAccountRepository } = require("../account/TradingAccountRepository");
const { verifyToken } = require("../../../corex-auth/src/AuthService");

function createAccountRouter({ repository } = {}) {
    const repo = repository || new TradingAccountRepository();
    const router = express.Router();

    function getUserId(req, res) {
        const authHeader = req.headers?.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
            res.status(401).json({ error: "Authorization header required" });
            return null;
        }
        try {
            const payload = verifyToken(token);
            if (!payload || !payload.userId) {
                res.status(401).json({ error: "Invalid token" });
                return null;
            }
            return payload.userId;
        } catch (err) {
            res.status(401).json({ error: `Authentication failed: ${err.message}` });
            return null;
        }
    }

    router.post("/accounts", async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId) return;

        const { type, label, brokerBinding } = req.body || {};
        const result = await repo.create({ userId, type, label, brokerBinding });
        if (!result.ok) {
            const status = result.reasonCode === "ACCOUNT_LIMIT_EXCEEDED" ? 409 : 400;
            return res.status(status).json({ error: result.error, reasonCode: result.reasonCode });
        }
        res.status(201).json(result.account);
    });

    router.get("/accounts", async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId) return;

        const accounts = await repo.listByUser(userId);
        res.json(accounts);
    });

    router.patch("/accounts/:id/archive", async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId) return;

        const account = await repo.getByAccountId(req.params.id);
        if (!account) {
            return res.status(404).json({ error: "Account not found" });
        }
        if (account.userId !== userId) {
            return res.status(403).json({ error: "Account does not belong to authenticated user" });
        }

        const result = await repo.archive(req.params.id);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result.account);
    });

    return router;
}

module.exports = { createAccountRouter };