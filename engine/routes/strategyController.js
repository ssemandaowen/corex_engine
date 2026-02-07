"use strict";

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const loader = require('@core/strategyLoader');
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
    const strategies = Array.from(loader.registry.values()).map(s => {
        const id = s.instance?.id || s.instance?.name || (s.filePath ? path.basename(s.filePath, '.js') : 'unknown');
        return {
            id,
            name: s.instance?.name || id,
            symbols: s.instance?.symbols || [],
            lastModified: s.mtime,
            status: stateManager.getStatus(id)
        };
    });
    res.json({ success: true, payload: strategies });
});


// 2. READ CODE (For the Editor)
router.get('/:id', (req, res) => {
    const entry = loader.registry.get(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: "Strategy not found" });

    const code = fs.readFileSync(entry.filePath, 'utf8');
    res.json({ success: true, payload: { id: entry.id, code } });
});


// 2. CREATE NEW (The Template Injector)
router.post('/', (req, res) => {
    const { name } = req.body;
    const id = name.replace(/\s+/g, '_').replace(/\.js$/, '');
    const filePath = path.join(process.cwd(), 'strategies', `${id}.js`);

    if (fs.existsSync(filePath)) {
        return res.status(400).json({ success: false, error: "Strategy already exists" });
    }

    const templatePath = path.join(process.cwd(), 'utils', 'template.txt');
    const template = fs.readFileSync(templatePath, 'utf8');
    const hydrated = template.replace(/\$\{name\}/g, id);
    fs.writeFileSync(filePath, hydrated, 'utf8');
    loader._loadOne(filePath); // Register immediately
    res.json({ success: true, payload: { id } });
});

// 3. RENAME
router.patch('/:id/rename', (req, res) => {
    const { id } = req.params;
    const { newName } = req.body;
    const newId = newName.replace(/\s+/g, '_');

    if (isStrategyBusy(id)) {
        return res.status(403).json({ success: false, error: "Cannot rename a running strategy" });
    }

    const entry = loader.registry.get(id);
    const oldPath = entry.filePath;
    const newPath = path.join(path.dirname(oldPath), `${newId}.js`);

    try {
        fs.renameSync(oldPath, newPath);
        loader.registry.delete(id);
        loader._loadOne(newPath);
        res.json({ success: true, message: "Strategy renamed successfully" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. UPDATE (Save with Hot-Reload)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { code } = req.body;
    const entry = loader.registry.get(id);

    if (!entry) return res.status(404).json({ success: false, error: "Not found" });

    try {
        fs.writeFileSync(entry.filePath, code, 'utf8');
        
        // Critical: The loader must handle the 'hot-swap'
        // If it's active, the engine needs to re-instantiate carefully
        await loader._loadOne(entry.filePath);

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

    const entry = loader.registry.get(id);
    if (entry) {
        if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
        loader.registry.delete(id);
        res.json({ success: true, message: "Purged." });
    }
});

module.exports = router;
