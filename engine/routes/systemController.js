"use strict";

const express = require('express');
const router = express.Router();
const os = require('os');
const { bus, EVENTS } = require('@events/bus');
const { getPaperBroker } = require("@broker/paperStore");
const { getLiveBroker } = require("@broker/liveStore");
const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");
const broadcaster = require("@core/services/broadcaster");
const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const configService = require("@core/services/configService");
const integrationRuntime = require("@core/services/integrationRuntime");
const engine = require("@core/core/engine");
const { runHealthCheck } = require("@core/services/healthCheck");
const logger = require('@utils/logger');
const { BRIDGE_INTEGRATIONS, MODES, TIME } = require("@config/constants");
const secretsVault = require("@core/services/secretsVault");
const { requireAdmin } = require("@core/middleware/roleGuard");

const SECRET_REDACTED = "<redacted>";

const getAtPath = (obj, path) => {
    const parts = String(path || "").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = cur[p];
    }
    return cur;
};

const setAtPath = (obj, path, value) => {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) return false;
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const k = parts[i];
        if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return true;
};

const getMarketStatus = () => {
    if (typeof marketBroker?.getStatus === "function") return marketBroker.getStatus();
    return {
        connected: !!marketBroker?.isConnected,
        reconnectAttempts: Number(marketBroker?.reconnectAttempts || 0),
        lastLatency: Number(marketBroker?.lastLatency || 0),
        symbols: Array.from(marketBroker?.symbols || []),
        nextReconnectAt: 0,
        lastDisconnectAt: 0,
        lastDisconnectReason: null,
        websocketEnabled: true
    };
};

const marketConnectivityLabel = (status) => {
    if (!status?.websocketEnabled) return "DISABLED";
    if (status?.connected) return "CONNECTED";
    if (Number(status?.nextReconnectAt || 0) > Date.now()) return "RECONNECTING";
    return "DISCONNECTED";
};

const getUserId = (req) => String(req.user?.sub || "").trim();

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
    const marketStatus = getMarketStatus();

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
                marketData: marketConnectivityLabel(marketStatus),
                marketDataDetail: marketStatus,
                bridge: bridgeStatus.authorized ? "CONNECTED" : (bridgeStatus.connected ? "PENDING_AUTH" : "DISCONNECTED"),
                bridgeDetail: bridgeStatus,
                latency: marketStatus.lastLatency || 0
            }
        }
    });
});

// Feed metrics & health telemetry
router.get('/feed/metrics', (req, res) => {
    try {
        const marketStatus = getMarketStatus();
        const brokerInfo = {
            connected: !!marketStatus.connected,
            websocketEnabled: !!marketStatus.websocketEnabled,
            state: marketConnectivityLabel(marketStatus),
            lastLatency: Number(marketStatus.lastLatency || 0),
            reconnectAttempts: Number(marketStatus.reconnectAttempts || 0),
            nextReconnectAt: Number(marketStatus.nextReconnectAt || 0),
            lastDisconnectAt: Number(marketStatus.lastDisconnectAt || 0),
            lastDisconnectReason: marketStatus.lastDisconnectReason || null,
            symbols: Array.isArray(marketStatus.symbols) ? marketStatus.symbols : []
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

// Control Gates: DB + MT5 + Strategy Hash Integrity
router.get('/health/control-gates', async (req, res) => {
    try {
        const report = await runHealthCheck();
        const status = report.ok ? 200 : 503;
        res.status(status).json({ success: report.ok, payload: report });
    } catch (err) {
        res.status(500).json({ success: false, error: "HEALTH_CHECK_FAILED", message: err.message });
    }
});

const getBrokerByMode = (mode = 'paper', userId = undefined) => {
    const m = String(mode || 'paper').toLowerCase();
    if (m === 'paper') return getPaperBroker(userId);
    if (m === 'live') return getLiveBroker();
    return null;
};

const normalizeMode = (mode = "paper") => (String(mode || "paper").toLowerCase() === "live" ? "live" : "paper");

router.get('/account/modes', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const persisted = await pgStore.getSystemSettingsForUser(userId);
        const uiMode = normalizeMode(persisted?.payload?.ui?.activeAccountMode || "");
        const fallback = normalizeMode(process.env.COREX_ACTIVE_BROKER || "paper");
        res.json({
            success: true,
            payload: {
                active: uiMode || fallback,
                available: ['paper', 'live']
            }
        });
    } catch {
        const fallback = normalizeMode(process.env.COREX_ACTIVE_BROKER || "paper");
        res.json({
            success: true,
            payload: {
                active: fallback,
                available: ['paper', 'live']
            }
        });
    }
});

router.patch('/account/mode', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = normalizeMode(req.body?.mode || "paper");
        const existing = await pgStore.getSystemSettingsForUser(userId);
        const payload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
        const next = {
            ...payload,
            ui: {
                ...(payload.ui || {}),
                activeAccountMode: mode
            }
        };
        await pgStore.upsertSystemSettingsForUser(userId, next);
        await configService.refresh();
        bus.emit(EVENTS.SYSTEM.CONFIG_REFRESH, { source: "api.account.mode", updated: { activeAccountMode: mode } });
        res.json({ success: true, payload: { active: mode, available: ['paper', 'live'] } });
    } catch (err) {
        res.status(500).json({ success: false, error: "ACCOUNT_MODE_UPDATE_FAILED", message: err.message });
    }
});

