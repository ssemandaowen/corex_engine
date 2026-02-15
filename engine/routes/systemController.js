"use strict";

const express = require('express');
const router = express.Router();
const os = require('os');
const { bus, EVENTS } = require('@events/bus');
const { getPaperBroker } = require("@broker/paperStore");
const { getLiveBroker } = require("@broker/liveStore");
const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");
const pgStore = require("@core/services/pgStore");
const engine = require("@core/core/engine");
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

    const bridgeStatus = mt5Bridge.getStatus();

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
                bridge: bridgeStatus.authorized ? "CONNECTED" : (bridgeStatus.connected ? "PENDING_AUTH" : "DISCONNECTED"),
                bridgeDetail: bridgeStatus,
                latency: marketBroker.lastLatency || 0
            }
        }
    });
});

// Feed metrics & health telemetry
router.get('/feed/metrics', (req, res) => {
    try {
        const brokerInfo = {
            connected: !!marketBroker.isConnected,
            lastLatency: marketBroker.lastLatency || 0,
            reconnectAttempts: marketBroker.reconnectAttempts || 0,
            symbols: Array.from(marketBroker.symbols || [])
        };

        const engineMetrics = engine.getFeedMetrics();
        const config = {
            tickQueueMax: engine.maxQueueSize,
            tickFlushMax: engine.maxFlushCount
        };

        res.json({
            success: true,
            payload: {
                broker: brokerInfo,
                engine: engineMetrics,
                config
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "FEED_METRICS_FAILED", message: err.message });
    }
});

const getBrokerByMode = (mode = 'paper') => {
    const m = String(mode || 'paper').toLowerCase();
    if (m === 'paper') return getPaperBroker();
    if (m === 'live') return getLiveBroker();
    return null;
};

router.get('/account/modes', (req, res) => {
    const active = String(process.env.COREX_ACTIVE_BROKER || 'paper').toLowerCase();
    res.json({
        success: true,
        payload: {
            active: ['paper', 'live'].includes(active) ? active : 'paper',
            available: ['paper', 'live']
        }
    });
});

// 2. ACCOUNT BALANCES (For Account Tab)
router.get('/account/:mode/balance', async (req, res) => {
    try {
        const mode = String(req.params.mode || "").toLowerCase();
        const broker = getBrokerByMode(mode);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        let snapshot = broker.getAccountSnapshot();
        if (mode === "live") {
            const mt5Account = mt5Bridge.getAccountSnapshot();
            const mt5Positions = mt5Bridge.getPositions();
            if (mt5Account && typeof mt5Account === "object") {
                snapshot = {
                    ...snapshot,
                    ...mt5Account,
                    mode: "LIVE",
                    positions: Array.isArray(mt5Positions) ? mt5Positions : (snapshot.positions || [])
                };
            }
            snapshot.bridge = mt5Bridge.getStatus();
        }
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "Broker unreachable" });
    }
});

// Backward-compatible paper route
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
router.patch('/account/:mode/settings', (req, res) => {
    try {
        const broker = getBrokerByMode(req.params.mode);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { cash, initialCash, config } = req.body || {};

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
        if (initialCash != null) {
            const ok = broker.setInitialCash(initialCash);
            if (!ok) return res.status(400).json({ success: false, error: "INVALID_INITIAL_CASH" });
        }

        res.json({ success: true, payload: broker.getAccountSnapshot() });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

// Backward-compatible paper route
router.patch('/account/settings', (req, res) => {
    try {
        const broker = getPaperBroker();
        const { cash, initialCash, config } = req.body || {};

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
        if (initialCash != null) {
            const ok = broker.setInitialCash(initialCash);
            if (!ok) return res.status(400).json({ success: false, error: "INVALID_INITIAL_CASH" });
        }

        res.json({ success: true, payload: broker.getAccountSnapshot() });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

router.post('/account/:mode/reset', (req, res) => {
    try {
        const broker = getBrokerByMode(req.params.mode);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { initialCash } = req.body || {};
        broker.resetAccount(initialCash);
        res.json({ success: true, payload: broker.getAccountSnapshot() });
    } catch (err) {
        res.status(500).json({ success: false, error: "RESET_FAILED" });
    }
});

// Backward-compatible paper route
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

router.get('/settings', async (req, res) => {
    try {
        const runtime = engine.getSettings();
        const persisted = await pgStore.getSystemSettings();
        res.json({ success: true, payload: { runtime, persisted } });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch('/settings', async (req, res) => {
    try {
        const { settings, persist } = req.body || {};
        const updated = engine.updateSettings(settings || {});
        if (persist !== false) {
            await pgStore.upsertSystemSettings(updated);
        }
        res.json({ success: true, payload: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_UPDATE_FAILED", message: err.message });
    }
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

router.get('/mt5/status', (req, res) => {
    res.json({
        success: true,
        payload: {
            ...mt5Bridge.getStatus(),
            account: mt5Bridge.getAccountSnapshot(),
            positions: mt5Bridge.getPositions()
        }
    });
});

router.get('/db/summary', async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.getSummary() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_SUMMARY_FAILED", message: err.message });
    }
});

router.get('/db/users', async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listUsers() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_USERS_READ_FAILED", message: err.message });
    }
});

router.post('/db/users', async (req, res) => {
    try {
        const { hashPassword } = require("@core/services/authService");
        const password = String(req.body?.password || "");
        if (!password) {
            return res.status(400).json({ success: false, error: "PASSWORD_REQUIRED" });
        }
        const passwordHash = await hashPassword(password);
        const created = await pgStore.createUser({ ...(req.body || {}), passwordHash });
        res.json({ success: true, payload: created });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_USER_CREATE_FAILED", message: err.message });
    }
});

router.get('/db/accounts', async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listAccounts() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_ACCOUNTS_READ_FAILED", message: err.message });
    }
});

router.post('/db/accounts', async (req, res) => {
    try {
        const account = await pgStore.upsertAccount(req.body || {});
        res.json({ success: true, payload: account });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_ACCOUNT_UPSERT_FAILED", message: err.message });
    }
});

router.get('/db/quota/:userId', async (req, res) => {
    try {
        const quota = await pgStore.getQuota(String(req.params.userId || ""));
        if (!quota) return res.status(404).json({ success: false, error: "QUOTA_NOT_FOUND" });
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_QUOTA_READ_FAILED", message: err.message });
    }
});

router.patch('/db/quota/:userId', async (req, res) => {
    try {
        const quota = await pgStore.upsertQuota(String(req.params.userId || ""), req.body || {});
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_QUOTA_UPDATE_FAILED", message: err.message });
    }
});

module.exports = router;
