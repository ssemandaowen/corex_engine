"use strict";

const router = require("express").Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const backtestManager = require("@core/backtestManager");
const loader = require("@core/strategyLoader");

// Make sure that the uploads folder exits before introducing multer..
let uploadsPath = path.resolve(__dirname, '../../data/uploads/');
if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
}

const upload = multer({ dest: uploadsPath });

/**
 * @route POST /api/backtest/:id
 * @desc Run simulation on a specific strategy
 */
router.post("/:id", upload.single('dataset'), async (req, res) => {
    try {
        const entry = loader.registry.get(req.params.id);
        if (!entry) return res.status(404).json({ error: "STRATEGY_NOT_FOUND" });

        const options = {
            file: req.file || null,
            symbol: req.body.symbol || 'BTC/USD',
            interval: req.body.interval || '1min',
            initialCapital: parseFloat(req.body.initialCapital) || 10000,
            includeTrades: req.body.includeTrades === 'true'
        };

        const result = await backtestManager.run(entry.instance, options);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "SIMULATION_CRASH", message: err.message });
    }
});

/**
 * @route GET /api/backtest/download/:reportId
 * @desc Download the CSV trade log for a specific run
 */
router.get("/download/:reportId", (req, res) => {
    const filePath = path.resolve(__dirname, `../../data/backtests/${req.params.reportId}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "REPORT_NOT_FOUND" });

    res.download(filePath);
});

module.exports = router;