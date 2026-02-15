"use strict";

const express = require('express');
const router = express.Router();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const loader = require('@core/strategyLoader');
const db = require('@core/services/postgres');
const stateManager = require('@utils/stateController');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');

// HELPER: Check if strategy is untouchable
const isStrategyBusy = (id) => {
    const status = stateManager.getStatus(id);
    return ['ACTIVE', 'WARMING_UP', 'STOPPING'].includes(status);
};

// 1. LIST ALL
router.get('/', (req, res) => {
    db.query(
        `SELECT name, updated_at
         FROM strategies
         ORDER BY name ASC`
    ).then(({ rows }) => {
        const strategies = rows.map((row) => {
            const id = row.name;
            const entry = loader.registry.get(id);
            return {
                id,
                name: id,
                symbols: entry?.instance?.symbols || [],
                lastModified: row.updated_at ? new Date(row.updated_at).getTime() : null,
                status: stateManager.getStatus(id)
            };
        });
        res.json({ success: true, payload: strategies });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "LIST_FAILED", message: err.message });
    });
});


// 2. READ CODE (For the Editor)
router.get('/:id', (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "INVALID_ID" });
    db.query(
        `SELECT name, script_body
         FROM strategies
         WHERE name = $1
         LIMIT 1`,
        [id]
    ).then(({ rows }) => {
        if (!rows[0]) return res.status(404).json({ success: false, error: "Strategy not found" });
        res.json({ success: true, payload: { id: rows[0].name, code: rows[0].script_body || "" } });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
    });
});

// Backward compatibility: /strategies/:id/code
router.get('/:id/code', (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "INVALID_ID" });
    db.query(
        `SELECT name, script_body
         FROM strategies
         WHERE name = $1
         LIMIT 1`,
        [id]
    ).then(({ rows }) => {
        if (!rows[0]) return res.status(404).json({ success: false, error: "Strategy not found" });
        res.json({ success: true, payload: { id: rows[0].name, code: rows[0].script_body || "" } });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "READ_FAILED", message: err.message });
    });
});


// 2. CREATE NEW (The Template Injector)
const handleCreate = (req, res) => {
    const { name } = req.body;
    const id = name.replace(/\s+/g, '_').replace(/\.js$/, '');
    const templatePath = path.join(process.cwd(), 'utils', 'template.txt');
    let template = "";
    try {
        template = fs.readFileSync(templatePath, 'utf8');
    } catch {
        template = `module.exports = class ${id} { constructor() { this.id = '${id}'; this.name = '${id}'; } }`;
    }
    const hydrated = template.replace(/\$\{name\}/g, id);
    const hash = crypto.createHash("sha256").update(hydrated).digest("hex");

    db.query(
        `INSERT INTO strategies (name, script_body, script_hash, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (name) DO NOTHING`,
        [id, hydrated, hash]
    ).then(async (result) => {
        if (result.rowCount === 0) {
            return res.status(400).json({ success: false, error: "Strategy already exists" });
        }
        await loader._loadByName(id);
        res.json({ success: true, payload: { id } });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "CREATE_FAILED", message: err.message });
    });
};

router.post('/', handleCreate);
router.post('/create', handleCreate);

// 3. RENAME
router.patch('/:id/rename', (req, res) => {
    const { id } = req.params;
    const { newName } = req.body;
    const newId = newName.replace(/\s+/g, '_');

    if (isStrategyBusy(id)) {
        return res.status(403).json({ success: false, error: "Cannot rename a running strategy" });
    }

    db.query(
        `UPDATE strategies SET name = $2, updated_at = NOW() WHERE name = $1`,
        [id, newId]
    ).then(async ({ rowCount }) => {
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Strategy not found" });
        loader.registry.delete(id);
        await loader._loadByName(newId);
        res.json({ success: true, message: "Strategy renamed successfully" });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "RENAME_FAILED", message: err.message });
    });
});

// 4. UPDATE (Save with Hot-Reload)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { code } = req.body;
    if (!code || typeof code !== "string") {
        return res.status(400).json({ success: false, error: "INVALID_CODE" });
    }
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    try {
        const { rowCount } = await db.query(
            `UPDATE strategies SET script_body = $2, script_hash = $3, updated_at = NOW() WHERE name = $1`,
            [id, code, hash]
        );
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Not found" });
        await loader._loadByName(id);
        res.json({ success: true, message: `Logic hot-swapped for ${id}.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. DELETE
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    if (isStrategyBusy(id)) {
        return res.status(403).json({ success: false, error: "Cannot delete while strategy is active" });
    }
    db.query(
        `DELETE FROM strategies WHERE name = $1`,
        [id]
    ).then(({ rowCount }) => {
        if (rowCount === 0) return res.status(404).json({ success: false, error: "Strategy not found" });
        loader.registry.delete(id);
        res.json({ success: true, message: "Purged." });
    }).catch((err) => {
        res.status(500).json({ success: false, error: "DELETE_FAILED", message: err.message });
    });
});

module.exports = router;
