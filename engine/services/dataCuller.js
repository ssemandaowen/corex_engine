"use strict";

const path    = require("path");
const { promises: fsp } = require("fs");
const logger  = require("@utils/logger");
const storage = require("@utils/storageManager");
const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");

const log = logger.createModuleLogger("DATA_CULLER", { category: "system" });

// ─── Constants ────────────────────────────────────────────────────────────────

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_DAY   = 24 * 60 * 60 * 1000;

// ─── DataCuller ───────────────────────────────────────────────────────────────

class DataCuller {
    constructor() {
        this._timer       = null;
        this._running     = false;
        this._initialized = false;   // guard against double start()
        this._lastRunAt   = 0;
        this._lastResult  = null;
    }

    // ── Config ────────────────────────────────────────────────────────────────

    /**
     * Re-read config on every cycle so env-var changes take effect without
     * a process restart.
     */
    _getConfig() {
        const root = process.env.COREX_DATA_PATH || path.join(process.cwd(), "data");
        return {
            enabled: !["0", "false", "no", "off"].includes(
                String(process.env.COREX_DATA_CULL_ENABLED || "true").toLowerCase()
            ),
            intervalMs: Math.max(60_000, Number(process.env.COREX_DATA_CULL_INTERVAL_MS || 300_000)),
            dirs: {
                cache:      path.join(root, "cache"),
                uploads:    path.join(root, "uploads"),
                backtests:  path.join(root, "backtests")
            },
            limits: {
                maxSizeMb:  Number(process.env.COREX_CULL_MAX_SIZE_MB   || 1024),
                maxAgeDays: Number(process.env.COREX_CULL_MAX_AGE_DAYS  || 7)
            },
            db: {
                uploadsMaxAgeDays: Math.max(1, Number(process.env.COREX_DB_UPLOAD_CULL_MAX_AGE_DAYS || 30)),
                datasetMaxAgeDays: Math.max(1, Number(process.env.COREX_DB_DATASET_CULL_MAX_AGE_DAYS || 14))
            }
        };
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Start the periodic cull cycle.
     * Safe to call only once — subsequent calls are no-ops with a warning.
     */
    start() {
        const cfg = this._getConfig();
        if (!cfg.enabled) {
            log.info("DataCuller disabled via config — skipping start.");
            return false;
        }

        // Guard against double-invocation (e.g. hot-reload, test harness).
        if (this._initialized) {
            log.warn("DataCuller.start() called more than once — ignoring duplicate.");
            return false;
        }

        this._initialized = true;

        // Stagger the first run so the rest of the system can stabilise after boot.
        setTimeout(() => this.runOnce(), 10_000);
        this._timer = setInterval(() => this.runOnce(), cfg.intervalMs);

        log.info(`DataCuller started — interval ${cfg.intervalMs / 1000}s.`);
        return true;
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._initialized = false;
        log.info("DataCuller stopped.");
    }

    /**
     * Expose last result for health/diagnostics endpoints.
     * Returns null if no cycle has completed yet.
     */
    getStatus() {
        return {
            running:      this._running,
            lastRunAt:    this._lastRunAt,
            lastResult:   this._lastResult
        };
    }

    // ── Cycle ─────────────────────────────────────────────────────────────────

    async runOnce() {
        const cfg = this._getConfig();
        if (!cfg.enabled || this._running) return;

        this._running = true;
        const startedAt = Date.now();
        log.info("Starting maintenance cycle...");

        // Run all three subsystems in parallel.
        // Each returns a result object — errors are captured per-subsystem,
        // never swallowed, so a failing hook doesn't abort the others.
        const [cache, backtests, uploads, dbArtifacts] = await Promise.all([
            storage.clampCacheAsync(cfg.dirs.cache)
                .catch((e) => {
                    log.error(`Cache hook failed: ${e.message}`);
                    return { error: e.message };
                }),

            storage.cleanupBacktestsAsync(cfg.dirs.backtests)
                .catch((e) => {
                    log.error(`Backtest hook failed: ${e.message}`);
                    return { error: e.message };
                }),

            this._cullDirectory(cfg.dirs.uploads, cfg.limits),

            this._cullBacktestDbArtifacts(cfg).catch((e) => {
                log.error(`Backtest DB cull hook failed: ${e.message}`);
                return { error: e.message };
            })
        ]);

        const durationMs = Date.now() - startedAt;

        // Derive ok from whether any subsystem actually errored.
        const ok = ![cache, backtests, uploads, dbArtifacts].some((r) => r?.error != null);

        this._lastResult = { ok, durationMs, stats: { cache, backtests, uploads, dbArtifacts } };
        this._lastRunAt  = Date.now();
        this._running    = false;

        if (ok) {
            log.info(
                `Cull complete — removed ${uploads.deleted ?? 0} file(s) from uploads.`,
                { durationMs }
            );
        } else {
            log.warn(
                `Cull finished with errors — check stats for details.`,
                { durationMs, stats: this._lastResult.stats }
            );
        }
    }

    async _cullBacktestDbArtifacts(cfg) {
        if (!db.hasDbConfig()) {
            return { uploadsDeleted: 0, datasetsDeleted: 0, filesDeleted: 0 };
        }

        let expiredUploads = [];
        try {
            expiredUploads = await pgStore.deleteExpiredBacktestUploads(cfg.db.uploadsMaxAgeDays);
        } catch (err) {
            if (String(err?.code || "") !== "42P01") throw err;
            return { uploadsDeleted: 0, datasetsDeleted: 0, filesDeleted: 0 };
        }
        let filesDeleted = 0;
        for (const row of expiredUploads) {
            // Only remove user-scoped symbol copies; dedup blobs are shared and
            // remain under regular filesystem age/size culling.
            if (row?.symbolPath) {
                const removed = await this._safeUnlink({ path: row.symbolPath }).catch(() => false);
                if (removed) filesDeleted += 1;
            }
        }

        const datasetsDeleted = await pgStore.deleteExpiredBacktestDatasets(cfg.db.datasetMaxAgeDays);
        return {
            uploadsDeleted: Number(expiredUploads.length || 0),
            datasetsDeleted: Number(datasetsDeleted || 0),
            filesDeleted
        };
    }

    // ── Directory culling ─────────────────────────────────────────────────────

    /**
     * Delete files in `dir` that are either older than maxAgeDays OR push
     * the total directory size above maxSizeMb (oldest-first eviction).
     *
     * The size-pressure pass only removes files strictly needed to get back
     * under budget — it will never delete a file that is both new AND within
     * the size budget.
     *
     * @returns {{ deleted: number, skipped: number, finalSizeMb: string } | { error: string }}
     */
    async _cullDirectory(dir, { maxSizeMb, maxAgeDays }) {
        const maxBytes = maxSizeMb * BYTES_PER_MB;
        const maxAgeMs = maxAgeDays * MS_PER_DAY;
        const now      = Date.now();

        try {
            const files = await this._scan(dir);
            if (files.length === 0) {
                return { deleted: 0, skipped: 0, finalSizeMb: "0.00" };
            }

            // Oldest first — eviction order for size-pressure pass.
            files.sort((a, b) => a.mtime - b.mtime);

            let deleted     = 0;
            let skipped     = 0;
            let currentSize = files.reduce((acc, f) => acc + f.size, 0);

            for (const file of files) {
                const age        = now - file.mtime;
                const isTooOld   = age > maxAgeMs;
                const isOverSize = currentSize > maxBytes;

                if (!isTooOld && !isOverSize) continue;

                const removed = await this._safeUnlink(file);
                if (removed) {
                    currentSize -= file.size;
                    deleted++;
                } else {
                    skipped++;
                }
            }

            return {
                deleted,
                skipped,
                finalSizeMb: (currentSize / BYTES_PER_MB).toFixed(2)
            };

        } catch (e) {
            log.error(`_cullDirectory("${dir}") failed: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Unlink a single file.
     *
     * Returns true if the file was successfully deleted.
     * Returns false (and logs) if the unlink fails for any reason other than
     * the file already being gone (ENOENT is treated as a benign race).
     *
     * Critically: does NOT increment the deleted counter on failure, so
     * size accounting stays accurate.
     */
    async _safeUnlink(file) {
        try {
            await fsp.unlink(file.path);
            return true;
        } catch (e) {
            if (e.code === "ENOENT") {
                // Already removed by another process — treat as success
                // so size accounting remains consistent.
                return true;
            }
            // Real error (permissions, locks, I/O) — log and skip.
            log.warn(`Failed to delete "${file.path}": [${e.code}] ${e.message}`);
            return false;
        }
    }

    // ── Filesystem scan ───────────────────────────────────────────────────────

    /**
     * Recursively collect all files under `dir`.
     *
     * Error handling is explicit:
     *  - ENOENT: directory doesn't exist yet — silently return empty (valid on
     *    first boot before any data has been written).
     *  - All other errors are re-thrown so the caller can record them properly
     *    rather than silently returning an incomplete file list.
     *
     * @param  {string}   dir
     * @param  {object[]} [_acc]  - internal accumulator for recursion
     * @returns {Promise<Array<{ path: string, size: number, mtime: number }>>}
     */
    async _scan(dir, _acc = []) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (e) {
            if (e.code === "ENOENT") return _acc;   // directory not yet created — fine
            throw e;                                  // permission error, I/O error, etc.
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await this._scan(fullPath, _acc);
                continue;
            }

            if (!entry.isFile()) continue;  // skip symlinks, sockets, etc.
            if (String(entry.name || "").toLowerCase() === "index.json") continue;

            try {
                const stat = await fsp.stat(fullPath);
                _acc.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
            } catch (e) {
                if (e.code === "ENOENT") continue;  // deleted between readdir and stat — benign
                log.warn(`Could not stat "${fullPath}": [${e.code}] ${e.message}`);
                // Don't push — omitting an unreadable file is safer than corrupt size accounting.
            }
        }

        return _acc;
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

module.exports = new DataCuller();
