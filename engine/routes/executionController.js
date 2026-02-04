"use strict";

const express = require('express');
const router = express.Router();
const loader = require('@core/strategyLoader'); // Import the Loader directly
const stateManager = require('@utils/stateController');
const logger = require('@utils/logger');

/**
 * EXECUTION DOMAIN
 * Handles Tab 3: Run (Live/Paper/Backtest)
 */

// 1. GET ENGINE STATUS
router.get('/status', (req, res) => {
    // We use the loader's list method because it aggregates 
    // status + instance params + uptime into one payload.
    const strategies = loader.listStrategies();
    
    // Convert array to Key-Value object for the Frontend Object.entries mapping
    const payload = {};
    strategies.forEach(s => { payload[s.id] = s; });

    res.json({ success: true, payload });
});

// 2. DEPLOY STRATEGY (OFFLINE -> ACTIVE)
router.post('/start/:id', (req, res) => {
    const { id } = req.params;
    const { mode, params } = req.body;

    if (id === 'undefined' || !id) {
        return res.status(400).json({ success: false, error: "Strategy ID is required" });
    }

    // 1. Call the loader method directly to trigger the Engine handover
    const entry = loader.startStrategy(id, { 
        mode: mode || 'PAPER', 
        strategyParams: params || {} 
    });

    if (!entry) {
        return res.status(404).json({ success: false, error: `Strategy [${id}] not found in registry.` });
    }

    logger.info(`Execution request processed for [${id}] in mode: ${mode}`);

    res.json({ 
        success: true, 
        message: `Deployment initiated for ${id}. Engine handover in progress...` 
    });
});

// 3. TERMINATE STRATEGY (ACTIVE -> OFFLINE)
router.post('/stop/:id', (req, res) => {
    const { id } = req.params;

    const entry = loader.stopStrategy(id);

    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    res.json({ 
        success: true, 
        message: `Stop signal processed for ${id}. Connections closing.` 
    });
});

// 4. REAL-TIME PARAM TUNING
router.patch('/params/:id', (req, res) => {
    const { id } = req.params;
    const { params } = req.body;

    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    // If active, hot-swap and persist. If inactive, just persist (applies next start).
    const status = stateManager.getStatus(id);
    if (entry.instance.updateParams) {
        entry.instance.updateParams(params);
    }
    loader._saveParams(id, params);

    if (status === 'ACTIVE') {
        return res.json({ success: true, message: "Parameters hot-swapped and persisted." });
    }
    return res.json({ success: true, message: "Parameters saved. They will apply on next start." });
});

// 5. RESTORE DEFAULT PARAMS
router.post('/params/:id/reset', (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    let defaults = null;
    try {
        const StrategyClass = require(entry.filePath);
        const fresh = typeof StrategyClass === 'function'
            ? new StrategyClass({ name: entry.id, id: entry.id })
            : StrategyClass;
        fresh.id = entry.id;
        fresh.name = entry.id;
        if (fresh._applyDefaults) fresh._applyDefaults();
        defaults = fresh.params || {};
    } catch (e) {
        defaults = null;
    }

    if (!defaults || Object.keys(defaults).length === 0) {
        if (entry.instance._applyDefaults) {
            entry.instance._applyDefaults();
        }
        defaults = entry.instance.params || {};
    }

    if (entry.instance.updateParams) {
        entry.instance.updateParams(defaults);
    } else {
        entry.instance.params = { ...(defaults || {}) };
    }

    loader._saveParams(id, entry.instance.params || {});

    logger.info(`Default parameters restored for strategy [${id}].`);
    return res.json({ success: true, payload: entry.instance.params || {}, message: "Defaults restored and persisted." });
});

module.exports = router;
