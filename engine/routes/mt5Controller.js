"use strict";

const express = require("express");
const router = express.Router();
const db = require("@core/services/postgres");

function isAuthorized(req) {
    const expected = String(process.env.COREX_MT5_HTTP_TOKEN || "").trim();
    if (!expected) return false;
    const provided = String(req.headers["x-corex-token"] || "").trim();
    return provided && provided === expected;
}

router.use((req, res, next) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }
    next();
});

// GET /api/mt5/next-order
router.get("/next-order", async (req, res) => {
    const terminalId = String(req.headers["x-terminal-id"] || "").trim();
    if (!terminalId) {
        return res.status(400).json({ success: false, error: "TERMINAL_ID_REQUIRED" });
    }
    try {
        const { rows: authRows } = await db.query(
            `SELECT status FROM bridge_status WHERE terminal_id = $1 LIMIT 1`,
            [terminalId]
        );
        if (!authRows[0] || authRows[0].status !== "AUTHORIZED") {
            return res.status(403).json({ success: false, error: "TERMINAL_NOT_AUTHORIZED" });
        }
        const { rows: settingsRows } = await db.query(
            `SELECT payload FROM system_settings WHERE id = 1`
        );
        const payload = settingsRows[0]?.payload || {};
        const execution = payload.execution || {};
        const globalEnabled = execution.enabled !== false;
        const terminals = execution.terminals || {};
        const terminalEnabled = terminalId in terminals ? !!terminals[terminalId] : true;
        if (!globalEnabled || !terminalEnabled) {
            return res.status(404).json({ success: false, error: "EXECUTION_DISABLED" });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: "AUTH_CHECK_FAILED", message: err.message });
    }

    try {
        const result = await db.withTransaction(async (tx) => {
            let rows;
            try {
                ({ rows } = await tx.query(
                    `SELECT id, symbol, side, quantity, sl, tp
                     FROM orders
                     WHERE status = 'PENDING'
                       AND environment = 'LIVE'
                       AND terminal_id = $1
                     ORDER BY created_at ASC
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1`,
                    [terminalId]
                ));
            } catch {
                ({ rows } = await tx.query(
                    `SELECT id, symbol, side, quantity
                     FROM orders
                     WHERE status = 'PENDING'
                       AND environment = 'LIVE'
                       AND terminal_id = $1
                     ORDER BY created_at ASC
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1`,
                    [terminalId]
                ));
            }
            if (!rows[0]) return null;

            await tx.query(
                "UPDATE orders SET status = 'SENT' WHERE id = $1",
                [rows[0].id]
            );

            return rows[0];
        });

        if (!result) return res.status(404).json({ success: false, error: "NO_PENDING_ORDERS" });
        return res.json({
            id: result.id,
            symbol: result.symbol,
            side: result.side,
            quantity: Number(result.quantity),
            sl: Number(result.sl || 0),
            tp: Number(result.tp || 0)
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "FETCH_FAILED", message: err.message });
    }
});

// POST /api/mt5/confirm-fill
router.post("/confirm-fill", async (req, res) => {
    const orderId = String(req.body?.order_id || "").trim();
    const dealId = String(req.body?.deal_id || "").trim();
    const fillPrice = Number(req.body?.fill_price);

    if (!orderId || !dealId || !Number.isFinite(fillPrice)) {
        return res.status(400).json({ success: false, error: "INVALID_PAYLOAD" });
    }

    try {
        const result = await db.withTransaction(async (tx) => {
            const { rows } = await tx.query(
                "SELECT id, quantity FROM orders WHERE id = $1 FOR UPDATE",
                [orderId]
            );
            if (!rows[0]) {
                return { status: 404, payload: { success: false, error: "ORDER_NOT_FOUND" } };
            }

            await tx.query(
                "UPDATE orders SET status = 'FILLED' WHERE id = $1",
                [orderId]
            );

            await tx.query(
                `INSERT INTO order_fills (order_id, external_deal_id, fill_price, fill_quantity, commission, filled_at)
                 VALUES ($1, $2, $3, $4, 0, NOW())`,
                [orderId, dealId, fillPrice, rows[0].quantity]
            );

            return { status: 200, payload: { success: true } };
        });

        return res.status(result.status).json(result.payload);
    } catch (err) {
        return res.status(500).json({ success: false, error: "CONFIRM_FAILED", message: err.message });
    }
});

module.exports = router;
