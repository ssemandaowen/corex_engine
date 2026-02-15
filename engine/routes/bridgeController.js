"use strict";

const express = require("express");
const router = express.Router();
const db = require("@core/services/postgres");
const broadcaster = require("@core/services/broadcaster");

function isAuthorized(req) {
    const expected = String(process.env.COREX_MT5_HTTP_TOKEN || "").trim();
    if (!expected) return false;
    const provided = String(req.headers["x-corex-token"] || "").trim();
    return provided && provided === expected;
}

router.post("/heartbeat", async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }

    const terminalId = String(req.body?.terminal_id || "").trim();
    const accountId = req.body?.account_id != null ? String(req.body.account_id).trim() : null;
    if (!terminalId) {
        return res.status(400).json({ success: false, error: "TERMINAL_ID_REQUIRED" });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO bridge_status (terminal_id, last_seen, status, account_id)
             VALUES ($1, NOW(), 'PENDING_APPROVAL', $2)
             ON CONFLICT (terminal_id) DO UPDATE
             SET last_seen = EXCLUDED.last_seen,
                 account_id = COALESCE(bridge_status.account_id, EXCLUDED.account_id)
             RETURNING terminal_id, status, account_id, last_seen`,
            [terminalId, accountId]
        );
        const terminal = accountId || terminalId;
        broadcaster.transmit("MT5_BRIDGE_STATUS", {
            status: "CONNECTED",
            terminal_id: terminal,
            timestamp: Date.now()
        });
        res.json({ success: true, payload: rows[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: "HEARTBEAT_FAILED", message: err.message });
    }
});

router.post("/authorize", async (req, res) => {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }
    const terminalId = String(req.body?.terminal_id || "").trim();
    if (!terminalId) {
        return res.status(400).json({ success: false, error: "TERMINAL_ID_REQUIRED" });
    }
    try {
        const { rowCount } = await db.query(
            `UPDATE bridge_status
             SET status = 'AUTHORIZED'
             WHERE terminal_id = $1`,
            [terminalId]
        );
        if (!rowCount) return res.status(404).json({ success: false, error: "TERMINAL_NOT_FOUND" });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "AUTHORIZE_FAILED", message: err.message });
    }
});

module.exports = router;
