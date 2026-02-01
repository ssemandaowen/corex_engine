"use strict";

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const loader = require('@core/strategyLoader'); // Your existing loader
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');

/**
 * STRATEGY DOMAIN
 * Handles Tab 2: Strategy CRUD Operations
 */

// 1. LIST ALL (For the Strategies Overview Tab)
router.get('/', (req, res) => {
    const strategies = Array.from(loader.registry.values()).map(s => ({
        id: s.id,
        name: s.instance.name,
        symbols: s.instance.symbols,
        lastModified: s.mtime,
        status: require('@utils/stateController').getStatus(s.id)
    }));
    res.json({ success: true, payload: strategies });
});

// 2. READ CODE (For the Editor)
router.get('/:id', (req, res) => {
    const entry = loader.registry.get(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: "Strategy not found" });

    const code = fs.readFileSync(entry.filePath, 'utf8');
    res.json({ success: true, payload: { id: entry.id, code } });
});

// 3. CREATE/SAVE (The Sync Point)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { code } = req.body;
    const filePath = path.join(process.cwd(), 'strategies', `${id}.js`);

    try {
        // 1. Write to disk
        fs.writeFileSync(filePath, code, 'utf8');
        
        // 2. Tell the Loader to refresh this specific file
        // This clears require.cache and re-instantiates
        await loader._loadOne(filePath);

        // 3. Broadcast to all Tabs (Home, Run, etc.)
        bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id, timestamp: Date.now() });

        res.json({ success: true, message: `Strategy ${id} updated and synchronized.` });
    } catch (err) {
        logger.error(`Failed to save strategy ${id}: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. DELETE (The Purge)
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);

    if (entry) {
        // Stop it in the engine first if it's running
        bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id, reason: 'DELETED' });
        
        // Remove from disk
        if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
        
        // Remove from memory
        loader.registry.delete(id);
        
        bus.emit(EVENTS.SYSTEM.STRATEGY_UNLOADED, { id });
        res.json({ success: true, message: `Strategy ${id} purged from system.` });
    } else {
        res.status(404).json({ success: false, error: "Strategy not found" });
    }
});

module.exports = router;