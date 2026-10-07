
"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const loader = require("@core/core/loader/StrategyLoader");
const db = require("@core/services/postgres");
const stateManager = require("@utils/stateController");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");
const { getStrategyManifestPayload } = require("@utils/strategy/StrategyManifest");
const { toScopedId, fromScopedId, scopedLikePrefix } = require("@core/services/userScope");

// HELPER: Check if strategy is untouchable
const isStrategyBusy = (id) => {
    const status = stateManager.getStatus(id);
    return ["ACTIVE", "WARMING_UP", "STOPPING"].includes(status);
};

const getUserId = (req) => String(req.user?.sub || "").trim();
const scopedIdFor = (req, id) => toScopedId(getUserId(req), id);
const unscopedIdFor = (req, id) => fromScopedId(getUserId(req), id);

const emitUserLog = (req, message, extra = {}) => {
    try {
        const userId = getUserId(req);
        if (!userId) return;
        bus.emit(
            EVENTS.SYSTEM.LOG,
            { level: "info", module: "STRATEGY_API", message: String(message || ""), ...(extra || {}) },
            { ts: Date.now(), category: "system", userId }
        );
    } catch {
        // best-effort
    }
};

// 1. LIST ALL
router.get("/", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    db.query(
        `SELECT name, updated_at, schema, runtime_params
         FROM strategies
         WHERE name LIKE $1
         ORDER BY name ASC`
        ,
        [scopedLikePrefix(userId)]
    ).then(({ rows }) => {
        const strategies = rows.map((row) => {
            const id = unscopedIdFor(req, row.name);
            if (!id) return null;
            const meta = loader.getMeta(row.name);
            const liveInstance = loader.getActiveInstance(row.name);
            // FIX (Owen, Jul 2026): this used to be `liveInstance?.symbols || []` —
            // which is only ever populated while a runtime is ALREADY running.
            // For a stopped strategy (the normal case right before you launch
            // it) this was always [], so the frontend launcher had no way to
            // know which symbol(s) the strategy actually supports and fell
            // back to a hardcoded 'EURUSD' default — which is why you were
            // getting "Symbol 'EURUSD' is not supported... Available: BTC/USD"
            // on strategies that only ever declared BTC/USD. Now falls back to
            // the compiled metadata's declared symbol universe.
            const declaredSymbols = (meta?.metadata?.symbols || []).map((s) => String(s).toUpperCase());
            return {
                id,
                name: id,
                symbols: (liveInstance?.symbols && liveInstance.symbols.length ? liveInstance.symbols : declaredSymbols),
                schema: meta?.schema || row.schema || {},
                params: liveInstance?.params || row.runtime_params || {},
                lastModified: row.updated_at ? new Date(row.updated_at).getTime() : null,
                status: stateManager.getStatus(row.name)
            };
        }).filter(Boolean);
        res.json({ success: true, payload: strategies });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "LIST_FAILED", message: err.message });
    });
});

// 1b. STRATEGY MANIFEST (must be before /:id route)
router.get("/manifest", (_req, res) => {
    try {
        return res.json({ success: true, payload: getStrategyManifestPayload() });
    } catch (err) {
        return res.status(500).json({ success: false, error: "MANIFEST_FAILED", message: err.message });
    }
});


// 2. READ CODE (For the Editor)
router.get("/:id", (req, res) => {
    const idRaw = String(req.params.id || "").trim();
    const id = scopedIdFor(req, idRaw);
    if (!id) return res.status(400).json({ success: false, error: "INVALID_ID" });
    db.query(
        `SELECT name, script_body, schema, runtime_params
         FROM strategies
         WHERE name = $1
         LIMIT 1`,
        [id]
    ).then(({ rows }) => {
        if (!rows[0]) return res.status(404).json({ success: false, error: "Strategy not found" });
        res.json({ 
            success: true, 
            payload: { 
                id: idRaw, 
                code: rows[0].script_body || "",
                schema: rows[0].schema || {},
                params: rows[0].runtime_params || {}
            } 
        });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
    });
});

// Backward compatibility: /strategies/:id/code
router.get("/:id/code", (req, res) => {
    const idRaw = String(req.params.id || "").trim();
    const id = scopedIdFor(req, idRaw);
    if (!id) return res.status(400).json({ success: false, error: "INVALID_ID" });
    db.query(
        `SELECT name, script_body, schema, runtime_params
         FROM strategies
         WHERE name = $1
         LIMIT 1`,
        [id]
    ).then(({ rows }) => {
        if (!rows[0]) return res.status(404).json({ success: false, error: "Strategy not found" });
        res.json({ 
            success: true, 
            payload: { 
                id: idRaw, 
                code: rows[0].script_body || "",
                schema: rows[0].schema || {},
                params: rows[0].runtime_params || {}
            } 
        });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
    });
});


