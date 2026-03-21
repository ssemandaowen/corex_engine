"use strict";

const router = require("express").Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const loader = require("@core/strategyLoader");
const storageManager = require("@utils/storageManager");
const crypto = require("crypto");
const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const jobQueue = require("@core/services/jobQueue");
const { BACKTEST, TIME } = require("@config/constants");
const { toScopedId, fromScopedId, sanitizeEntityId } = require("@core/services/userScope");
const logger = require("@utils/logger").createModuleLogger("BACKTEST_API", {
    category: "backtest",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});
const fsp = fs.promises;

// Standardize Paths
const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, 'tmp');
const UPLOADS_DEDUP_DIR = path.join(UPLOADS_DIR, 'dedup');
const UPLOADS_BY_SYMBOL_DIR = path.join(UPLOADS_DIR, 'by-symbol');
const UPLOADS_INDEX_FILE = path.join(UPLOADS_DIR, 'index.json');
const REPORTS_DIR = path.join(DATA_DIR, 'backtests');
const PROGRESS_TTL_MS = 30 * 60 * 1000;
const backtestProgress = new Map();
let storageInit = false;
let storageInitPromise = null;
let uploadsIndexWrite = Promise.resolve();
let uploadsDbInit = false;
let uploadsDbInitPromise = null;

const ensureDirAsync = async (dir) => {
    if (!dir) return;
    await fsp.mkdir(dir, { recursive: true });
};

const ensureStorageReady = async () => {
    if (storageInit) return;
    if (storageInitPromise) return storageInitPromise;
    storageInitPromise = (async () => {
        await ensureDirAsync(UPLOADS_DIR);
        await ensureDirAsync(UPLOADS_TMP_DIR);
        await ensureDirAsync(UPLOADS_DEDUP_DIR);
        await ensureDirAsync(UPLOADS_BY_SYMBOL_DIR);
        await ensureDirAsync(REPORTS_DIR);

        try {
            await fsp.access(UPLOADS_INDEX_FILE);
        } catch {
            await fsp.writeFile(UPLOADS_INDEX_FILE, JSON.stringify([]));
        }

        storageInit = true;
    })().finally(() => {
        if (!storageInit) storageInitPromise = null;
    });
    return storageInitPromise;
};

const getUserId = (req) => String(req.user?.sub || "").trim();
const toPublicScopedId = (req, id) => fromScopedId(getUserId(req), id) || id;
const toScopedReportId = (req, id) => {
    const userId = getUserId(req);
    const reportId = sanitizeEntityId(id);
    if (!userId || !reportId) return "";
    return `${userId}__${reportId}`;
};
const toPublicReportId = (req, id) => {
    const userId = getUserId(req);
    const raw = String(id || "");
    const prefix = `${userId}__`;
    if (userId && raw.startsWith(prefix)) return raw.slice(prefix.length);
    return fromScopedId(userId, raw) || raw;
};
const progressKey = (req, jobId) => toScopedId(getUserId(req), jobId);

const pruneBacktestProgress = () => {
    const now = Date.now();
    for (const [id, job] of backtestProgress.entries()) {
        if ((now - Number(job?.updatedAt || 0)) > PROGRESS_TTL_MS) {
            backtestProgress.delete(id);
        }
    }
};

const toProgressEntry = (jobId) => ({
    jobId,
    status: "RUNNING",
    currentStage: "QUEUED",
    currentMessage: "Backtest queued...",
    pct: 0,
    steps: [{
        stage: "QUEUED",
        message: "Backtest queued...",
        pct: 0,
        ts: Date.now()
    }],
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    error: null,
    resultMeta: null
});

const updateProgress = (key, patch = {}) => {
    const existing = backtestProgress.get(key) || toProgressEntry(key);
    const next = {
        ...existing,
        ...patch,
        updatedAt: Date.now()
    };
    backtestProgress.set(key, next);
    return next;
};

// Note: no side effects at import-time. Storage is initialized lazily per request.

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

