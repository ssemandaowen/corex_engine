"use strict";

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('@utils/logger');
const db = require("@core/services/postgres");

const BACKTEST_DIR = path.join(process.cwd(), 'data', 'backtests');

/**
 * DATA DOMAIN
 * Handles Tab 5: Data (Reports, Summaries, and Cache)
 */

// 1. LIST ALL REPORTS (For the Data Tab sidebar/list)
router.get('/reports', (req, res) => {
    try {
        if (db.hasDbConfig()) {
            db.query(
                `SELECT id, created_at, report
                 FROM backtests
                 ORDER BY created_at DESC`
            ).then(({ rows }) => {
                const files = (rows || []).map(r => ({
                    id: r.id,
                    name: String(r.id),
                    timestamp: r.created_at,
                    size: JSON.stringify(r.report || {}).length
                }));
                return res.json({ success: true, payload: files });
            }).catch(() => {
                return res.json({ success: true, payload: [] });
            });
            return;
        }

        if (!fs.existsSync(BACKTEST_DIR)) return res.json({ success: true, payload: [] });

        const files = fs.readdirSync(BACKTEST_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stats = fs.statSync(path.join(BACKTEST_DIR, f));
                return {
                    id: f,
                    name: f.replace('.json', ''),
                    timestamp: stats.mtime,
                    size: stats.size
                };
            })
            .sort((a, b) => b.timestamp - a.timestamp); // Newest first

        res.json({ success: true, payload: files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET SPECIFIC REPORT SUMMARY (For UI Charts)
router.get('/reports/:id', (req, res) => {
    if (db.hasDbConfig()) {
        db.query(
            `SELECT report FROM backtests WHERE id = $1 LIMIT 1`,
            [String(req.params.id)]
        ).then(({ rows }) => {
            if (!rows[0]) return res.status(404).json({ success: false, error: "Report not found" });
            const report = rows[0].report || {};
            const response = {
                metadata: report.metadata || report.meta || {},
                summary: report.summary || report.performance || { totalTrades: 0, netProfit: 0 },
                equityCurve: report.equityCurve || [],
                trades: report.trades || []
            };
            return res.json({ success: true, payload: response });
        }).catch((err) => {
            res.status(500).json({ success: false, error: "Failed to parse report data", message: err.message });
        });
        return;
    }

    const filePath = path.join(BACKTEST_DIR, req.params.id);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: "Report not found" });
    }

    try {
        const rawData = fs.readFileSync(filePath, 'utf8');
        const report = JSON.parse(rawData);

        // Standardize the response so the UI always knows where to find "Equity"
        const response = {
            metadata: report.metadata || {},
            summary: report.summary || { totalTrades: 0, netProfit: 0 },
            equityCurve: report.equityCurve || [],
            trades: report.trades || []
        };

        res.json({ success: true, payload: response });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to parse report data" });
    }
});

// 3. WIPE CACHE (The "System Standard" Maintenance)
router.delete('/cache', (req, res) => {
    const cacheDir = path.join(process.cwd(), 'data', 'cache');
    try {
        if (fs.existsSync(cacheDir)) {
            // Standard standard: don't delete the folder, just the files
            const files = fs.readdirSync(cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(cacheDir, file));
            }
        }
        logger.info("Market data cache cleared by user.");
        res.json({ success: true, message: "Cache cleared. System will re-download on next run." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
