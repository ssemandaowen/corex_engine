"use strict";

const express = require('express');
const router = express.Router();
const { bus, EVENTS } = require('@events/bus');
const stateManager = require('@utils/stateController');
const logger = require('@utils/logger');

/**
 * EXECUTION DOMAIN
 * Handles Tab 3: Run (Live/Paper/Backtest)
 */

// 1. GET ENGINE STATUS (For the Run Tab Dashboard)
router.get('/status', (req, res) => {
    const statuses = stateManager.getAllStatuses(); 
    res.json({ success: true, payload: statuses });
});

// 2. DEPLOY STRATEGY (OFFLINE -> ACTIVE)
router.post('/start/:id', (req, res) => {
    const { id } = req.params;
    const { mode, params } = req.body; // mode: 'PAPER' | 'LIVE' | 'BACKTEST'

    // Validate if strategy is already running
    const currentStatus = stateManager.getStatus(id);
    if (['ACTIVE', 'WARMING_UP'].includes(currentStatus)) {
        return res.status(400).json({ success: false, error: "Strategy is already running" });
    }

    logger.info(`Execution request for [${id}] in mode: ${mode}`);

    // Trigger the System Bus - The Engine listens for this
    bus.emit(EVENTS.SYSTEM.STRATEGY_START, { 
        id, 
        options: { 
            mode: mode || 'PAPER', 
            strategyParams: params || {} 
        } 
    });

    res.json({ 
        success: true, 
        message: `Deployment initiated for ${id}. Checking dependencies...` 
    });
});

// 3. TERMINATE STRATEGY (ACTIVE -> OFFLINE)
router.post('/stop/:id', (req, res) => {
    const { id } = req.params;

    bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id, reason: 'USER_REQUEST' });

    res.json({ 
        success: true, 
        message: `Stop signal sent to ${id}. Closing WebSocket/Bridge connections.` 
    });
});

// 4. REAL-TIME PARAM TUNING (The "Hot-Swap")
router.patch('/params/:id', (req, res) => {
    const { id } = req.params;
    const { params } = req.body;

    // We emit a specialized event that the active instance listens to
    // allowing us to change EMA periods etc. without restarting the strategy
    bus.emit('ENGINE:UPDATE_PARAMS', { id, params });

    res.json({ success: true, message: "Parameters pushed to live instance." });
});

module.exports = router;