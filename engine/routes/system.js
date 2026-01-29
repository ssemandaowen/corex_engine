"use strict";

const router = require("express").Router();
const engine = require("@core/engine");
const broker = require("@broker/twelvedata");
const logger = require("@utils/logger");

/**
 * @route GET /api/system/status
 * @desc Unified health check for the UI dashboard
 */
router.get("/status", (req, res) => {
    res.json({
        engine: engine.status,
        uptime: engine.getUptime(),
        activeSymbols: Array.from(engine.activeSymbols),
        memory: process.memoryUsage().heapUsed / 1024 / 1024 + " MB",
        timestamp: Date.now()
    });
});

/**
 * @route POST /api/system/data/fetch
 * @desc Manually seed data or download CSV for external research
 */
router.post("/data/fetch", async (req, res) => {
    const { symbol, interval, outputsize } = req.body;
    
    try {
        logger.info(`📡 Manual data fetch requested for ${symbol}`);
        const data = await broker.fetchHistory({ symbol, interval, outputsize });
        
        if (req.body.download === true) {
            // Logic to convert 'data' to CSV and return as stream can be added here
            return res.json({ message: "Data retrieved", count: data.length });
        }
        
        res.json({ success: true, count: data.length, sample: data.slice(-1) });
    } catch (err) {
        res.status(500).json({ error: "FETCH_FAILED", message: err.message });
    }
});

module.exports = router;