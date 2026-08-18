"use strict";

/**
 * Data Controller
 *
 * Handles market data, uploaded datasets, and backtest report listing.
 * ALL queries are scoped by req.user.sub to prevent cross-user data leakage.
 */

const express  = require("express");
const router   = express.Router();
const path     = require("path");
const logger   = require("@utils/logger");
const db       = require("@core/services/postgres");
const authGuard = require("@core/middleware/authGuard");

const log = logger.createModuleLogger("DATA_CONTROLLER");

// All data routes require authentication
router.use(authGuard);

// ─────────────────────────────────────────────────────────────────────────────
// Backtest reports — ALWAYS scoped by user_id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/data/reports
 * List this user's backtest reports.
 */
router.get("/reports", async (req, res) => {
    const userId = req.user.sub;
    try {
        if (!db.hasDbConfig()) {
            return res.json({ success: true, payload: [] });
        }

        const { rows } = await db.query(
            `SELECT id, created_at, report
             FROM backtests
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [userId]
        );

        const reports = (rows || []).map(r => ({
            id:        r.id,
            name:      String(r.id),
            timestamp: r.created_at,
            size:      JSON.stringify(r.report || {}).length,
            ...(r.report?.meta || {}),
        }));

        return res.json({ success: true, payload: reports });

    } catch (err) {
        log.error(`[REPORTS] list failed for user ${userId}: ${err.message}`);
        return res.status(500).json({ success: false, error: "REPORTS_READ_FAILED", message: err.message });
    }
});

/**
 * GET /api/data/reports/:id
 * Get a single backtest report. Enforces ownership.
 */
router.get("/reports/:id", async (req, res) => {
    const userId   = req.user.sub;
    const reportId = String(req.params.id || "").trim();

    if (!reportId) {
        return res.status(400).json({ success: false, error: "REPORT_ID_REQUIRED" });
    }

    try {
        if (!db.hasDbConfig()) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        const { rows } = await db.query(
            `SELECT report FROM backtests
             WHERE user_id = $1 AND id = $2
             LIMIT 1`,
            [userId, reportId]
        );

        if (!rows.length || !rows[0].report) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        return res.json({ success: true, payload: rows[0].report });

    } catch (err) {
        log.error(`[REPORTS] get ${reportId} failed for user ${userId}: ${err.message}`);
        return res.status(500).json({ success: false, error: "REPORT_READ_FAILED", message: err.message });
    }
});

/**
 * DELETE /api/data/reports/:id
 * Delete a backtest report. Enforces ownership.
 */
router.delete("/reports/:id", async (req, res) => {
    const userId   = req.user.sub;
    const reportId = String(req.params.id || "").trim();

    if (!reportId) {
        return res.status(400).json({ success: false, error: "REPORT_ID_REQUIRED" });
    }

    try {
        if (!db.hasDbConfig()) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        const { rowCount } = await db.query(
            "DELETE FROM backtests WHERE user_id = $1 AND id = $2",
            [userId, reportId]
        );

        if (!rowCount) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        return res.json({ success: true });

    } catch (err) {
        log.error(`[REPORTS] delete ${reportId} failed for user ${userId}: ${err.message}`);
        return res.status(500).json({ success: false, error: "REPORT_DELETE_FAILED", message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Uploaded datasets — scoped by userId in file path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/data/uploads
 * List this user's uploaded CSV datasets.
 */
/**
 * GET /api/data/storage
 * User-facing storage usage view: dataset uploads, quota usage, and
 * backtest reports. Lets users see what's consuming space before the
 * data culler ever needs to act (Phase C).
 */
router.get("/storage", async (req, res) => {
    const userId = req.user.sub;
    try {
        if (!db.hasDbConfig()) {
            return res.json({ success: true, payload: { uploads: [], usage: { count: 0, totalBytes: 0 }, quota: null } });
        }

        const pgStore = require("@core/services/pgStore");
        const [uploads, usage] = await Promise.all([
            pgStore.listBacktestUploadsForUser(userId, { limit: 200 }),
            pgStore.getBacktestUploadUsageForUser(userId)
        ]);

        const maxUploads = Math.max(1, Number(process.env.COREX_MAX_UPLOADS_PER_USER || 10));
        const maxBytes = Math.max(1, Number(process.env.COREX_MAX_UPLOAD_STORAGE_MB || 500)) * 1024 * 1024;

        return res.json({
            success: true,
            payload: {
                uploads: uploads.map((u) => ({
                    id: u.id,
                    symbol: u.symbol,
                    originalname: u.originalname,
                    size: u.size,
                    barsCount: u.barsCount,
                    timeRange: u.meta?.timeRange || null,
                    createdAt: u.createdAt,
                    lastUsedAt: u.lastUsedAt
                })),
                usage: { count: usage.count, totalBytes: usage.totalBytes },
                quota: {
                    maxUploads,
                    maxBytes,
                    remainingUploads: Math.max(0, maxUploads - usage.count),
                    remainingBytes: Math.max(0, maxBytes - usage.totalBytes)
                }
            }
        });
    } catch (err) {
        log.error(`[STORAGE] read failed for user ${userId}: ${err.message}`);
        return res.status(500).json({ success: false, error: "STORAGE_READ_FAILED", message: err.message });
    }
});

/**
 * DELETE /api/data/storage/:id
 * Delete an uploaded dataset (soft-delete + file cleanup). Enforces ownership.
 */
router.delete("/storage/:id", async (req, res) => {
    const userId   = req.user.sub;
    const uploadId = String(req.params.id || "").trim();

    if (!uploadId) {
        return res.status(400).json({ success: false, error: "UPLOAD_ID_REQUIRED" });
    }

    try {
        if (!db.hasDbConfig()) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        const pgStore = require("@core/services/pgStore");
        const target = await pgStore.getBacktestUploadForUser(userId, uploadId);
        if (!target) {
            return res.status(404).json({ success: false, error: "NOT_FOUND" });
        }

        await pgStore.softDeleteBacktestUploadForUser(userId, uploadId);

        const fsp = require("fs").promises;
        if (target.symbolPath) {
            try { await fsp.unlink(target.symbolPath); } catch { /* ignore */ }
        }

        return res.json({ success: true });

    } catch (err) {
        log.error(`[STORAGE] delete ${uploadId} failed for user ${userId}: ${err.message}`);
        return res.status(500).json({ success: false, error: "STORAGE_DELETE_FAILED", message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Candle / symbol data (market data fetch — not user-specific content)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/data/candles?symbol=BTC/USD&timeframe=1h&startDate=...&endDate=...
 */
router.get("/candles", async (req, res) => {
    const symbol    = String(req.query.symbol    || "").trim().toUpperCase();
    const timeframe = String(req.query.timeframe || "1h").trim();
    const startDate = req.query.startDate;
    const endDate   = req.query.endDate;

    if (!symbol) {
        return res.status(400).json({ success: false, error: "SYMBOL_REQUIRED" });
    }

    try {
        // Delegate to the historical cache / data source
        // This will use the user's connector settings when connectorSettingsService is ready
        const historicalCache = require("@core/services/historicalCache");
        const candles = await historicalCache.fetch({ symbol, timeframe, startDate, endDate });
        return res.json({ success: true, payload: candles });
    } catch (err) {
        log.error(`[CANDLES] fetch ${symbol} failed: ${err.message}`);
        return res.status(500).json({ success: false, error: "CANDLE_FETCH_FAILED", message: err.message });
    }
});

/**
 * GET /api/data/symbols?q=BTC
 */
router.get("/symbols", async (req, res) => {
    const q = String(req.query.q || "").trim();
    try {
        const twelvedata = require("@broker/twelvedata");
        if (typeof twelvedata.searchSymbols === "function") {
            const results = await twelvedata.searchSymbols(q);
            return res.json({ success: true, payload: results });
        }
        return res.json({ success: true, payload: [] });
    } catch (err) {
        return res.status(500).json({ success: false, error: "SYMBOL_SEARCH_FAILED", message: err.message });
    }
});

module.exports = router;