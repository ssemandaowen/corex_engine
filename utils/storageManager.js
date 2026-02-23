"use strict";

const fs = require("fs");
const { promises: fsp } = fs;
const path = require("path");
const crypto = require("crypto");
const { TIME } = require("@config/constants");

const DAY_MS = TIME.MS.DAY;

const config = {
    backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90 },
    cache: { maxSizeMb: 500, maxAgeDays: 30 },
    uploads: { maxSizeMb: 500, maxAgeDays: 30 }
};

/** Utils **/
const safeUnlink = (p) => { try { fs.unlinkSync(p); return true; } catch { return false; } };
const safeUnlinkAsync = async (p) => { try { await fsp.unlink(p); return true; } catch { return false; } };

const getFileData = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map(name => {
            const fullPath = path.join(dir, name);
            try {
                const stat = fs.statSync(fullPath);
                return stat.isFile() ? { path: fullPath, name, mtimeMs: stat.mtimeMs, size: stat.size } : null;
            } catch { return null; }
        })
        .filter(Boolean);
};

const getFileDataAsync = async (dir) => {
    let names = [];
    try {
        names = await fsp.readdir(dir);
    } catch {
        return [];
    }

    const files = await Promise.all(names.map(async (name) => {
        const fullPath = path.join(dir, name);
        try {
            const stat = await fsp.stat(fullPath);
            return stat.isFile() ? { path: fullPath, name, mtimeMs: stat.mtimeMs, size: stat.size } : null;
        } catch {
            return null;
        }
    }));

    return files.filter(Boolean);
};

const stableRand01 = (input) => {
    const hash = crypto.createHash("sha256").update(String(input)).digest();
    return hash.readUInt32BE(0) / 0xFFFFFFFF;
};

/** Core Logic **/
const pruneByAgeAndSize = (dir, opts) => {
    const maxBytes = (opts.maxSizeMb || 500) * 1024 * 1024;
    const maxAgeMs = (opts.maxAgeDays || 30) * DAY_MS;
    const now = Date.now();

    let files = getFileData(dir).sort((a, b) => a.mtimeMs - b.mtimeMs); // Oldest first
    
    // 1. Age Pruning
    files = files.filter(f => {
        if (now - f.mtimeMs > maxAgeMs) return !safeUnlink(f.path);
        return true;
    });

    // 2. Size Pruning
    let totalSize = files.reduce((acc, f) => acc + f.size, 0);
    for (const f of files) {
        if (totalSize <= maxBytes) break;
        if (safeUnlink(f.path)) totalSize -= f.size;
    }

    return { remainingBytes: totalSize };
};

const pruneByAgeAndSizeAsync = async (dir, opts) => {
    const maxBytes = (opts.maxSizeMb || 500) * 1024 * 1024;
    const maxAgeMs = (opts.maxAgeDays || 30) * DAY_MS;
    const now = Date.now();

    let files = (await getFileDataAsync(dir)).sort((a, b) => a.mtimeMs - b.mtimeMs);
    const kept = [];
    for (const f of files) {
        if (now - f.mtimeMs > maxAgeMs) {
            await safeUnlinkAsync(f.path);
            continue;
        }
        kept.push(f);
    }
    files = kept;

    let totalSize = files.reduce((acc, f) => acc + f.size, 0);
    for (const f of files) {
        if (totalSize <= maxBytes) break;
        if (await safeUnlinkAsync(f.path)) totalSize -= f.size;
    }

    return { remainingBytes: totalSize };
};

/** Exports **/
const manager = {
    setConfig: (next = {}) => {
        Object.keys(config).forEach(k => { if (next[k]) config[k] = { ...config[k], ...next[k] }; });
        return manager.getConfig();
    },

    getConfig: () => JSON.parse(JSON.stringify(config)),

    ensureDir: (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); },

    cleanupBacktests: (dir, opts = {}) => {
        const { keepN, halfLifeDays, maxAgeDays } = { ...config.backtests, ...opts };
        const now = Date.now();

        const files = getFileData(dir)
            .filter(f => f.name.endsWith(".json"))
            .sort((a, b) => b.mtimeMs - a.mtimeMs); // Newest first

        const candidates = files.slice(keepN);
        let deleted = 0;

        candidates.forEach(f => {
            const ageDays = (now - f.mtimeMs) / DAY_MS;
            const prob = 1 - Math.pow(0.5, ageDays / Math.max(halfLifeDays, 1));
            
            if (ageDays >= maxAgeDays || stableRand01(f.name) < prob) {
                if (safeUnlink(f.path)) deleted++;
            }
        });

        return { kept: files.length - deleted, deleted };
    },

    clampCache: (dir, opts = {}) => pruneByAgeAndSize(dir, { ...config.cache, ...opts }),
    clampCacheAsync: async (dir, opts = {}) => pruneByAgeAndSizeAsync(dir, { ...config.cache, ...opts }),
    
    cleanupUploads: (dir, opts = {}) => pruneByAgeAndSize(dir, { ...config.uploads, ...opts }),
    cleanupUploadsAsync: async (dir, opts = {}) => pruneByAgeAndSizeAsync(dir, { ...config.uploads, ...opts })
};

module.exports = manager;
