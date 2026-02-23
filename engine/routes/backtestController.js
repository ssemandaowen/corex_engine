"use strict";

const router = require("express").Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const backtestManager = require("@core/backtestManager");
const loader = require("@core/strategyLoader");
const { ensureDir, cleanupBacktests, cleanupUploads } = require("@utils/storageManager");
const crypto = require("crypto");
const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const { BACKTEST, TIME } = require("@config/constants");
const logger = require("@utils/logger").createModuleLogger("BACKTEST_API", {
    category: "backtest",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});

// Standardize Paths
const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, 'tmp');
const UPLOADS_DEDUP_DIR = path.join(UPLOADS_DIR, 'dedup');
const UPLOADS_BY_SYMBOL_DIR = path.join(UPLOADS_DIR, 'by-symbol');
const UPLOADS_INDEX_FILE = path.join(UPLOADS_DIR, 'index.json');
const REPORTS_DIR = path.join(DATA_DIR, 'backtests');

// Ensure directories exist
ensureDir(UPLOADS_DIR);
ensureDir(UPLOADS_TMP_DIR);
ensureDir(UPLOADS_DEDUP_DIR);
ensureDir(UPLOADS_BY_SYMBOL_DIR);
ensureDir(REPORTS_DIR);
if (!fs.existsSync(UPLOADS_INDEX_FILE)) fs.writeFileSync(UPLOADS_INDEX_FILE, JSON.stringify([]));

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

const safeSymbolName = (symbol = "UNASSIGNED") =>
    String(symbol || "UNASSIGNED").replace(/[^a-zA-Z0-9_.-]/g, "_").toUpperCase();

