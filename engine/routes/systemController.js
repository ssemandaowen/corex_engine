"use strict";

const express = require('express');
const router = express.Router();
const os = require('os');
const { bus, EVENTS } = require('@events/bus');
const { getPaperBroker } = require("@broker/paperStore");
const marketBroker = require("@broker/twelvedata");
const logger = require('@utils/logger');

/**
 * SYSTEM & ACCOUNT DOMAIN
 * Handles Tab 1: Home (Pulse) and Tab 6: Settings/Account
 */

// 1. GET SYSTEM HEARTBEAT (For Home Tab "Traffic Lights")
router.get('/heartbeat', (req, res) => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    const cores = os.cpus()?.length || 1;
    const load = os.loadavg()[0] || 0;
    const cpuPct = Math.min(100, Math.max(0, (load / cores) * 100));
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

    res.json({
        success: true,
        payload: {
            status: "OPERATIONAL",
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
            resources: {
                cpu: os.loadavg()[0].toFixed(2),
                cpuPct: cpuPct.toFixed(1),
                ram: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                ramUsedMb: (usedMem / 1024 / 1024).toFixed(0),
                ramTotalMb: (totalMem / 1024 / 1024).toFixed(0),
                ramPct: ramPct.toFixed(1)
            },
            connectivity: {
                marketData: marketBroker.isConnected ? "CONNECTED" : "DISCONNECTED",
                bridge: "READY", // Logic for MT4/5 Bridge state
                latency: marketBroker.lastLatency || 0
            }
        }
    });
});

// 2. ACCOUNT BALANCES (For Account Tab)
router.get('/account/balance', async (req, res) => {
    try {
        const broker = getPaperBroker();
        const snapshot = broker.getAccountSnapshot();
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "Broker unreachable" });
    }
});

// PAPER ACCOUNT SETTINGS
router.patch('/account/settings', (req, res) => {
    try {
        const broker = getPaperBroker();
        const { cash, config } = req.body || {};

        if (config && typeof config === 'object') {
            const next = { ...config };
            if (next.commissionPerShare != null) next.commissionPerShare = Number(next.commissionPerShare);
            if (next.commissionMin != null) next.commissionMin = Number(next.commissionMin);
            if (next.slippageBps != null) next.slippageBps = Number(next.slippageBps);
            if (next.fillProbability != null) next.fillProbability = Number(next.fillProbability);
            broker.updateConfig(next);
        }
        if (cash != null) {
            const ok = broker.setCash(cash);
            if (!ok) return res.status(400).json({ success: false, error: "INVALID_CASH" });
        }

        res.json({ success: true, payload: broker.getAccountSnapshot() });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

router.post('/account/reset', (req, res) => {
    try {
        const broker = getPaperBroker();
        const { initialCash } = req.body || {};
        broker.resetAccount(initialCash);
        res.json({ success: true, payload: broker.getAccountSnapshot() });
    } catch (err) {
        res.status(500).json({ success: false, error: "RESET_FAILED" });
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
