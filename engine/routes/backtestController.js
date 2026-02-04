"use strict";

const router = require("express").Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const backtestManager = require("@core/backtestManager");
const loader = require("@core/strategyLoader");

// Standardize Paths
const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const REPORTS_DIR = path.join(DATA_DIR, 'backtests');

// Ensure directories exist
[UPLOADS_DIR, REPORTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer for CSV datasets
const upload = multer({ dest: UPLOADS_DIR });

/**
 * @route GET /api/backtest
 * @desc List reports for the "Data" Tab sidebar
 */
router.get("/", (req, res) => {
    try {
        const files = fs.readdirSync(REPORTS_DIR);
        const reports = files
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const stat = fs.statSync(path.join(REPORTS_DIR, file));
                return {
                    id: file.replace('.json', ''),
                    timestamp: stat.mtimeMs,
                    size: stat.size
                };
            })
            .sort((a, b) => b.timestamp - a.timestamp);

        res.json({ success: true, payload: reports }); // Standardized envelope
    } catch (err) {
        res.status(500).json({ success: false, error: "LIST_FAILED", message: err.message });
    }
});

/**
 * @route POST /api/backtest/:id
 * @desc Triggered by "Run" Tab for Backtest mode
 */
router.post("/:id", upload.single('dataset'), async (req, res) => {
    try {
        const entry = loader.registry.get(req.params.id);
        if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });

        const options = {
            file: req.file || null, // Pass multer file object (has .path)
            symbol: req.body.symbol || 'BTC/USD',
            interval: req.body.interval || '1m',
            initialCapital: parseFloat(req.body.initialCapital) || 10000,
            includeTrades: req.body.includeTrades === 'true',
            outputsize: parseInt(req.body.outputsize) || 1000
        };

        let instance = entry.instance;
        try {
            // Isolate backtest params from live instance
            const StrategyClass = require(entry.filePath);
            instance = typeof StrategyClass === 'function'
                ? new StrategyClass({ name: entry.id, id: entry.id })
                : StrategyClass;
            instance.id = entry.id;
            instance.name = entry.id;
        } catch (e) {
            // Fallback to existing instance if instantiation fails
            instance = entry.instance;
        }

        const rawParams = req.body.params;
        if (rawParams) {
            try {
                const parsed = JSON.parse(rawParams);
                instance.updateParams?.(parsed);
            } catch (e) {
                // ignore invalid params payload
            }
        }

        const result = await backtestManager.run(instance, options);

        // CLEANUP: If a file was uploaded, delete it after processing to prevent bloat
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.json({ success: true, payload: result });
    } catch (err) {
        res.status(500).json({ success: false, error: "SIMULATION_FAILED", message: err.message });
    }
});

/**
 * @route GET /api/backtest/:reportId
 * @desc Fetch report data for the "Data" Tab charts
 */
router.get("/:reportId", (req, res) => {
    const filePath = path.join(REPORTS_DIR, `${req.params.reportId}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json({ success: true, payload: JSON.parse(data) });
    } catch (err) {
        res.status(500).json({ success: false, error: "READ_FAILED" });
    }
});

module.exports = router;