const readUploadsIndex = () => {
    try {
        const raw = fs.readFileSync(UPLOADS_INDEX_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeUploadsIndex = (items = []) => {
    fs.writeFileSync(UPLOADS_INDEX_FILE, JSON.stringify(items));
};

const upsertUploadMeta = (meta) => {
    const items = readUploadsIndex();
    const idx = items.findIndex((x) => x.id === meta.id);
    if (idx >= 0) items[idx] = meta;
    else items.unshift(meta);
    writeUploadsIndex(items);
    return meta;
};

const removeUploadMeta = (id) => {
    const items = readUploadsIndex();
    const target = items.find((x) => x.id === id) || null;
    const next = items.filter((x) => x.id !== id);
    writeUploadsIndex(next);
    return target;
};

const getDefaultBacktestSettings = async () => {
    const defaults = {
        defaultSymbol: "BTC/USD",
        defaultInterval: TIME.DEFAULT_TIMEFRAMES?.[0] || "1m",
        defaultInitialCapital: 10000,
        defaultOutputsize: 5000,
        includeTrades: true,
        maxUploadMb: MAX_UPLOAD_MB,
        allowedIntervals: TIME.DEFAULT_TIMEFRAMES || ["1m", "5m", "15m", "1h", "4h", "1d"]
    };
    try {
        const persisted = await pgStore.getSystemSettings();
        const payload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload : {};
        const backtest = payload.backtest && typeof payload.backtest === "object" ? payload.backtest : {};
        return { ...defaults, ...backtest };
    } catch {
        return defaults;
    }
};

const persistBacktestSettings = async (settings = {}) => {
    const existing = await pgStore.getSystemSettings();
    const payload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
    const merged = { ...(payload.backtest || {}), ...(settings || {}) };
    await pgStore.upsertSystemSettings({ ...payload, backtest: merged });
    return merged;
};

const buildUploadRecord = async ({ tmpPath, originalname, symbol, source = "manual" }) => {
    const digest = await hashFile(tmpPath);
    const ext = path.extname(originalname || ".csv") || ".csv";
    const dedupPath = path.join(UPLOADS_DEDUP_DIR, `${digest}${ext}`);
    const safeSym = safeSymbolName(symbol);
    const symbolDir = path.join(UPLOADS_BY_SYMBOL_DIR, safeSym);
    ensureDir(symbolDir);
    const symbolPath = path.join(symbolDir, `${digest}${ext}`);

    if (fs.existsSync(dedupPath)) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    } else {
        fs.renameSync(tmpPath, dedupPath);
    }
    if (!fs.existsSync(symbolPath)) {
        fs.copyFileSync(dedupPath, symbolPath);
    }

    const stat = fs.statSync(dedupPath);
    const uploadId = `${safeSym}_${digest.slice(0, 16)}`;
    const meta = {
        id: uploadId,
        digest,
        symbol: safeSym,
        source,
        originalname: String(originalname || `${uploadId}${ext}`),
        ext,
        dedupPath,
        symbolPath,
        size: stat.size,
        createdAt: Date.now()
    };
    return upsertUploadMeta(meta);
};

router.get("/settings", async (req, res) => {
    try {
        const payload = await getDefaultBacktestSettings();
        res.json({ success: true, payload });
    } catch (err) {
        res.status(500).json({ success: false, error: "BACKTEST_SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch("/settings", async (req, res) => {
    try {
        const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {};
        const payload = await persistBacktestSettings(settings);
        res.json({ success: true, payload });
    } catch (err) {
        res.status(500).json({ success: false, error: "BACKTEST_SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

router.get("/uploads", (req, res) => {
    try {
        const symbolFilter = req.query?.symbol ? safeSymbolName(req.query.symbol) : null;
        const rows = readUploadsIndex()
            .filter((x) => !symbolFilter || x.symbol === symbolFilter)
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        res.json({ success: true, payload: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOADS_LIST_FAILED", message: err.message });
    }
});

router.get("/uploads/:uploadId", (req, res) => {
    try {
        const id = String(req.params.uploadId || "");
        const row = readUploadsIndex().find((x) => x.id === id) || null;
        if (!row) return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND" });
        res.json({ success: true, payload: row });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOAD_READ_FAILED", message: err.message });
    }
});

router.post("/uploads", upload.single("dataset"), async (req, res) => {
    let uploadedPath = req.file?.path || null;
    try {
        if (!uploadedPath) return res.status(400).json({ success: false, error: "DATASET_REQUIRED" });
        const symbol = req.body?.symbol || "UNASSIGNED";
        const saved = await buildUploadRecord({
            tmpPath: uploadedPath,
            originalname: req.file?.originalname,
            symbol,
            source: "manual"
        });
        uploadedPath = null;
        logger.info(`Upload created: ${saved.id} (${saved.symbol})`);
        res.json({ success: true, payload: saved });
    } catch (err) {
        const code = err.message === "INVALID_FILE_TYPE" ? 400 : 500;
        res.status(code).json({ success: false, error: "UPLOAD_CREATE_FAILED", message: err.message });
    } finally {
        if (uploadedPath && fs.existsSync(uploadedPath)) {
            try { fs.unlinkSync(uploadedPath); } catch { /* ignore */ }
        }
    }
});

router.delete("/uploads/:uploadId", (req, res) => {
    try {
        const id = String(req.params.uploadId || "");
        const target = removeUploadMeta(id);
        if (!target) return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND" });
        try { if (target.symbolPath && fs.existsSync(target.symbolPath)) fs.unlinkSync(target.symbolPath); } catch { /* ignore */ }
        logger.warn(`Upload deleted: ${id}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOAD_DELETE_FAILED", message: err.message });
    }
});

/**
 * @route GET /api/backtest
 * @desc List reports for the "Data" Tab sidebar
 */
router.get("/", (req, res) => {
    try {
        if (BACKTEST.DB_REQUIRED && !db.hasDbConfig()) {
            return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        }
        cleanupBacktests(REPORTS_DIR);
        cleanupUploads(UPLOADS_DEDUP_DIR);
        if (db.hasDbConfig()) {
            db.query(
                `SELECT id, created_at, report
                 FROM backtests
                 ORDER BY created_at DESC`
            ).then(({ rows }) => {
                const reports = (rows || []).map(r => ({
                    id: r.id,
                    timestamp: new Date(r.created_at).getTime(),
                    size: JSON.stringify(r.report || {}).length,
                    strategyId: r.report?.meta?.strategyId || null,
                    strategyName: r.report?.meta?.strategyName || null,
                    symbol: r.report?.meta?.symbol || null,
                    timeframe: r.report?.meta?.timeframe || null
                }));
                res.json({ success: true, payload: reports });
            }).catch(() => {
                res.json({ success: true, payload: [] });
            });
            return;
        }

        const files = fs.readdirSync(REPORTS_DIR);
        const reports = files
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const stat = fs.statSync(path.join(REPORTS_DIR, file));
                let meta = {};
                try {
                    const raw = fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8');
                    meta = JSON.parse(raw)?.meta || {};
                } catch { /* ignore */ }
                return {
                    id: file.replace('.json', ''),
                    timestamp: stat.mtimeMs,
                    size: stat.size,
                    strategyId: meta.strategyId || null,
                    strategyName: meta.strategyName || null,
                    symbol: meta.symbol || null,
                    timeframe: meta.timeframe || null
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
    try {
        const entry = loader.registry.get(req.params.id);
        if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });

        uploadedPath = req.file?.path || null;
        const systemDefaults = await getDefaultBacktestSettings();
        const warnings = [];
        let selectedUpload = null;

        if (req.body?.uploadId) {
            const wanted = String(req.body.uploadId);
            selectedUpload = readUploadsIndex().find((x) => x.id === wanted) || null;
            if (!selectedUpload) {
                return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND", message: `Unknown uploadId: ${wanted}` });
            }
        }

        if (uploadedPath) {
            selectedUpload = await buildUploadRecord({
                tmpPath: uploadedPath,
                originalname: req.file?.originalname,
                symbol: req.body?.symbol || systemDefaults.defaultSymbol || "UNASSIGNED",
                source: "backtest"
            });
            uploadedPath = null;
        }

        const readNumber = (value, fallback) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : Number(fallback);
        };

        const symbol = String(req.body?.symbol || selectedUpload?.symbol || systemDefaults.defaultSymbol || "BTC/USD");
        const interval = String(req.body?.interval || systemDefaults.defaultInterval || "1m");
        const initialCapital = readNumber(req.body?.initialCapital ?? systemDefaults.defaultInitialCapital, systemDefaults.defaultInitialCapital);
        const includeTrades = String(req.body?.includeTrades ?? String(systemDefaults.includeTrades)) === "true";
        const rangeMode = String(req.body?.rangeMode || "points").toLowerCase();
        const rangePointsRaw = readNumber(req.body?.rangePoints ?? req.body?.outputsize ?? systemDefaults.defaultOutputsize, systemDefaults.defaultOutputsize);
        const outputsizeRaw = readNumber(req.body?.outputsize ?? rangePointsRaw ?? systemDefaults.defaultOutputsize, systemDefaults.defaultOutputsize);
        const rangeStartRaw = req.body?.rangeStart ? Date.parse(String(req.body.rangeStart)) : NaN;
        const rangeEndRaw = req.body?.rangeEnd ? Date.parse(String(req.body.rangeEnd)) : NaN;

        if (!req.body?.symbol && !selectedUpload?.symbol) warnings.push("Symbol missing in request; system default was used.");
        if (!req.body?.interval) warnings.push("Interval missing in request; system default was used.");
        if (!req.body?.initialCapital) warnings.push("Initial capital missing in request; system default was used.");
        if (!req.body?.rangePoints && !req.body?.outputsize) warnings.push("Range points missing in request; system default was used.");
        if (rangeMode === "dates" && Number.isNaN(rangeStartRaw) && Number.isNaN(rangeEndRaw)) {
            warnings.push("Date range mode selected but start/end missing; full dataset used.");
        }
        if (!selectedUpload && !symbol) {
            return res.status(400).json({ success: false, error: "MISSING_DATA_SOURCE", message: "Provide dataset upload, uploadId, or symbol/interval." });
        }

        const outputsize = Number.isFinite(outputsizeRaw) && outputsizeRaw > 0
            ? Math.floor(outputsizeRaw)
            : Number(systemDefaults.defaultOutputsize || 1000);
        const rangePoints = Number.isFinite(rangePointsRaw) && rangePointsRaw > 0
            ? Math.floor(rangePointsRaw)
            : outputsize;

        const options = {
            file: selectedUpload ? { path: selectedUpload.symbolPath || selectedUpload.dedupPath } : null,
            symbol,
            interval,
            initialCapital: Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : Number(systemDefaults.defaultInitialCapital || 10000),
            includeTrades,
            outputsize: rangeMode === "points" ? rangePoints : outputsize,
            rangeMode,
            rangePoints,
            rangeStart: Number.isFinite(rangeStartRaw) ? rangeStartRaw : null,
            rangeEnd: Number.isFinite(rangeEndRaw) ? rangeEndRaw : null
        };

        let instance = entry.instance;
        try {
            const fresh = loader._instantiateStrategy(entry.source || "", entry.id);
            if (fresh) {
                instance = fresh;
                instance.id = entry.id;
                instance.name = entry.id;
            }
        } catch (e) {
            instance = entry.instance;
        }

        const rawParams = req.body.params;
        if (rawParams) {
            try {
                const parsed = JSON.parse(rawParams);
                instance.updateParams?.(parsed);
            } catch (e) {
                warnings.push("Params payload could not be parsed; strategy defaults were used.");
            }
        } else if (instance?.schema && Object.keys(instance.schema).length > 0) {
            warnings.push("Strategy params missing; defaults were used for non-critical parameters.");
        }

        const result = await backtestManager.run(instance, options);

        cleanupBacktests(REPORTS_DIR);
        cleanupUploads(UPLOADS_DEDUP_DIR);

        res.json({
            success: true,
            payload: result,
            meta: {
                warnings,
                optionsApplied: options,
                upload: selectedUpload ? { id: selectedUpload.id, symbol: selectedUpload.symbol, source: selectedUpload.source } : null
            }
        });
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
    if (BACKTEST.DB_REQUIRED && !db.hasDbConfig()) {
        return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
    }
    if (db.hasDbConfig()) {
        db.query(
            `SELECT report FROM backtests WHERE id = $1 LIMIT 1`,
            [String(req.params.reportId)]
        ).then(({ rows }) => {
            if (!rows[0]) return res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
            return res.json({ success: true, payload: rows[0].report || {} });
        }).catch((err) => {
            res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
        });
        return;
    }

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

/**
 * @route DELETE /api/backtest/:reportId
 * @desc Remove a backtest report from DB and filesystem
 */
router.delete("/:reportId", (req, res) => {
    const reportId = String(req.params.reportId);
    if (BACKTEST.DB_REQUIRED && !db.hasDbConfig()) {
        return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
    }
    if (db.hasDbConfig()) {
        db.query(`DELETE FROM backtests WHERE id = $1`, [reportId])
            .then(() => res.json({ success: true }))
            .catch((err) => res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message }));
        return;
    }

    const filePath = path.join(REPORTS_DIR, `${reportId}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
    }

    try {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message });
    }
});

module.exports = router;