// 2. ACCOUNT BALANCES (For Account Tab)
router.get('/account/:mode/balance', async (req, res) => {
    try {
        const mode = String(req.params.mode || "").toLowerCase();
        const broker = getBrokerByMode(mode, getUserId(req));
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
        const broker = getPaperBroker(getUserId(req));
        const snapshot = broker.getAccountSnapshot();
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "Broker unreachable" });
    }
});

// PAPER ACCOUNT SETTINGS
router.patch('/account/:mode/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = normalizeMode(req.params.mode);
        const broker = getBrokerByMode(mode, userId);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { cash, initialCash, config } = req.body || {};

        if (config && typeof config === 'object') {
            const next = { ...config };
            if (next.commissionPerShare != null) next.commissionPerShare = Number(next.commissionPerShare);
            if (next.commissionMin != null) next.commissionMin = Number(next.commissionMin);
            if (next.slippageBps != null) next.slippageBps = Number(next.slippageBps);
            if (next.fillProbability != null) next.fillProbability = Number(next.fillProbability);
            if (next.spreadBps != null) next.spreadBps = Number(next.spreadBps);
            if (next.latencyMsMin != null) next.latencyMsMin = Number(next.latencyMsMin);
            if (next.latencyMsMax != null) next.latencyMsMax = Number(next.latencyMsMax);
            if (next.positionBroadcastMinMs != null) next.positionBroadcastMinMs = Number(next.positionBroadcastMinMs);
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
        const snapshot = broker.getAccountSnapshot();
        await pgStore.upsertBrokerSettingsForUser(userId, mode, {
            cash: snapshot.cash,
            initialCash: snapshot.initialCash,
            config: snapshot.config || {}
        });
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

// Backward-compatible paper route
router.patch('/account/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const broker = getPaperBroker(userId);
        const { cash, initialCash, config } = req.body || {};

        if (config && typeof config === 'object') {
            const next = { ...config };
            if (next.commissionPerShare != null) next.commissionPerShare = Number(next.commissionPerShare);
            if (next.commissionMin != null) next.commissionMin = Number(next.commissionMin);
            if (next.slippageBps != null) next.slippageBps = Number(next.slippageBps);
            if (next.fillProbability != null) next.fillProbability = Number(next.fillProbability);
            if (next.spreadBps != null) next.spreadBps = Number(next.spreadBps);
            if (next.latencyMsMin != null) next.latencyMsMin = Number(next.latencyMsMin);
            if (next.latencyMsMax != null) next.latencyMsMax = Number(next.latencyMsMax);
            if (next.positionBroadcastMinMs != null) next.positionBroadcastMinMs = Number(next.positionBroadcastMinMs);
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
        const snapshot = broker.getAccountSnapshot();
        await pgStore.upsertBrokerSettingsForUser(userId, "paper", {
            cash: snapshot.cash,
            initialCash: snapshot.initialCash,
            config: snapshot.config || {}
        });
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

router.post('/account/:mode/reset', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = normalizeMode(req.params.mode);
        const broker = getBrokerByMode(mode, userId);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { initialCash } = req.body || {};
        broker.resetAccount(initialCash);
        const snapshot = broker.getAccountSnapshot();
        await pgStore.upsertBrokerSettingsForUser(userId, mode, {
            cash: snapshot.cash,
            initialCash: snapshot.initialCash,
            config: snapshot.config || {}
        });
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "RESET_FAILED" });
    }
});

