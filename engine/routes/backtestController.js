"use strict";

const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const loader = require("@core/core/loader/StrategyLoader");
const storageManager = require("@utils/storageManager");
const crypto = require("crypto");
const db = require("@core/services/postgres"); 
const pgStore = require("@core/services/pgStore"); 
const jobQueue = require("@core/services/jobQueue"); 
const { MAX_BARS_LIMIT } = require("@core/core/backtestDataResolver");
const { bus, EVENTS } = require("@events/bus"); 
const { BACKTEST, TIME } = require("@config/constants"); 
const { toScopedId, fromScopedId, sanitizeEntityId } = require("@core/services/userScope");
const logger = require("@utils/logger").createModuleLogger("BACKTEST_API", {
    category: "backtest",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});
const fsp = fs.promises;

// Standardize Paths
const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, "tmp");
const UPLOADS_DEDUP_DIR = path.join(UPLOADS_DIR, "dedup");
const UPLOADS_BY_SYMBOL_DIR = path.join(UPLOADS_DIR, "by-symbol");
const UPLOADS_INDEX_FILE = path.join(UPLOADS_DIR, "index.json");
const REPORTS_DIR = path.join(DATA_DIR, "backtests");
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
const toScopedReportId = (req, id) => toScopedId(getUserId(req), id);
const toPublicReportId = (req, id) => fromScopedId(getUserId(req), id) || id;
const progressKey = (req, jobId) => toScopedId(getUserId(req), jobId);

// Note: no side effects at import-time. Storage is initialized lazily per request.

// Configure Multer for CSV datasets
const MAX_UPLOAD_MB = Number(process.env.BACKTEST_MAX_MB || 50);

// Per-user dataset quotas (Phase C — data safety limits)
const MAX_UPLOADS_PER_USER = Math.max(1, Number(process.env.COREX_MAX_UPLOADS_PER_USER || 10));
const MAX_UPLOAD_STORAGE_MB_PER_USER = Math.max(1, Number(process.env.COREX_MAX_UPLOAD_STORAGE_MB || 500));
const MAX_UPLOAD_STORAGE_BYTES_PER_USER = MAX_UPLOAD_STORAGE_MB_PER_USER * 1024 * 1024;

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

/**
 * Streams a CSV (or .gz) file to determine its bar count and the time
 * range it covers, without loading the whole file into memory.
 * Used at upload time to calibrate range/points validation for the
 * Backtest "Run" form (Phase C).
 *
 * @returns {Promise<{ barsCount: number, firstTime: number|null, lastTime: number|null }>}
 */
