"use strict";

const fs = require("fs");
const { promises: fsp } = fs;
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");
const { TIME } = require("@config/constants");
const dataForge = require("data-forge");
require("data-forge-fs");

const gunzipAsync = promisify(zlib.gunzip);
const gzipAsync = promisify(zlib.gzip);

const DAY_MS = TIME.MS.DAY;

const config = {
    backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90, maxSizeMb: 2000 },
    cache:     { maxSizeMb: 500, maxAgeDays: 30 },
    uploads:   { maxSizeMb: 500, maxAgeDays: 30 }
};

/** ─── Private Helpers ────────────────────────────────────────────────────── **/

const safeUnlinkAsync = async (p) => { 
    try { await fsp.unlink(p); return true; } 
    catch (e) { return e.code === "ENOENT"; } 
};

const getFileDataAsync = async (dir) => {
    try {
        const names = await fsp.readdir(dir);
        const stats = await Promise.all(names.map(async (name) => {
            const fullPath = path.join(dir, name);
            try {
                const stat = await fsp.stat(fullPath);
                return stat.isFile() ? { path: fullPath, name, mtimeMs: stat.mtimeMs, size: stat.size } : null;
            } catch { return null; }
        }));
        return stats.filter(Boolean);
    } catch { return []; }
};

const stableRand01 = (input) => {
    const hash = crypto.createHash("sha256").update(String(input)).digest();
    return hash.readUInt32BE(0) / 0xFFFFFFFF;
};

/** ─── Core Logic ─────────────────────────────────────────────────────────── **/

const pruneByAgeAndSizeAsync = async (dir, opts) => {
    const maxBytes = (Number(opts.maxSizeMb) || 500) * 1024 * 1024;
    const maxAgeMs = (Number(opts.maxAgeDays) || 30) * DAY_MS;
    const now = Date.now();

    let files = (await getFileDataAsync(dir)).sort((a, b) => a.mtimeMs - b.mtimeMs);
    let currentTotalSize = files.reduce((acc, f) => acc + f.size, 0);
    let deletedCount = 0;

    for (const f of files) {
        const isTooOld = (now - f.mtimeMs) > maxAgeMs;
        const isOverSize = currentTotalSize > maxBytes;

        if (isTooOld || isOverSize) {
            if (await safeUnlinkAsync(f.path)) {
                currentTotalSize -= f.size;
                deletedCount++;
            }
        }
    }
    return { remainingBytes: currentTotalSize, deletedCount };
};

/** ─── Exports ────────────────────────────────────────────────────────────── **/

