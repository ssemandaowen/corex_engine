"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;

const config = {
    backtests: { keepN: 20, halfLifeDays: 14, maxAgeDays: 90 },
    cache: { maxSizeMb: 500, maxAgeDays: 30 },
    uploads: { maxSizeMb: 500, maxAgeDays: 30 }
};

const setConfig = (next = {}) => {
    if (next.backtests) config.backtests = { ...config.backtests, ...next.backtests };
    if (next.cache) config.cache = { ...config.cache, ...next.cache };
    if (next.uploads) config.uploads = { ...config.uploads, ...next.uploads };
    return getConfig();
};

const getConfig = () => ({
    backtests: { ...config.backtests },
    cache: { ...config.cache },
    uploads: { ...config.uploads }
});

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const listFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map(name => path.join(dir, name))
        .filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
};

const stableRand01 = (input) => {
    const hash = crypto.createHash("sha1").update(String(input)).digest();
    const n = hash.readUInt32BE(0);
    return (n % 100000) / 100000; // 0..0.99999
};

const cleanupBacktests = (dir, opts = {}) => {
    const source = { ...config.backtests, ...opts };
    const keepN = Number(source.keepN || 20);
    const halfLifeDays = Number(source.halfLifeDays || 14);
    const maxAgeDays = Number(source.maxAgeDays || 90);

    const files = listFiles(dir)
        .filter(p => p.endsWith(".json"))
        .map(p => ({ path: p, stat: fs.statSync(p) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    const keep = files.slice(0, keepN);
    const candidates = files.slice(keepN);
    const now = Date.now();

    for (const f of candidates) {
        const ageDays = (now - f.stat.mtimeMs) / DAY_MS;
        if (ageDays >= maxAgeDays) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
            continue;
        }
        const p = 1 - Math.pow(0.5, ageDays / Math.max(halfLifeDays, 1));
        const r = stableRand01(path.basename(f.path));
        if (r < p) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
        }
    }

    return { kept: keep.length, checked: candidates.length };
};

const clampCache = (dir, opts = {}) => {
    const source = { ...config.cache, ...opts };
    const maxSizeMb = Number(source.maxSizeMb || 500);
    const maxAgeDays = Number(source.maxAgeDays || 30);
    const maxBytes = maxSizeMb * 1024 * 1024;

    let files = listFiles(dir).map(p => ({ path: p, stat: fs.statSync(p) }));
    const now = Date.now();

    // Age-based pruning
    for (const f of files) {
        const ageDays = (now - f.stat.mtimeMs) / DAY_MS;
        if (ageDays >= maxAgeDays) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
        }
    }

    // Size-based pruning
    files = listFiles(dir).map(p => ({ path: p, stat: fs.statSync(p) }))
        .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs); // oldest first

    let total = files.reduce((s, f) => s + f.stat.size, 0);
    for (const f of files) {
        if (total <= maxBytes) break;
        try {
            fs.unlinkSync(f.path);
            total -= f.stat.size;
        } catch {
            // ignore
        }
    }

    return { remainingBytes: total };
};

const cleanupUploads = (dir, opts = {}) => {
    const source = { ...config.uploads, ...opts };
    const maxSizeMb = Number(source.maxSizeMb || 500);
    const maxAgeDays = Number(source.maxAgeDays || 30);
    const maxBytes = maxSizeMb * 1024 * 1024;

    let files = listFiles(dir).map(p => ({ path: p, stat: fs.statSync(p) }));
    const now = Date.now();

    for (const f of files) {
        const ageDays = (now - f.stat.mtimeMs) / DAY_MS;
        if (ageDays >= maxAgeDays) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
        }
    }

    files = listFiles(dir).map(p => ({ path: p, stat: fs.statSync(p) }))
        .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

    let total = files.reduce((s, f) => s + f.stat.size, 0);
    for (const f of files) {
        if (total <= maxBytes) break;
        try {
            fs.unlinkSync(f.path);
            total -= f.stat.size;
        } catch {
            // ignore
        }
    }

    return { remainingBytes: total };
};

module.exports = {
    ensureDir,
    cleanupBacktests,
    clampCache,
    cleanupUploads,
    setConfig,
    getConfig
};