// Backward-compatible paper route
router.post('/account/reset', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const broker = getPaperBroker(userId);
        const { initialCash } = req.body || {};
        broker.resetAccount(initialCash);
        const snapshot = broker.getAccountSnapshot();
        await pgStore.upsertBrokerSettingsForUser(userId, "paper", {
            cash: snapshot.cash,
            initialCash: snapshot.initialCash,
            config: snapshot.config || {}
        });
        res.json({ success: true, payload: snapshot });
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

router.get('/account/:mode/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = String(req.params.mode || "").toLowerCase();
        const broker = getBrokerByMode(mode, userId);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });

        const snapshot = broker.getAccountSnapshot?.() || {};
        const persisted = await pgStore.getBrokerSettingsForUser(userId, mode);
        res.json({
            success: true,
            payload: {
                mode: mode.toUpperCase(),
                cash: Number(snapshot.cash ?? persisted?.cash ?? 0),
                initialCash: Number(snapshot.initialCash ?? persisted?.initialCash ?? 0),
                config: snapshot.config || persisted?.config || {},
                persisted
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_READ_FAILED", message: err.message });
    }
});

router.get('/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const runtime = engine.getSettings();
        const persisted = await pgStore.getSystemSettingsForUser(userId);

        // Never return integration secrets to the UI once stored.
        const safePersisted = persisted && typeof persisted === "object"
            ? { ...persisted, payload: secretsVault.maskSecrets({ ...(persisted.payload || {}) }) }
            : persisted;

        res.json({ success: true, payload: { runtime, persisted: safePersisted } });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch('/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const { settings, persist } = req.body || {};
        const uiSettings = settings?.ui;
        const engineSettings = { ...(settings || {}) };
        delete engineSettings.ui;

        const updated = engine.updateSettings(engineSettings || {});
        if (persist !== false) {
            const existing = await pgStore.getSystemSettingsForUser(userId);
            const payload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
            const nextPayload = {
                ...payload,
                engine: {
                    ...(payload.engine || {}),
                    ...updated
                }
            };
            if (uiSettings && typeof uiSettings === "object") {
                nextPayload.ui = { ...(payload.ui || {}), ...uiSettings };
            }

            // If the UI sends back masked secrets, preserve the existing stored values.
            for (const secretPath of secretsVault.DEFAULT_SECRET_PATHS || []) {
                const incoming = getAtPath(nextPayload, secretPath);
                if (incoming === SECRET_REDACTED || incoming === "") {
                    const previous = getAtPath(payload, secretPath);
                    if (typeof previous === "string" && previous) {
                        setAtPath(nextPayload, secretPath, previous);
                    } else {
                        // If there's no previous value, drop the placeholder.
                        setAtPath(nextPayload, secretPath, "");
                    }
                }
            }

            // Encrypt integration secrets at rest (DB) if COREX_SECRETS_KEY is configured.
            secretsVault.encryptObjectSecrets(nextPayload);

            await pgStore.upsertSystemSettingsForUser(userId, nextPayload);
        }
        await configService.refresh();
        await integrationRuntime.refresh();
        bus.emit(EVENTS.SYSTEM.CONFIG_REFRESH, { source: "api", updated });
        res.json({ success: true, payload: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

const getDefaultRunSettings = () => ({
    modes: [MODES.PAPER, MODES.LIVE],
    defaultMode: MODES.PAPER,
    timeframes: TIME.DEFAULT_TIMEFRAMES,
    defaultTimeframe: TIME.DEFAULT_TIMEFRAMES[0],
    bridgeProviders: [BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, BRIDGE_INTEGRATIONS.MQL5_RECEIVER, BRIDGE_INTEGRATIONS.METAAPI],
    activeBridgeProvider: BRIDGE_INTEGRATIONS.PYTHON_RECEIVER
});

router.get('/run/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const persisted = await pgStore.getSystemSettingsForUser(userId);
        const payload = persisted?.payload || {};
        const run = payload.run && typeof payload.run === "object" ? payload.run : {};
        const defaults = getDefaultRunSettings();
        const merged = {
            modes: Array.isArray(run.modes) && run.modes.length > 0 ? run.modes.map((m) => String(m).toUpperCase()) : defaults.modes,
            defaultMode: String(run.defaultMode || defaults.defaultMode).toUpperCase(),
            timeframes: Array.isArray(run.timeframes) && run.timeframes.length > 0 ? run.timeframes : defaults.timeframes,
            defaultTimeframe: String(run.defaultTimeframe || defaults.defaultTimeframe),
            bridgeProviders: Array.isArray(run.bridgeProviders) && run.bridgeProviders.length > 0 ? run.bridgeProviders : defaults.bridgeProviders,
            activeBridgeProvider: String(run.activeBridgeProvider || defaults.activeBridgeProvider)
        };

        if (!merged.modes.includes(merged.defaultMode)) merged.defaultMode = merged.modes[0];
        if (!merged.timeframes.includes(merged.defaultTimeframe)) merged.defaultTimeframe = merged.timeframes[0];
        if (!merged.bridgeProviders.includes(merged.activeBridgeProvider)) merged.activeBridgeProvider = merged.bridgeProviders[0];

        res.json({ success: true, payload: merged });
    } catch (err) {
        res.status(500).json({ success: false, error: "RUN_SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch('/run/settings', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const run = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {};
        const persist = req.body?.persist !== false;
        const existing = await pgStore.getSystemSettingsForUser(userId);
        const payload = existing?.payload && typeof existing.payload === "object" ? existing.payload : {};
        const defaults = getDefaultRunSettings();
        const nextRun = { ...(payload.run || defaults), ...run };
        const nextPayload = { ...payload, run: nextRun };
        if (persist) await pgStore.upsertSystemSettingsForUser(userId, nextPayload);
        await configService.refresh();
        await integrationRuntime.refresh();
        bus.emit(EVENTS.SYSTEM.CONFIG_REFRESH, { source: "api.run.settings", updated: nextRun });
        res.json({ success: true, payload: nextRun });
    } catch (err) {
        res.status(500).json({ success: false, error: "RUN_SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

// 4. THE "CLEAR STATE" BUTTON (Emergency Reset)
router.post('/maintenance/reset-states', requireAdmin, (req, res) => {
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
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    Promise.all([
        db.query(
        `SELECT terminal_id, last_seen, status, account_id
         FROM bridge_status
         ORDER BY last_seen DESC`
        ),
        db.query(`SELECT execution_enabled FROM execution_control WHERE id = 1`),
        pgStore.getSystemSettingsForUser(userId).catch(() => null)
    ]).then(([bridgeRes, execRes, systemSettings]) => {
        const rows = bridgeRes.rows || [];
        const heartbeat = rows[0] || null;
        const pending = rows.filter((r) => r.status === "PENDING_APPROVAL");
        const executionEnabled = execRes.rows?.[0]?.execution_enabled ?? true;
        const runSettings = systemSettings?.payload?.run && typeof systemSettings.payload.run === "object"
            ? systemSettings.payload.run
            : {};

        let bridgeStatus = "DISCONNECTED";
        if (heartbeat?.last_seen) {
            const lastSeen = new Date(heartbeat.last_seen).getTime();
            if (Date.now() - lastSeen < 30000) {
                bridgeStatus = "CONNECTED";
            }
        }

        const providers = Array.isArray(runSettings.bridgeProviders) && runSettings.bridgeProviders.length > 0
            ? runSettings.bridgeProviders
            : [BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, BRIDGE_INTEGRATIONS.MQL5_RECEIVER, BRIDGE_INTEGRATIONS.METAAPI];
        const activeBridgeProvider = String(runSettings.activeBridgeProvider || process.env.COREX_BRIDGE_PROVIDER || providers[0]);

        res.json({
            success: true,
            payload: {
                bridgeStatus,
                account: mt5Bridge.getAccountSnapshot(),
                positions: mt5Bridge.getPositions(),
                heartbeat,
                pending,
                executionEnabled,
                providers,
                activeBridgeProvider
            }
        });
    }).catch(() => {
        res.json({
            success: true,
            payload: {
                bridgeStatus: "DISCONNECTED",
                account: mt5Bridge.getAccountSnapshot(),
                positions: mt5Bridge.getPositions(),
                heartbeat: null,
                pending: [],
                executionEnabled: false,
                providers: [BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, BRIDGE_INTEGRATIONS.MQL5_RECEIVER, BRIDGE_INTEGRATIONS.METAAPI],
                activeBridgeProvider: BRIDGE_INTEGRATIONS.PYTHON_RECEIVER
            }
        });
    });
});

// WS Health Check
router.get('/ws-health', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    const clients = typeof broadcaster.getClientCountForUser === "function"
        ? broadcaster.getClientCountForUser(userId)
        : (broadcaster?.wss?.clients ? broadcaster.wss.clients.size : 0);
    res.json({
        success: true,
        payload: {
            enabled: !!broadcaster?.wss,
            clients
        }
    });
});

// Push-test: seed a LIVE order for a specific terminal
router.post('/mt5/push-test', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    const terminalId = String(req.body?.terminal_id || "105388034").trim();
    const symbol = String(req.body?.symbol || "EURUSD").trim().toUpperCase();
    const side = String(req.body?.side || "BUY").trim().toUpperCase() === "SELL" ? "SELL" : "BUY";
    const quantity = Number(req.body?.quantity ?? 0.01);
    if (!terminalId || !symbol || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ success: false, error: "INVALID_PAYLOAD" });
    }
    try {
        await db.query(
            `INSERT INTO orders (strategy_id, strategy_name, user_id, symbol, side, order_type, quantity, status, environment, terminal_id)
             VALUES ($1, $2, $3, $4, $5, 'MARKET', $6, 'PENDING', 'LIVE', $7)`,
            [null, null, userId, symbol, side, quantity, terminalId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "PUSH_FAILED", message: err.message });
    }
});

router.post('/mt5/execution', async (req, res) => {
    const enabled = req.body?.enabled === true;
    try {
        await db.query(
            `INSERT INTO execution_control (id, execution_enabled, updated_at)
             VALUES (1, $1, NOW())
             ON CONFLICT (id) DO UPDATE
             SET execution_enabled = EXCLUDED.execution_enabled,
                 updated_at = EXCLUDED.updated_at`,
            [enabled]
        );
        res.json({ success: true, payload: { executionEnabled: enabled } });
    } catch (err) {
        res.status(500).json({ success: false, error: "EXECUTION_UPDATE_FAILED", message: err.message });
    }
});

router.get('/db/summary', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.getSummary() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_SUMMARY_FAILED", message: err.message });
    }
});

router.get('/db/users', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listUsers() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_USERS_READ_FAILED", message: err.message });
    }
});

router.post('/db/users', requireAdmin, async (req, res) => {
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

router.get('/db/accounts', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listAccounts() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_ACCOUNTS_READ_FAILED", message: err.message });
    }
});

router.post('/db/accounts', requireAdmin, async (req, res) => {
    try {
        const account = await pgStore.upsertAccount(req.body || {});
        res.json({ success: true, payload: account });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_ACCOUNT_UPSERT_FAILED", message: err.message });
    }
});

router.get('/db/quota/:userId', requireAdmin, async (req, res) => {
    try {
        const quota = await pgStore.getQuota(String(req.params.userId || ""));
        if (!quota) return res.status(404).json({ success: false, error: "QUOTA_NOT_FOUND" });
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_QUOTA_READ_FAILED", message: err.message });
    }
});

router.patch('/db/quota/:userId', requireAdmin, async (req, res) => {
    try {
        const quota = await pgStore.upsertQuota(String(req.params.userId || ""), req.body || {});
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_QUOTA_UPDATE_FAILED", message: err.message });
    }
});

module.exports = router;