const scanCsvBarRange = async (filePath) => {
    const readline = require("readline");
    const zlib = require("zlib");

    let stream = fs.createReadStream(filePath);
    if (filePath.endsWith(".gz")) {
        stream = stream.pipe(zlib.createGunzip());
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let header = null;
    let timeIdx = -1;
    let barsCount = 0;
    let firstTime = null;
    let lastTime = null;

    const parseTimeValue = (raw) => {
        if (raw === undefined || raw === null || raw === "") return null;
        const num = Number(raw);
        if (Number.isFinite(num)) return num < 1e11 ? num * 1000 : num;
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : null;
    };

    try {
        for await (const line of rl) {
            if (!line || !line.trim()) continue;

            if (!header) {
                header = line.split(",").map((h) => h.trim().toLowerCase());
                timeIdx = header.findIndex((h) =>
                    ["time", "timestamp", "datetime", "date", "at"].includes(h)
                );
                continue;
            }

            barsCount += 1;

            if (timeIdx >= 0) {
                const cols = line.split(",");
                const t = parseTimeValue(cols[timeIdx]);
                if (t !== null) {
                    if (firstTime === null) firstTime = t;
                    lastTime = t;
                }
            }
        }
    } finally {
        rl.close();
    }

    return { barsCount, firstTime, lastTime };
};

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
        symbol: "EUR/USD",
        timeframe: "1m",
        initialCapital: 10000,
        rangePoints: 1000,
        includeTrades: true,
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
    const safeSym = safeSymbolName(symbol);
    const digest = await hashFile(tmpPath);
    const ext = path.extname(originalname || ".csv") || ".csv";
    const dedupPath = path.join(UPLOADS_DEDUP_DIR, `${digest}${ext}`);
    const symbolDir = path.join(UPLOADS_BY_SYMBOL_DIR, safeSym);
    await ensureDirAsync(symbolDir);
    const symbolPath = path.join(symbolDir, `${digest.slice(0,16)}${ext}`);

    if (await fileExists(dedupPath)) {
        try { await fsp.unlink(tmpPath); } catch { /* ignore */ }
    } else {
        await fsp.rename(tmpPath, dedupPath);
    }
    if (!(await fileExists(symbolPath))) {
        await fsp.copyFile(dedupPath, symbolPath);
    }

    const stat = await fsp.stat(dedupPath);
    const uploadId = toScopedId(userId, `${digest}`);

    // Phase C: calibrate range/points validation by scanning the dataset
    // once at upload time (best-effort — never blocks the upload).
    let barsCount = null;
    let timeRange = null;
    try {
        const scan = await scanCsvBarRange(dedupPath);
        barsCount = scan.barsCount;
        if (scan.firstTime !== null && scan.lastTime !== null) {
            timeRange = { firstTime: scan.firstTime, lastTime: scan.lastTime };
        }
    } catch (err) {
        // Non-fatal: range validation will simply be skipped for this upload.
    }

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
        barsCount,
        meta: timeRange ? { timeRange } : {},
        createdAt: Date.now()
    };
    const saved = await upsertUploadMeta(meta); 
    bus.emit( 
        EVENTS.BACKTEST.UPLOAD_CREATED, 
        { 
            upload: { 
                id: saved?.id || uploadId, 
                symbol: safeSym, 
                source, 
                originalname: saved?.originalname || meta.originalname, 
                createdAt: saved?.createdAt || meta.createdAt 
            } 
        }, 
        { userId } 
    ); 
    return saved; 
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
            .map((x) => ({ 
                ...x, 
                id: toPublicReportId(req, x.id),
                sizeLabel: (Number(x.size || 0) / (1024 * 1024)).toFixed(2) + " MB",
                dateLabel: new Date(Number(x.createdAt || 0)).toLocaleString()
            }));
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

        // Phase C: enforce per-user dataset quotas before accepting the file.
        const usage = await pgStore.getBacktestUploadUsageForUser(userId).catch(() => ({ count: 0, totalBytes: 0 }));
        const incomingBytes = Number(req.file?.size || 0);

        if (usage.count >= MAX_UPLOADS_PER_USER) {
            return res.status(413).json({
                success: false,
                error: "UPLOAD_QUOTA_EXCEEDED",
                message: `You have reached the maximum of ${MAX_UPLOADS_PER_USER} datasets. Delete an existing dataset before uploading a new one.`,
                quota: { maxUploads: MAX_UPLOADS_PER_USER, currentUploads: usage.count }
            });
        }

        if (usage.totalBytes + incomingBytes > MAX_UPLOAD_STORAGE_BYTES_PER_USER) {
            return res.status(413).json({
                success: false,
                error: "STORAGE_QUOTA_EXCEEDED",
                message: `This upload would exceed your ${MAX_UPLOAD_STORAGE_MB_PER_USER}MB storage limit. Delete existing datasets to free up space.`,
                quota: {
                    maxBytes: MAX_UPLOAD_STORAGE_BYTES_PER_USER,
                    currentBytes: usage.totalBytes,
                    incomingBytes
                }
            });
        }

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
        bus.emit( 
            EVENTS.BACKTEST.UPLOAD_DELETED, 
            { 
                upload: { 
                    id: target?.id || toScopedId(userId, req.params.uploadId), 
                    symbol: target?.symbol || null, 
                    source: target?.source || null 
                } 
            }, 
            { userId } 
        ); 
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

            let status = "RUNNING";
            if (job.status === "failed") status = "ERROR";
            else if (job.status === "succeeded") status = "DONE";
            else if (job.status === "cancelled") {
                // Keep in RUNNING state if we are still waiting for the worker to stop safely.
                status = (stage === "CANCELLED" || stage === "FAILED") ? "CANCELLED" : "RUNNING";
            }

            const payload = {
                jobId,
                progressJobId: jobId,
                status,
                currentStage: stage,
                currentMessage: String(p.message || ""),
                pct,
                steps: p.steps || [{ stage, message: String(p.message || ""), pct, ts: job.updatedAt }],
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

        return res.status(503).json({ success: false, error: "BACKTEST_DB_REQUIRED" });
    } catch (err) {
        return res.status(500).json({ success: false, error: "PROGRESS_READ_FAILED", message: err.message });
    }
});

