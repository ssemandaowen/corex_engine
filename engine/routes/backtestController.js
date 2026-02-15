"use strict";

const router = require("express").Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const backtestManager = require("@core/backtestManager");
const loader = require("@core/strategyLoader");
const { ensureDir, cleanupBacktests, cleanupUploads } = require("@utils/storageManager");
const crypto = require("crypto");

// Standardize Paths
const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, 'tmp');
const UPLOADS_DEDUP_DIR = path.join(UPLOADS_DIR, 'dedup');
const REPORTS_DIR = path.join(DATA_DIR, 'backtests');

// Ensure directories exist
ensureDir(UPLOADS_DIR);
ensureDir(UPLOADS_TMP_DIR);
ensureDir(UPLOADS_DEDUP_DIR);
ensureDir(REPORTS_DIR);

// Configure Multer for CSV datasets
const MAX_UPLOAD_MB = Number(process.env.BACKTEST_MAX_MB || 50);
const upload = multer({
    dest: UPLOADS_TMP_DIR,
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv");
        if (!ok) return cb(new Error("INVALID_FILE_TYPE"));
        cb(null, true);
    }
});

const hashFile = (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
});

/**
 * @route GET /api/backtest
 * @desc List reports for the "Data" Tab sidebar
 */
router.get("/", (req, res) => {
    try {
        cleanupBacktests(REPORTS_DIR);
        cleanupUploads(UPLOADS_DEDUP_DIR);
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
    let uploadedPath = null;
    let dedupPath = null;
    try {
        const entry = loader.registry.get(req.params.id);
        if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });

        uploadedPath = req.file?.path || null;
        if (uploadedPath) {
            const digest = await hashFile(uploadedPath);
            const ext = path.extname(req.file.originalname || ".csv") || ".csv";
            dedupPath = path.join(UPLOADS_DEDUP_DIR, `${digest}${ext}`);
            if (fs.existsSync(dedupPath)) {
                try { fs.unlinkSync(uploadedPath); } catch { /* ignore */ }
            } else {
                fs.renameSync(uploadedPath, dedupPath);
            }
        }
        const options = {
            file: req.file ? { ...req.file, path: dedupPath || uploadedPath } : null,
            symbol: req.body.symbol || 'BTC/USD',
            interval: req.body.interval || '1m',
            initialCapital: parseFloat(req.body.initialCapital) || 10000,
            includeTrades: req.body.includeTrades === 'true',
            outputsize: parseInt(req.body.outputsize) || 1000
        };

        let instance = entry.instance;
        try {
            // Isolate backtest params from live instance
            try {
                const resolved = require.resolve(entry.filePath);
                if (require.cache[resolved]) delete require.cache[resolved];
                const baseResolved = require.resolve('@utils/BaseStrategy');
                if (require.cache[baseResolved]) delete require.cache[baseResolved];
            } catch (e) { /* ignore */ }

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

        cleanupBacktests(REPORTS_DIR);
        cleanupUploads(UPLOADS_DEDUP_DIR);

        res.json({ success: true, payload: result });
    } catch (err) {
        const code = err.message === "INVALID_FILE_TYPE" ? 400 : 500;
        res.status(code).json({ success: false, error: "SIMULATION_FAILED", message: err.message });
    } finally {
        // CLEANUP: Remove temp upload if any remains
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            try { fs.unlinkSync(uploadedPath); } catch { /* ignore */ }
        }
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