// 2. CREATE NEW (The Template Injector)
const handleCreate = async (req, res) => {
    const { name } = req.body;
    const plainId = String(name || "").replace(/\s+/g, "_").replace(/\.js$/, "");
    const id = scopedIdFor(req, plainId);
    if (!id) return res.status(400).json({ success: false, error: "INVALID_NAME" });
    const templatePath = path.join(process.cwd(), "utils", "template.txt");
    let template = "";
    try {
        template = await fs.promises.readFile(templatePath, "utf8");
    } catch {
        template = `module.exports = class ${plainId} { constructor() { this.id = '${plainId}'; this.name = '${plainId}'; } }`;
    }
    const hydrated = template.replace(/\$\{name\}/g, plainId);
    const hash = crypto.createHash("sha256").update(hydrated).digest("hex");

    try {
        const result = await db.query(
            `INSERT INTO strategies (name, script_body, script_hash, user_id, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (name) DO NOTHING`,
            [id, hydrated, hash, getUserId(req)]
        );
        if (result.rowCount === 0) {
            return res.status(400).json({ success: false, error: "Strategy already exists" });
        }
        await loader.reload(id);
        emitUserLog(req, `Strategy created: ${plainId}`);
        return res.json({ success: true, payload: { id: plainId } });
    } catch (err) {
        return res.status(500).json({ success: false, error: "CREATE_FAILED", message: err.message });
    }
};

// PHASE 2: Consolidate duplicate routes — use standard REST pattern
router.post("/", handleCreate);

// 3. RENAME
router.patch("/:id/rename", (req, res) => {
    const { id: rawId } = req.params;
    const { newName } = req.body;
    const id = scopedIdFor(req, rawId);
    const newIdPlain = String(newName || "").replace(/\s+/g, "_");
    const newId = scopedIdFor(req, newIdPlain);

    if (isStrategyBusy(id)) {
        return res.status(403).json({ success: false, error: "Cannot rename a running strategy" });
    }

    db.query(
        "UPDATE strategies SET name = $2, updated_at = NOW() WHERE name = $1",
        [id, newId]
    ).then(async ({ rowCount }) => {
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Strategy not found" });
        loader.invalidate(id);
        await loader.reload(newId);
        emitUserLog(req, `Strategy renamed: ${rawId} -> ${newIdPlain}`);
        res.json({ success: true, message: "Strategy renamed successfully" });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "RENAME_FAILED", message: err.message });
    });
});

// Extract a { line, column } location from a thrown compile error.
// V8 embeds the offending position in the stack as `file:LINE:COL` (or
// `file:LINE` for bare syntax errors). We only trust positions that point
// inside the strategy source (`db://strategies/...`) so that security /
// validation errors from engine internals don't yield a spurious marker.
function extractErrorLocation(err) {
    const stack = err && err.stack ? String(err.stack) : "";
    const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        if (!line.includes("db://strategies")) continue;
        const m = line.match(/:(\d+):(\d+)\s*$/) || line.match(/:(\d+)\s*$/);
        if (m) {
            const ln = parseInt(m[1], 10);
            if (Number.isFinite(ln) && ln > 0) {
                return { line: ln, column: m[2] ? parseInt(m[2], 10) : 1 };
            }
        }
    }
    return null;
}

// 4. UPDATE (Save with Hot-Reload)
router.put("/:id", async (req, res) => {
    const id = scopedIdFor(req, req.params.id);
    const { code } = req.body;
    if (!code || typeof code !== "string") {
        return res.status(400).json({ success: false, error: "INVALID_CODE" });
    }
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    try {
        const { rowCount } = await db.query(
            "UPDATE strategies SET script_body = $2, script_hash = $3, updated_at = NOW() WHERE name = $1",
            [id, code, hash]
        );
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Not found" });
        await loader.reload(id);
        emitUserLog(req, `Strategy deployed: ${req.params.id}`);
        const { rows } = await db.query(
            "SELECT name, script_body, schema, runtime_params FROM strategies WHERE name = $1",
            [id]
        );
        res.json({
            success: true,
            message: `Logic hot-swapped for ${req.params.id}.`,
            payload: {
                id: req.params.id,
                code: rows[0]?.script_body || "",
                schema: rows[0]?.schema || {},
                params: rows[0]?.runtime_params || {}
            }
        });
    } catch (err) {
        const loc = extractErrorLocation(err);
        res.status(500).json({
            success: false,
            error: err.message,
            ...(loc ? { details: loc } : {})
        });
    }
});

// 5. DELETE
router.delete("/:id", (req, res) => {
    const id = scopedIdFor(req, req.params.id);
    if (isStrategyBusy(id)) {
        return res.status(403).json({ success: false, error: "Cannot delete while strategy is active" });
    }
    db.query(
        "DELETE FROM strategies WHERE name = $1",
        [id]
    ).then(({ rowCount }) => {
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Strategy not found" });
        loader.invalidate(id);
        emitUserLog(req, `Strategy deleted: ${req.params.id}`);
        res.json({ success: true, message: "Purged." });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message });
    });
});

module.exports = router;