const readUploadsIndex = async () => {
    await ensureStorageReady();
    try {
        const raw = await fsp.readFile(UPLOADS_INDEX_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeUploadsIndex = async (items = []) => {
    await ensureStorageReady();
    // Single-writer best-effort to prevent truncation under concurrent writes.
    uploadsIndexWrite = uploadsIndexWrite.then(() => fsp.writeFile(UPLOADS_INDEX_FILE, JSON.stringify(items)));
    return uploadsIndexWrite;
};

const isMissingTableError = (err) => {
    const code = String(err?.code || "").trim();
    const message = String(err?.message || "").toLowerCase();
    return code === "42P01" || message.includes("does not exist") || message.includes("relation") && message.includes("backtest_uploads");
};

const migrateLegacyUploadsIndexToDb = async () => {
    if (!db.hasDbConfig()) return false;
    if (uploadsDbInit) return true;
    if (uploadsDbInitPromise) return uploadsDbInitPromise;

    uploadsDbInitPromise = (async () => {
        try {
            await db.query("SELECT 1 FROM backtest_uploads LIMIT 1");
        } catch (err) {
            if (isMissingTableError(err)) return false;
            throw err;
        }

        const legacyItems = await readUploadsIndex();
        if (legacyItems.length > 0) {
            for (const item of legacyItems) {
                try {
                    await pgStore.upsertBacktestUpload(item);
                } catch (err) {
                    logger.warn(`[UPLOADS] Legacy upload migration skipped for ${item?.id || "unknown"}: ${err.message}`);
                }
            }
        }
        uploadsDbInit = true;
        return true;
    })().finally(() => {
        uploadsDbInitPromise = null;
    });

    return uploadsDbInitPromise;
};

const listUploadsForUser = async (userId, { symbol = null } = {}) => {
    await ensureStorageReady();
    const useDb = await migrateLegacyUploadsIndexToDb().catch(() => false);
    if (useDb) {
        return pgStore.listBacktestUploadsForUser(userId, { symbol, limit: 500 });
    }
    return (await readUploadsIndex())
        .filter((x) => String(x.userId || "") === String(userId || ""))
        .filter((x) => !symbol || safeSymbolName(x.symbol) === safeSymbolName(symbol));
};

const getUploadForUser = async (userId, id) => {
    await ensureStorageReady();
    const scopedId = toScopedId(String(userId || ""), id);
    const useDb = await migrateLegacyUploadsIndexToDb().catch(() => false);
    if (useDb) {
        return pgStore.getBacktestUploadForUser(userId, scopedId);
    }
    return (await readUploadsIndex()).find((x) => x.id === scopedId && String(x.userId || "") === String(userId || "")) || null;
};

const upsertUploadMeta = async (meta) => {
    const useDb = await migrateLegacyUploadsIndexToDb().catch(() => false);
    if (useDb) {
        return pgStore.upsertBacktestUpload(meta);
    }
    const items = await readUploadsIndex();
    const idx = items.findIndex((x) => x.id === meta.id);
    if (idx >= 0) items[idx] = meta;
    else items.unshift(meta);
    await writeUploadsIndex(items);
    return meta;
};

const removeUploadMeta = async (userId, id) => {
    const useDb = await migrateLegacyUploadsIndexToDb().catch(() => false);
    const scopedId = toScopedId(String(userId || ""), id);
    if (useDb) {
        return pgStore.deleteBacktestUploadForUser(userId, scopedId);
    }
    const items = await readUploadsIndex();
    const target = items.find((x) => x.id === scopedId && String(x.userId || "") === String(userId || "")) || null;
    const next = items.filter((x) => !(x.id === scopedId && String(x.userId || "") === String(userId || "")));
    await writeUploadsIndex(next);
    return target;
};

const getDefaultBacktestSettings = async (userId) => {
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
        const persisted = await pgStore.getSystemSettingsForUser(userId);
        const payload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload : {};
        const backtest = payload.backtest && typeof payload.backtest === "object" ? payload.backtest : {};
        return { ...defaults, ...backtest };
    } catch {
        return defaults;
    }
};

const persistBacktestSettings = async (userId, settings = {}) => {
    const existing = await pgStore.getSystemSettingsForUser(userId);
    const payload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
    const merged = { ...(payload.backtest || {}), ...(settings || {}) };
    await pgStore.upsertSystemSettingsForUser(userId, { ...payload, backtest: merged });
    return merged;
};

const fileExists = async (p) => {
    try {
        await fsp.access(p);
        return true;
    } catch {
        return false;
    }
};

const buildUploadRecord = async ({ userId, tmpPath, originalname, symbol, source = "manual" }) => {
    await ensureStorageReady();
    const digest = await hashFile(tmpPath);
    const ext = path.extname(originalname || ".csv") || ".csv";
    const dedupPath = path.join(UPLOADS_DEDUP_DIR, `${digest}${ext}`);
    const safeSym = safeSymbolName(symbol);
    const symbolDir = path.join(UPLOADS_BY_SYMBOL_DIR, safeSym);
    await ensureDirAsync(symbolDir);
    const symbolPath = path.join(symbolDir, `${digest}${ext}`);

    if (await fileExists(dedupPath)) {
        try { await fsp.unlink(tmpPath); } catch { /* ignore */ }
    } else {
        await fsp.rename(tmpPath, dedupPath);
    }
    if (!(await fileExists(symbolPath))) {
        await fsp.copyFile(dedupPath, symbolPath);
    }

    const stat = await fsp.stat(dedupPath);
    const uploadId = toScopedId(userId, `${safeSym}_${digest.slice(0, 16)}`);
    const meta = {
        id: uploadId,
        userId,
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
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const payload = await getDefaultBacktestSettings(userId);
        res.json({ success: true, payload });
    } catch (err) {
        res.status(500).json({ success: false, error: "BACKTEST_SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch("/settings", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {};
        const payload = await persistBacktestSettings(userId, settings);
        res.json({ success: true, payload });
    } catch (err) {
        res.status(500).json({ success: false, error: "BACKTEST_SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

router.get("/uploads", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const symbolFilter = req.query?.symbol ? safeSymbolName(req.query.symbol) : null;
        const rows = (await listUploadsForUser(userId, { symbol: symbolFilter }))
            .filter((x) => !symbolFilter || safeSymbolName(x.symbol) === symbolFilter)
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .map((x) => ({ ...x, id: toPublicReportId(req, x.id) }));
        res.json({ success: true, payload: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOADS_LIST_FAILED", message: err.message });
    }
});

router.get("/uploads/:uploadId", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const row = await getUploadForUser(userId, req.params.uploadId);
        if (!row) return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND" });
        res.json({ success: true, payload: { ...row, id: toPublicReportId(req, row.id) } });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOAD_READ_FAILED", message: err.message });
    }
});

router.post("/uploads", upload.single("dataset"), async (req, res) => {
    let uploadedPath = req.file?.path || null;
    try {
        await ensureStorageReady();
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!uploadedPath) return res.status(400).json({ success: false, error: "DATASET_REQUIRED" });
        const symbol = req.body?.symbol || "UNASSIGNED";
        const saved = await buildUploadRecord({
            userId,
            tmpPath: uploadedPath,
            originalname: req.file?.originalname,
            symbol,
            source: "manual"
        });
        uploadedPath = null;
        logger.info(`Upload created: ${saved.id} (${saved.symbol})`);
        res.json({ success: true, payload: { ...saved, id: toPublicReportId(req, saved.id) } });
    } catch (err) {
        const code = err.message === "INVALID_FILE_TYPE" ? 400 : 500;
        res.status(code).json({ success: false, error: "UPLOAD_CREATE_FAILED", message: err.message });
    } finally {
        if (uploadedPath && (await fileExists(uploadedPath))) {
            try { await fsp.unlink(uploadedPath); } catch { /* ignore */ }
        }
    }
});

router.delete("/uploads/:uploadId", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const target = await getUploadForUser(userId, req.params.uploadId);
        if (!target) return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND" });
        await removeUploadMeta(userId, req.params.uploadId);
        try { if (target.symbolPath && (await fileExists(target.symbolPath))) await fsp.unlink(target.symbolPath); } catch { /* ignore */ }
        logger.warn(`Upload deleted: ${toPublicReportId(req, target.id)}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPLOAD_DELETE_FAILED", message: err.message });
    }
});

/**
 * @route GET /api/backtest
 * @desc List reports for the "Data" Tab sidebar
 */
router.get("/", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) {
            return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        }

        // DB-backed only for production readiness (no blocking FS listing in request path).
        const { rows } = await db.query(
            `SELECT id, created_at, report
             FROM backtests
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        const reports = (rows || []).map(r => ({
            id: toPublicReportId(req, r.id),
            timestamp: new Date(r.created_at).getTime(),
            size: JSON.stringify(r.report || {}).length,
            strategyId: toPublicReportId(req, r.report?.meta?.strategyId || null),
            strategyName: toPublicReportId(req, r.report?.meta?.strategyName || null),
            symbol: r.report?.meta?.symbol || null,
            timeframe: r.report?.meta?.timeframe || null
        }));
        res.json({ success: true, payload: reports });
    } catch (err) {
        res.status(500).json({ success: false, error: "LIST_FAILED", message: err.message });
    }
});

router.get("/jobs", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        const payload = await jobQueue.listJobs({ userId, type: "backtest.run", limit: 100 });
        res.json({ success: true, payload });
    } catch (err) {
        res.status(500).json({ success: false, error: "JOBS_LIST_FAILED", message: err.message });
    }
});

router.get("/jobs/:jobId", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        const jobId = String(req.params.jobId || "").trim();
        const job = await jobQueue.getJob({ id: jobId, userId });
        if (!job) return res.status(404).json({ success: false, error: "JOB_NOT_FOUND" });
        res.json({ success: true, payload: job });
    } catch (err) {
        res.status(500).json({ success: false, error: "JOB_READ_FAILED", message: err.message });
    }
});