const manager = {
    setConfig: (next = {}) => {
        Object.keys(config).forEach(k => { if (next[k]) config[k] = { ...config[k], ...next[k] }; });
        return manager.getConfig();
    },

    getConfig: () => JSON.parse(JSON.stringify(config)),

    ensureDir: (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); },

    /**
     * Probabilistic Pruning: Keeps recent data dense, thins out old data.
     * Enforces a 'keepN' floor and a 'maxSizeMb' ceiling.
     */
    cleanupBacktestsAsync: async (dir, opts = {}) => {
        const cfg = { ...config.backtests, ...opts };
        const maxBytes = cfg.maxSizeMb * 1024 * 1024;
        const now = Date.now();

        let files = (await getFileDataAsync(dir))
            .filter(f => f.name.toLowerCase().endsWith(".json"))
            .sort((a, b) => b.mtimeMs - a.mtimeMs); // Newest first

        let currentTotalSize = files.reduce((acc, f) => acc + f.size, 0);
        let deleted = 0;

        // Start processing candidates beyond the keepN safety floor
        const candidates = files.slice(cfg.keepN);

        for (const f of candidates) {
            const ageDays = (now - f.mtimeMs) / DAY_MS;
            const decayProb = 1 - Math.pow(0.5, ageDays / Math.max(cfg.halfLifeDays, 1));
            
            const isTooOld = ageDays >= cfg.maxAgeDays;
            const isOverSize = currentTotalSize > maxBytes;
            const shouldDecay = stableRand01(f.name) < decayProb;

            if (isTooOld || isOverSize || shouldDecay) {
                if (await safeUnlinkAsync(f.path)) {
                    deleted++;
                    currentTotalSize -= f.size;
                }
            }
        }

        return { kept: files.length - deleted, deleted, remainingMb: (currentTotalSize / (1024 * 1024)).toFixed(2) };
    },

    clampCacheAsync: (dir, opts = {}) => 
        pruneByAgeAndSizeAsync(dir, { ...config.cache, ...opts }),
    
    cleanupUploadsAsync: (dir, opts = {}) => 
        pruneByAgeAndSizeAsync(dir, { ...config.uploads, ...opts }),

    /**
     * Gzip a file to `${filePath}.gz` (streaming). Returns the gz path.
     * If the gz already exists, this is a no-op (optionally deletes the source).
     */
    gzipFileAsync: async (filePath, opts = {}) => {
        const src = String(filePath || "").trim();
        if (!src) throw new Error("FILE_PATH_REQUIRED");
        const deleteSource = opts.deleteSource !== undefined ? !!opts.deleteSource : true;
        if (src.endsWith(".gz")) return { gzPath: src, changed: false };

        const gzPath = `${src}.gz`;

        const srcExists = fs.existsSync(src);
        const gzExists = fs.existsSync(gzPath);

        if (!srcExists && gzExists) return { gzPath, changed: false };
        if (!srcExists && !gzExists) throw Object.assign(new Error(`ENOENT: ${src}`), { code: "ENOENT" });

        if (gzExists) {
            if (deleteSource) await safeUnlinkAsync(src);
            return { gzPath, changed: false };
        }

        await fsp.mkdir(path.dirname(gzPath), { recursive: true }).catch(() => {});

        const tmp = `${gzPath}.tmp`;
        const gzip = zlib.createGzip({
            level: Number.isFinite(Number(opts.level)) ? Number(opts.level) : zlib.constants.Z_BEST_SPEED
        });

        await pipeline(
            fs.createReadStream(src),
            gzip,
            fs.createWriteStream(tmp)
        );

        await fsp.rename(tmp, gzPath);
        if (deleteSource) await safeUnlinkAsync(src);

        return { gzPath, changed: true };
    },

    readCsvOrGz: async (filePath) => {
        const variants = [filePath, `${filePath}.gz`];
        for (const p of variants) {
            try {
                const raw = await fsp.readFile(p);
                const decoded = p.endsWith(".gz")
                    ? (await gunzipAsync(raw)).toString("utf8")
                    : raw.toString("utf8");
                if (!decoded.trim()) return [];
                return dataForge.fromCSV(decoded, { dynamicTyping: true }).toRows();
            } catch (err) {
                // If the file doesn't exist, try the next variant.
                // For any other error (e.g., malformed CSV), we should fail fast.
                if (err.code === "ENOENT") continue;
                throw err;
            }
        }
        throw new Error(`ENOENT: no such file or directory, could not read '${filePath}' or '${filePath}.csv.gz'`);
    },

    writeCsvOrGz: async (filePath, arrayOfObjects, options = {}) => {
        if (!arrayOfObjects || arrayOfObjects.length === 0) return;
        const df = new dataForge.DataFrame(arrayOfObjects);
        const body = df.toCSV();
        const shouldCompress = !!options.compress;
        const targetPath = shouldCompress ? `${filePath}.gz` : filePath;
        const tmp = `${targetPath}.tmp`;
        const payload = shouldCompress ? await gzipAsync(Buffer.from(body, "utf8")) : body;

        await fsp.writeFile(tmp, payload);
        await fsp.rename(tmp, targetPath);

        const stalePath = shouldCompress ? filePath : `${filePath}.gz`;
        await safeUnlinkAsync(stalePath);
    },

    /** * Diagnostic: Calculate total data density across all managed paths
     */
    getDensityAsync: async (dirs = []) => {
        const stats = await Promise.all(dirs.map(async (d) => {
            const files = await getFileDataAsync(d);
            return files.reduce((acc, f) => acc + f.size, 0);
        }));
        const totalBytes = stats.reduce((a, b) => a + b, 0);
        return { totalBytes, totalMb: (totalBytes / (1024 * 1024)).toFixed(2) };
    }
};

module.exports = manager;