/**
 * @route POST /api/backtest/:id
 * @desc Triggered by "Run" Tab for Backtest mode
 */
router.post("/:id", upload.single("dataset"), async (req, res) => {
    let uploadedPath = null;
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const scopedStrategyId = toScopedId(userId, req.params.id);
        let entry = loader.get(scopedStrategyId);
        if (!entry) {
            // Strategy may exist but not be compiled yet (lazy/on-demand loading) —
            // check the DB before rejecting.
            const { rows } = await db.query(
                "SELECT name FROM strategies WHERE name = $1 LIMIT 1",
                [scopedStrategyId]
            );
            if (!rows?.[0]) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });
            entry = { id: scopedStrategyId };
        }
        const publicJobId = crypto.randomUUID().slice(0, 8);
        const runtimeId = toScopedReportId(req, publicJobId);

        uploadedPath = req.file?.path || null;
        let selectedUpload = null;

        const readNumber = (value, fallback) => {
            if (value === undefined || value === null || value === "") return fallback;
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };

        if (req.body?.uploadId) {
            selectedUpload = await getUploadForUser(userId, String(req.body.uploadId));
            if (!selectedUpload) {
                return res.status(400).json({ success: false, error: "INVALID_DATASET", message: "The selected dataset no longer exists or is unavailable." });
            }
            pgStore.touchBacktestUploadForUser(userId, selectedUpload.id).catch(() => {});
        }

        if (uploadedPath) {
            if (!req.body?.symbol) return res.status(400).json({ success: false, error: "SYMBOL_REQUIRED", message: "Please provide a symbol for the uploaded dataset." });
            selectedUpload = await buildUploadRecord({
                userId,
                tmpPath: uploadedPath,
                originalname: req.file?.originalname,
                symbol: req.body.symbol,
                source: "backtest"
            });
            uploadedPath = null;
        }

        // Senior Initiation: Clearly distinguish between CSV-driven (Offline) and API-driven (Online).
        // Honor the explicit dataSource the frontend actually sent ("ONLINE"/"OFFLINE"),
        // falling back to upload-presence detection for legacy/automation callers.
        const explicitDataSource = String(req.body?.dataSource || "").trim().toUpperCase();
        let dataSourceType;
        if (explicitDataSource === "OFFLINE") {
            if (!selectedUpload) {
                return res.status(400).json({
                    success: false,
                    error: "OFFLINE_REQUIRES_DATASET",
                    message: "Offline CSV mode was selected, but no dataset is attached. Please upload a CSV file (or pick an existing upload) and try again."
                });
            }
            dataSourceType = "OFFLINE_CSV";
        } else if (explicitDataSource === "ONLINE") {
            dataSourceType = "ONLINE_API";
        } else {
            dataSourceType = selectedUpload ? "OFFLINE_CSV" : "ONLINE_API";
        }
        
        const symbol = (req.body?.symbol || selectedUpload?.symbol || "").toUpperCase().replace(/[^A-Z0-9/_.-]/g, "");
        const safeSym = safeSymbolName(symbol);
        if (!symbol) return res.status(400).json({ success: false, error: "SYMBOL_REQUIRED", message: "Market symbol is required for simulation." });

        const interval = String(req.body?.interval || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
        if (dataSourceType === "ONLINE_API" && !interval) {
            return res.status(400).json({ success: false, error: "INTERVAL_REQUIRED", message: "Timeframe interval is required for Online API mode." });
        }

        const initialCapital = readNumber(req.body?.initialCapital, null);
        if (initialCapital === null || initialCapital <= 0) {
            return res.status(400).json({ success: false, error: "CAPITAL_REQUIRED", message: "Starting capital must be a valid positive number." });
        }

        const clampPct = (value) => Math.min(100, Math.max(0, value));
        const stopLossPct = clampPct(readNumber(req.body.stopLossPct, 0));
        const takeProfitPct = clampPct(readNumber(req.body.takeProfitPct, 0));
        const trailingStopLossPct = clampPct(readNumber(req.body.trailingStopLossPct, 0));

        const includeTrades = String(req.body?.includeTrades || "true") === "true";
        const rangeMode = String(req.body?.rangeMode || "points").toLowerCase();

        const rangePoints = readNumber(req.body?.rangePoints ?? req.body?.outputsize, null);
        if (rangeMode === "points") {
            if (rangePoints === null) {
                return res.status(400).json({ success: false, error: "RANGE_REQUIRED", message: "Number of data points is required for 'Points' range mode." });
            }
            if (rangePoints <= 0) {
                return res.status(400).json({ success: false, error: "RANGE_REQUIRED", message: "Number of data points must be greater than zero." });
            }
        }

        const rangeStartRaw = req.body?.rangeStart ? Date.parse(String(req.body.rangeStart)) : NaN;
        const rangeEndRaw = req.body?.rangeEnd ? Date.parse(String(req.body.rangeEnd)) : NaN;

        if (rangeMode === "dates" && (Number.isNaN(rangeStartRaw) || Number.isNaN(rangeEndRaw))) {
            return res.status(400).json({ success: false, error: "DATES_REQUIRED", message: "Both Start and End dates must be selected for Date Range mode." });
        }

        // Phase C: calibrate the requested range against the dataset's known
        // bar count / time coverage (offline/CSV mode only).
        if (selectedUpload) {
            const knownBars = Number.isFinite(Number(selectedUpload.barsCount)) ? Number(selectedUpload.barsCount) : null;
            const timeRange = selectedUpload.meta?.timeRange || null;

            if (rangeMode === "points" && knownBars !== null && rangePoints !== null) {
                if (rangePoints > knownBars) {
                    return res.status(400).json({
                        success: false,
                        error: "RANGE_EXCEEDS_DATASET",
                        message: `Requested ${rangePoints} bars, but this dataset only contains ${knownBars} bars.`,
                        dataset: { barsCount: knownBars }
                    });
                }
                if (rangePoints <= 0) {
                    return res.status(400).json({ success: false, error: "RANGE_REQUIRED", message: "Number of data points must be greater than zero." });
                }
            }

            if (rangeMode === "dates" && timeRange) {
                const { firstTime, lastTime } = timeRange;
                if (rangeStartRaw > lastTime || rangeEndRaw < firstTime) {
                    return res.status(400).json({
                        success: false,
                        error: "RANGE_OUTSIDE_DATASET",
                        message: `Selected date range does not overlap with this dataset's coverage (${new Date(firstTime).toISOString()} to ${new Date(lastTime).toISOString()}).`,
                        dataset: { firstTime, lastTime }
                    });
                }
            }
        }

        if (dataSourceType === "ONLINE_API" && rangeMode === "points" && (rangePoints || 0) > MAX_BARS_LIMIT) {
            return res.status(400).json({ 
                success: false, 
                error: "LIMIT_EXCEEDED", 
                message: `Maximum ${MAX_BARS_LIMIT} bars allowed for API fetch. Please reduce range or use CSV upload for larger datasets.` 
            });
        }

        let resolvedFile = null;
        if (selectedUpload) {
            const symbolPath = selectedUpload.symbolPath ? String(selectedUpload.symbolPath) : "";
            const dedupPath = selectedUpload.dedupPath ? String(selectedUpload.dedupPath) : "";
            const symbolOk = symbolPath ? await fileExists(symbolPath) : false;
            const dedupOk = dedupPath ? await fileExists(dedupPath) : false;

            if (symbolOk) {
                resolvedFile = { path: symbolPath };
            } else if (dedupOk) {
                resolvedFile = { path: dedupPath };
                // Self-heal: restore missing per-symbol copy from dedup blob (best-effort).
                if (symbolPath) {
                    try {
                        await ensureDirAsync(path.dirname(symbolPath));
                        await fsp.copyFile(dedupPath, symbolPath);
                    } catch { /* ignore */ }
                }
            } else {
                throw new Error(`UPLOAD_FILE_MISSING: ${toPublicReportId(req, selectedUpload.id)}`);
            }
        }

        // Package options for the BacktestManager configuration resolver
        const options = {
            runtimeId,
            userId,
            dataMode: dataSourceType === "OFFLINE_CSV" ? "offline" : "online",
            file: resolvedFile,
            symbol,
            interval: interval, // Aligned with internal engine expectations
            initialCapital,
            includeTrades,
            rangeMode,
            rangePoints: rangePoints || 1000,
            stopLossPct,
            takeProfitPct,
            trailingStopLossPct,
            // ── Realism config (passed through to BacktestBroker) ────────────
            commissionPct:  Number(req.body.commissionPct  ?? 0) || 0,
            slippageBps:    Number(req.body.slippageBps    ?? 0) || 0,
            spread:         Number(req.body.spread         ?? 0) || 0,
            // ── Execution quota (passed to _runSimulation) ───────────────────
            barBudgetMs:     Number(req.body.barBudgetMs     ?? 100) || 100,
            barBudgetStrikes: Number(req.body.barBudgetStrikes ?? 5)  || 5,
            batchSize:       Number(req.body.batchSize       ?? 500) || 500,
        };
        
        let params = req.body.params;
        if (typeof params === "string") {
            try { params = JSON.parse(params); } catch { params = null; }
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
                progressJobId: queued.id,
                status: queued.status,
                queuedAt: queued.createdAt
            },
            meta: { progressJobId: queued.id, dataSourceType }
        });
    } catch (err) {
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
    // Kept sync wrapper for backward compatibility; delegates to async handler.
    (async () => {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const reportId = sanitizeEntityId(String(req.params.reportId || ""));
        const scopedReportId = toScopedReportId(req, reportId);

        let report = null;

        // Primary source: Postgres (authoritative when present).
        if (db.hasDbConfig()) {
            try {
                const { rows } = await db.query(
                    "SELECT report FROM backtests WHERE user_id = $1 AND (id = $2 OR id = $3) LIMIT 1",
                    [userId, scopedReportId, reportId]
                );
                if (rows?.[0]?.report) report = rows[0].report;
            } catch (err) {
                logger.warn(`Backtest DB read failed (fallback to file): ${err.message}`);
            }
        }

        // Fallback: filesystem snapshot (keeps UI responsive even if DB write fails).
        if (!report) {
            await ensureStorageReady();
            const candidates = [
                path.join(REPORTS_DIR, `${scopedReportId}.json`),
                path.join(REPORTS_DIR, `${reportId}.json`)
            ];
            for (const p of candidates) {
                if (!(await fileExists(p))) continue;
                try {
                    const raw = await fsp.readFile(p, "utf8");
                    report = JSON.parse(raw);
                    break;
                } catch (err) {
                    logger.warn(`Backtest file read failed: ${err.message}`);
                }
            }
        }

        if (!report) return res.status(404).json({ success: false, error: "REPORT_NOT_FOUND" });

        if (report?.meta) {
            report.meta.id = toPublicReportId(req, report.meta.id);
            report.meta.strategyId = toPublicReportId(req, report.meta.strategyId);
            report.meta.strategyName = toPublicReportId(req, report.meta.strategyName);
        }

        // Trade Truncation for UI Performance
        if (report.trades && Array.isArray(report.trades) && report.trades.length > 50) {
            report.summary = { ...report.summary, totalTrades: report.trades.length };
            report.trades = report.trades.slice(0, 50);
            report.isTruncated = true;
            report.fullDownloadUrl = `/api/backtest/download/${reportId}`;
        }

        return res.json({ success: true, payload: report });
    })().catch((err) => {
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

    (async () => {
        const publicId = sanitizeEntityId(String(req.params.reportId || ""));

        // Best-effort DB delete.
        if (db.hasDbConfig()) {
            await db.query(
                "DELETE FROM backtests WHERE user_id = $1 AND (id = $2 OR id = $3)",
                [userId, reportId, publicId]
            ).catch(() => {});
        }

        // Best-effort file delete.
        await ensureStorageReady();
        const p1 = path.join(REPORTS_DIR, `${reportId}.json`);
        const p2 = path.join(REPORTS_DIR, `${publicId}.json`);
        if (await fileExists(p1)) {
            try { await fsp.unlink(p1); } catch { /* ignore */ }
        }
        if (await fileExists(p2)) {
            try { await fsp.unlink(p2); } catch { /* ignore */ }
        }

        return res.json({ success: true });
    })().catch((err) => res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message }));
});

module.exports = router;