router.post("/jobs/:jobId/cancel", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        const jobId = String(req.params.jobId || "").trim();
        const ok = await jobQueue.cancelJob({ id: jobId, userId });
        res.json({ success: true, payload: { cancelled: ok } });
    } catch (err) {
        res.status(500).json({ success: false, error: "JOB_CANCEL_FAILED", message: err.message });
    }
});

// Legacy endpoint kept for UI compatibility (maps to corex_jobs progress state).
router.get("/progress/:jobId", async (req, res) => {
    try {
        pruneBacktestProgress();
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const jobId = String(req.params.jobId || "").trim();
        if (!jobId) return res.status(400).json({ success: false, error: "JOB_ID_REQUIRED" });

        if (db.hasDbConfig()) {
            const job = await jobQueue.getJob({ id: jobId, userId });
            if (!job) return res.status(404).json({ success: false, error: "PROGRESS_NOT_FOUND" });

            const p = job.progress || {};
            const stage = String(p.stage || "").trim() || "QUEUED";
            const pct = Number.isFinite(Number(p.pct)) ? Number(p.pct) : 0;
            const status = job.status === "failed" ? "ERROR"
                : job.status === "succeeded" ? "DONE"
                    : job.status === "cancelled" ? "CANCELLED"
                        : "RUNNING";

            const payload = {
                jobId,
                status,
                currentStage: stage,
                currentMessage: String(p.message || ""),
                pct,
                steps: [],
                startedAt: job.createdAt ? new Date(job.createdAt).getTime() : null,
                updatedAt: job.updatedAt ? new Date(job.updatedAt).getTime() : Date.now(),
                finishedAt: (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")
                    ? (job.updatedAt ? new Date(job.updatedAt).getTime() : Date.now())
                    : null,
                error: job.error || null,
                resultMeta: job.result?.report?.meta || null
            };

            if (payload?.resultMeta?.id) {
                payload.resultMeta = { ...payload.resultMeta, id: toPublicReportId(req, payload.resultMeta.id) };
            }

            return res.json({ success: true, payload });
        }

        const legacy = backtestProgress.get(progressKey(req, jobId));
        if (!legacy) return res.status(404).json({ success: false, error: "PROGRESS_NOT_FOUND" });
        return res.json({ success: true, payload: { ...legacy, jobId } });
    } catch (err) {
        return res.status(500).json({ success: false, error: "PROGRESS_READ_FAILED", message: err.message });
    }
});

/**
 * @route POST /api/backtest/:id
 * @desc Triggered by "Run" Tab for Backtest mode
 */
router.post("/:id", upload.single('dataset'), async (req, res) => {
    let uploadedPath = null;
    try {
        pruneBacktestProgress();
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const scopedStrategyId = toScopedId(userId, req.params.id);
        const entry = loader.registry.get(scopedStrategyId);
        if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });
        const clientJobIdRaw = String(req.body?.clientJobId || "").trim();
        const publicJobId = clientJobIdRaw || crypto.randomUUID().slice(0, 8);
        const runtimeId = toScopedReportId(req, publicJobId);

        uploadedPath = req.file?.path || null;
        const systemDefaults = await getDefaultBacktestSettings(userId);
        const warnings = [];
        let selectedUpload = null;

        if (req.body?.uploadId) {
            selectedUpload = await getUploadForUser(userId, String(req.body.uploadId));
            if (!selectedUpload) {
                return res.status(404).json({ success: false, error: "UPLOAD_NOT_FOUND", message: `Unknown uploadId: ${req.body.uploadId}` });
            }
            pgStore.touchBacktestUploadForUser(userId, selectedUpload.id).catch(() => {});
        }

        if (uploadedPath) {
            selectedUpload = await buildUploadRecord({
                userId,
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
        const interval = String(req.body?.interval || systemDefaults.defaultInterval || "1m").trim();
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
            runtimeId,
            userId,
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

        const rawParams = req.body.params;
        let params = null;
        if (rawParams) {
            try { params = JSON.parse(rawParams); } catch { warnings.push("Params payload could not be parsed; strategy defaults were used."); }
        }

        if (BACKTEST.DB_REQUIRED && !db.hasDbConfig()) {
            return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
        }

        const queued = await jobQueue.enqueue({
            type: "backtest.run",
            userId,
            payload: {
                userId,
                clientJobId: publicJobId,
                strategyId: scopedStrategyId,
                params: params && typeof params === "object" ? params : null,
                options
            },
            maxAttempts: 2
        });

        const progressId = progressKey(req, queued.id);
        updateProgress(progressId, toProgressEntry(progressId));

        // Fire-and-forget cleanup (don't block the response)
        storageManager.cleanupBacktestsAsync(REPORTS_DIR).catch(err => {
            logger.warn(`[CLEANUP] Failed to cleanup backtests: ${err.message}`);
        });
        storageManager.cleanupUploadsAsync(UPLOADS_DEDUP_DIR).catch(err => {
            logger.warn(`[CLEANUP] Failed to cleanup uploads: ${err.message}`);
        });

        return res.status(202).json({
            success: true,
            payload: {
                jobId: queued.id,
                status: queued.status,
                queuedAt: queued.createdAt
            },
            meta: {
                warnings,
                optionsApplied: options,
                progressJobId: queued.id,
                upload: selectedUpload ? { id: toPublicReportId(req, selectedUpload.id), symbol: selectedUpload.symbol, source: selectedUpload.source } : null
            }
        });
    } catch (err) {
        const clientJobIdRaw = String(req.body?.clientJobId || "").trim();
        if (clientJobIdRaw) {
            updateProgress(progressKey(req, clientJobIdRaw), {
                status: "ERROR",
                currentStage: "FAILED",
                currentMessage: err.message,
                pct: 100,
                finishedAt: Date.now(),
                error: err.message
            });
        }
        const code = err.message === "INVALID_FILE_TYPE" ? 400 : 500;
        res.status(code).json({ success: false, error: "SIMULATION_FAILED", message: err.message });
    } finally {
        // CLEANUP: Remove temp upload if any remains
        if (uploadedPath && (await fileExists(uploadedPath))) {
            try { await fsp.unlink(uploadedPath); } catch { /* ignore */ }
        }
    }
});

/**
 * @route GET /api/backtest/:reportId
 * @desc Fetch report data for the "Data" Tab charts
 */
router.get("/:reportId", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
    const scopedReportId = toScopedReportId(req, req.params.reportId);
    db.query(
        `SELECT report FROM backtests WHERE user_id = $1 AND (id = $2 OR id = $3) LIMIT 1`,
        [userId, scopedReportId, String(req.params.reportId || "")]
    ).then(({ rows }) => {
        if (!rows[0]) return res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });
        const report = rows[0].report || {};
        if (report?.meta) {
            report.meta.id = toPublicReportId(req, report.meta.id);
            report.meta.strategyId = toPublicReportId(req, report.meta.strategyId);
            report.meta.strategyName = toPublicReportId(req, report.meta.strategyName);
        }
        return res.json({ success: true, payload: report });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
    });
});

/**
 * @route DELETE /api/backtest/:reportId
 * @desc Remove a backtest report from DB and filesystem
 */
router.delete("/:reportId", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    const reportId = toScopedReportId(req, req.params.reportId);
    if (!db.hasDbConfig()) return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
    db.query(`DELETE FROM backtests WHERE user_id = $1 AND (id = $2 OR id = $3)`, [userId, reportId, String(req.params.reportId || "")])
        .then(() => res.json({ success: true }))
        .catch((err) => res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message }));
});

module.exports = router;
