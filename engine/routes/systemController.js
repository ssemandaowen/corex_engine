"use strict";

const express = require('express');
const router = express.Router();
const os = require('os');
const { bus, EVENTS } = require('@events/bus');
const broker = {}
const logger = require('@utils/logger');

/**
 * SYSTEM & ACCOUNT DOMAIN
 * Handles Tab 1: Home (Pulse) and Tab 6: Settings/Account
 */

// 1. GET SYSTEM HEARTBEAT (For Home Tab "Traffic Lights")
router.get('/heartbeat', (req, res) => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    res.json({
        success: true,
        payload: {
            status: "OPERATIONAL",
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
            resources: {
                cpu: os.loadavg()[0].toFixed(2),
                ram: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`
            },
            connectivity: {
                marketData: broker.isConnected ? "CONNECTED" : "DISCONNECTED",
                bridge: "READY", // Logic for MT4/5 Bridge state
                latency: broker.lastLatency || 0
            }
        }
    });
});

// 2. ACCOUNT BALANCES (For Account Tab)
router.get('/account/balance', async (req, res) => {
    try {
        // This calls your Bridge or Paper Wallet
        const balance = await broker.getBalance(); 
        res.json({ success: true, payload: balance });
    } catch (err) {
        res.status(500).json({ success: false, error: "Broker unreachable" });
    }
});

// 3. GLOBAL SETTINGS (For Settings Tab)
router.post('/settings/update', (req, res) => {
    const { theme, logLevel, dataPath } = req.body;

    if (logLevel) logger.setLevel(logLevel);
    
    // Logic to save these to a config.json file
    // bus.emit('SYSTEM:CONFIG_UPDATED', req.body);

    res.json({ success: true, message: "Global settings updated." });
});

// 4. THE "CLEAR STATE" BUTTON (Emergency Reset)
router.post('/maintenance/reset-states', (req, res) => {
    try {
        const stateManager = require('@utils/stateController');
        stateManager.resetAll(); // Clears stuck transitions
        
        bus.emit(EVENTS.SYSTEM.ERROR, { message: "System states manually reset by admin." });
        
        res.json({ success: true, message: "All strategy states cleared to OFFLINE." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;