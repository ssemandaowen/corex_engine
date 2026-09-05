"use strict";

const express = require("express");
const router = express.Router();
const os = require("os");
const { bus, EVENTS } = require("@events/bus");
const { getPaperBroker } = require("@broker/paperStore");
const { getLiveBroker } = require("@broker/liveStore");
const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");
const { getMarketStatus, marketConnectivityLabel } = require("@core/services/marketStatus");
const broadcaster = require("@core/services/broadcaster");
const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const brokerPersistence = require("@core/services/brokerPersistence");
const configService = require("@core/services/configService");
const integrationRuntime = require("@core/services/integrationRuntime");
const engine = require("@core/core/engine");
const { runHealthCheck } = require("@core/services/healthCheck");
const logger = require("@utils/logger");
const { BRIDGE_INTEGRATIONS, MODES, TIME } = require("@config/constants");
const secretsVault = require("@core/services/secretsVault");
const { requireAdmin } = require("@core/middleware/roleGuard");
const RuntimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const jobWorkerSupervisor = require("@core/services/jobWorkerSupervisor");

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

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

// getMarketStatus and marketConnectivityLabel moved to engine/services/marketStatus.js

const getUserId = (req) => String(req.user?.sub || "").trim();
const normalizeConnector = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const receiverId = raw.receiverId || raw.receiver_id || null;
    const terminalId = raw.terminalId || raw.terminal_id || null;
    const accountId = raw.accountId || raw.account_id || null;
    const provider = raw.provider || null;
    if (!receiverId && !terminalId && !accountId) return null;
    return {
        receiverId: receiverId ? String(receiverId).trim() : null,
        terminalId: terminalId ? String(terminalId).trim() : null,
        accountId: accountId ? String(accountId).trim() : null,
        provider: provider ? String(provider).trim() : null
    };
};
const connectorKey = (connector) => {
    if (!connector) return null;
    if (connector.receiverId) return `receiver:${connector.receiverId}`;
    if (connector.terminalId) return `terminal:${connector.terminalId}${connector.accountId ? `:${connector.accountId}` : ""}`;
    if (connector.accountId) return `account:${connector.accountId}`;
    return null;
};

/**
 * SYSTEM & ACCOUNT DOMAIN
 * Handles Tab 1: Home (Pulse) and Tab 6: Settings/Account
 */

// 1. GET SYSTEM HEARTBEAT (For Home Tab "Traffic Lights")
router.get("/heartbeat", async (req, res) => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    const cores = os.cpus()?.length || 1;

    const currentCpuUsage = process.cpuUsage();
    const currentTime = Date.now();
    const cpuUsageDelta = process.cpuUsage(lastCpuUsage);
    const timeDelta = (currentTime - lastCpuTime) * 1000;
    const processCpuPct = timeDelta > 0 ? ((cpuUsageDelta.user + cpuUsageDelta.system) / timeDelta) * 100 : 0;

    lastCpuUsage = currentCpuUsage;
    lastCpuTime = currentTime;

    const load = os.loadavg()[0] || 0;
    const systemCpuPct = (load / cores) * 100;
    const cpuPct = Math.min(100, Math.max(0, systemCpuPct > 0 ? systemCpuPct : (processCpuPct / cores)));

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

    const bridgeStatus = mt5Bridge.getStatus();
    const marketStatus = getMarketStatus();

    let dbStatus = "DISABLED";
    if (db.hasDbConfig()) {
        try {
            await db.query("SELECT 1");
            dbStatus = "CONNECTED";
        } catch {
            dbStatus = "DISCONNECTED";
        }
    }
    const workerStatus = jobWorkerSupervisor.isRunning() ? "CONNECTED" : "OFFLINE";

    res.json({
        success: true,
        payload: {
            status: "OPERATIONAL",
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
            uptimeSeconds: Math.floor(uptime),
            db: dbStatus,
            worker: workerStatus,
            resources: {
                cpu: load.toFixed(2),
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
router.get("/feed/metrics", (req, res) => {
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

        res.json({
            success: true,
            payload: {
                broker: brokerInfo,
                engine: engineMetrics
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "FEED_METRICS_FAILED", message: err.message });
    }
});

// Control Gates: DB + MT5 + Strategy Hash Integrity
router.get("/health/control-gates", async (req, res) => {
    try {
        const report = await runHealthCheck();
        const soft = String(req.query?.soft || "").trim().toLowerCase() === "true";
        const status = report.ok || soft ? 200 : 503;
        res.status(status).json({ success: report.ok, payload: report });
    } catch (err) {
        res.status(500).json({ success: false, error: "HEALTH_CHECK_FAILED", message: err.message });
    }
});

const getBrokerByMode = (mode = "paper", userId = undefined) => {
    const m = String(mode || "paper").toLowerCase();
    if (m === "paper") return getPaperBroker(userId);
    if (m === "live") return getLiveBroker();
    return null;
};

const normalizeMode = (mode = "paper") => (String(mode || "paper").toLowerCase() === "live" ? "live" : "paper");

router.get("/account/modes", async (req, res) => {
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
                available: ["paper", "live"]
            }
        });
    } catch {
        const fallback = normalizeMode(process.env.COREX_ACTIVE_BROKER || "paper");
        res.json({
            success: true,
            payload: {
                active: fallback,
                available: ["paper", "live"]
            }
        });
    }
});

router.patch("/account/mode", async (req, res) => {
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
        res.json({ success: true, payload: { active: mode, available: ["paper", "live"] } });
    } catch (err) {
        res.status(500).json({ success: false, error: "ACCOUNT_MODE_UPDATE_FAILED", message: err.message });
    }
});

// 2. ACCOUNT BALANCES (For Account Tab)
router.get("/account/:mode/balance", async (req, res) => {
    try {
        const mode = String(req.params.mode || "").toLowerCase();
        const userId = getUserId(req);

        // FIX 5: Check RuntimeRegistry first for live broker data
        const allRuntimes = RuntimeRegistry.forUser(userId);
        const activeEntry = allRuntimes?.find(e => String(e.mode || "").toLowerCase() === mode);
        
        if (activeEntry && activeEntry.broker) {
            // Strategy is running — get live data from the active broker
            let snapshot = activeEntry.broker.getAccountSnapshot();
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
            return res.json({ success: true, payload: snapshot });
        }

        // Fallback: get from broker store (DB or static instance)
        const broker = getBrokerByMode(mode, userId);
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

// NOTE: Removed paramless /account/balance route — callers must use /account/:mode/balance

// PAPER ACCOUNT SETTINGS
/**
 * PATCH /account/:mode/settings
 * 
 * UPDATE BROKER SETTINGS (Cash, Config)
 * 
 * INTEGRATION FLOW (Event-Driven Persistence):
 * ==============================================
 * 1. Client sends PATCH with { cash, config, ...}
 * 2. Route calls broker.setCash(val) and broker.updateConfig(config)
 * 3. Broker methods update internal state and call this._emitBrokerState()
 * 4. _emitBrokerState() emits EVENTS.BROKER.STATE_CHANGED
 * 5. brokerPersistence service listens and persists to database
 * 6. Route returns response immediately (persistence continues async)
 * 
 * KEY POINT: Broker methods emit events; brokerPersistence service
 * listens and writes to DB. Route doesn't call pgStore directly.
 * 
 * FALLBACK: If event emission fails, route can call
 * brokerPersistence.persistBrokerSettings() directly.
 * 
 * See: docs/BROKER_PERSISTENCE_INTEGRATION.md
 * See: examples/IntegratedStrategy.js
 */
router.patch("/account/:mode/settings", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = normalizeMode(req.params.mode);
        const broker = getBrokerByMode(mode, userId);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { cash, initialCash, config, seed } = req.body || {};

        // Call broker methods — each emits EVENTS.BROKER.STATE_CHANGED
        // brokerPersistence service listens automatically
        if (config && typeof config === "object") {
            // broker.updateConfig() emits event with config payload
            const next = { ...config };
            broker.updateConfig(next);
        }
        if (cash != null || seed != null) {
            // broker.setCash() emits event with cash payload
            const val = (cash ?? seed);
            const ok = broker.setCash(val);
            if (!ok) return res.status(400).json({ success: false, error: "INVALID_CASH" });
        }
        if (initialCash != null || seed != null) {
            // broker.setInitialCash() emits event with initialCash payload
            const val = (initialCash ?? seed);
            const ok = broker.setInitialCash(val);
            if (!ok) return res.status(400).json({ success: false, error: "INVALID_INITIAL_CASH" });
        }
        const snapshot = broker.getAccountSnapshot();
        
        // FALLBACK: Direct persistence call (if event emission failed)
        // In normal cases, broker methods above already triggered persistence
        // This is just a safety net; it won't duplicate because events
        // have already been fired and handled
        try {
            bus.emit(EVENTS.BROKER.STATE_CHANGED, {
                userId,
                mode,
                payload: {
                    cash: snapshot.cash,
                    initialCash: snapshot.initialCash,
                    config: snapshot.config || {}
                }
            });
        } catch (err) {
            // If event emission fails, persist directly
            await brokerPersistence.persistBrokerSettings(userId, mode, {
                cash: snapshot.cash,
                initialCash: snapshot.initialCash,
                config: snapshot.config || {}
            });
        }
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "UPDATE_FAILED" });
    }
});

// NOTE: Removed paramless /account/settings route — callers must use /account/:mode/settings

/**
 * POST /account/:mode/reset
 * 
 * RESET BROKER ACCOUNT TO INITIAL STATE
 * 
 * INTEGRATION FLOW (Event-Driven Persistence):
 * ==============================================
 * 1. Client sends POST with { initialCash }
 * 2. Route calls broker.resetAccount(initialCash)
 * 3. Broker method resets all trades/positions and calls _emitBrokerState()
 * 4. _emitBrokerState() emits EVENTS.BROKER.STATE_CHANGED
 * 5. brokerPersistence service listens and persists to database
 * 6. Route also calls brokerPersistence.persistBrokerSettings() as safety net
 * 7. Route returns response immediately
 * 
 * KEY POINT: Broker.resetAccount() already emits the event in step 4.
 * The explicit brokerPersistence.persistBrokerSettings() call in step 6
 * is just a fallback to ensure persistence (won't duplicate if event fired).
 * 
 * See: docs/BROKER_PERSISTENCE_INTEGRATION.md
 * See: docs/PERSISTENCE_FLOW.md
 */
router.post("/account/:mode/reset", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = normalizeMode(req.params.mode);
        const broker = getBrokerByMode(mode, userId);
        if (!broker) return res.status(501).json({ success: false, error: "BROKER_NOT_AVAILABLE" });
        const { initialCash } = req.body || {};
        
        // broker.resetAccount() emits EVENTS.BROKER.STATE_CHANGED
        // brokerPersistence service listens and persists to DB
        broker.resetAccount(initialCash);
        
        const snapshot = broker.getAccountSnapshot();
        
        // FALLBACK: Direct persistence call (safety net)
        // In normal cases, resetAccount() above already triggered persistence
        await brokerPersistence.persistBrokerSettings(userId, mode, {
            cash: snapshot.cash,
            initialCash: snapshot.initialCash,
            config: snapshot.config || {}
        });
        res.json({ success: true, payload: snapshot });
    } catch (err) {
        res.status(500).json({ success: false, error: "RESET_FAILED" });
    }
});

// NOTE: Removed paramless /account/reset route — callers must use /account/:mode/reset
// 3. GLOBAL SETTINGS (For Settings Tab)
router.post("/settings/update", (req, res) => {
    const { theme, logLevel, dataPath } = req.body;

    if (logLevel) logger.setLevel(logLevel);
    
    // Logic to save these to a config.json file
    // bus.emit('SYSTEM:CONFIG_UPDATED', req.body);

    res.json({ success: true, message: "Global settings updated." });
});

router.get("/account/:mode/settings", async (req, res) => {
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

router.get("/settings", async (req, res) => {
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

router.patch("/settings", async (req, res) => {
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

router.get("/run/settings", async (req, res) => {
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

router.patch("/run/settings", async (req, res) => {
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
router.post("/maintenance/reset-states", requireAdmin, (req, res) => {
    try {
        const stateManager = require("@utils/stateController");
        stateManager.resetAll(); // Clears stuck transitions
        
        bus.emit(EVENTS.SYSTEM.ERROR, { message: "System states manually reset by admin." });
        
        res.json({ success: true, message: "All strategy states cleared to OFFLINE." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/mt5/status", (req, res) => { 
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    Promise.all([
        db.query(
            `SELECT terminal_id, last_seen, status, account_id
         FROM bridge_status
         ORDER BY last_seen DESC`
        ),
        db.query("SELECT execution_enabled FROM execution_control WHERE id = 1"),
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

        const receivers = mt5Bridge.getStatus?.().receivers || []; 
        const terminals = rows.map((r) => ({ 
            terminalId: r.terminal_id || null, 
            accountId: r.account_id || null, 
            status: r.status || null, 
            lastSeen: r.last_seen || null 
        })); 
 
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
                activeBridgeProvider, 
                receivers, 
                terminals 
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
                activeBridgeProvider: BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, 
                receivers: [], 
                terminals: [] 
            } 
        }); 
    }); 
}); 
 
router.get("/connectors", async (req, res) => { 
    try { 
        const userId = getUserId(req); 
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" }); 
        const persisted = await pgStore.getSystemSettingsForUser(userId); 
        const payload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload : {}; 
        const connectors = payload.connectors && typeof payload.connectors === "object" ? payload.connectors : {}; 
        res.json({ success: true, payload: connectors }); 
    } catch (err) { 
        res.status(500).json({ success: false, error: "CONNECTOR_READ_FAILED", message: err.message }); 
    } 
}); 
 
router.patch("/connectors/:strategyId", async (req, res) => { 
    try { 
        const userId = getUserId(req); 
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" }); 
        const strategyId = String(req.params.strategyId || "").trim(); 
        if (!strategyId) return res.status(400).json({ success: false, error: "STRATEGY_ID_REQUIRED" }); 
 
        const connector = normalizeConnector(req.body?.connector); 
        const allowShared = req.body?.allowShared === true; 
        const persisted = await pgStore.getSystemSettingsForUser(userId); 
        const payload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload : {}; 
        const connectors = payload.connectors && typeof payload.connectors === "object" ? payload.connectors : {}; 
        const byStrategy = connectors.byStrategy && typeof connectors.byStrategy === "object" ? connectors.byStrategy : {}; 
 
        const nextByStrategy = { ...byStrategy }; 
        if (!connector) { 
            delete nextByStrategy[strategyId]; 
        } else { 
            const key = connectorKey(connector); 
            if (!allowShared && key) { 
                const conflicts = Object.entries(nextByStrategy).find(([sid, cfg]) => { 
                    if (!cfg || sid === strategyId) return false; 
                    return connectorKey(cfg) === key; 
                }); 
                if (conflicts) { 
                    return res.status(409).json({ 
                        success: false, 
                        error: `CONNECTOR_IN_USE:${conflicts[0]}`, 
                        message: `Connector already assigned to ${conflicts[0]}`, 
                        payload: { 
                            strategyId: conflicts[0], 
                            connector: conflicts[1] 
                        } 
                    }); 
                } 
            } 
            nextByStrategy[strategyId] = connector; 
        } 
 
        const nextPayload = { 
            ...payload, 
            connectors: { 
                ...connectors, 
                byStrategy: nextByStrategy 
            } 
        }; 
        await pgStore.upsertSystemSettingsForUser(userId, nextPayload); 
        res.json({ success: true, payload: nextPayload.connectors }); 
    } catch (err) { 
        res.status(500).json({ success: false, error: "CONNECTOR_UPDATE_FAILED", message: err.message }); 
    } 
}); 

// WS Health Check
router.get("/ws-health", (req, res) => {
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
router.post("/mt5/push-test", async (req, res) => {
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
        const accountId = String(req.body?.accountId || "").trim() || null;
        await db.query(
            `INSERT INTO orders (strategy_id, strategy_name, user_id, account_id, symbol, side, order_type, quantity, status, environment, terminal_id)
             VALUES ($1, $2, $3, $4, $5, 'MARKET', $6, 'PENDING', 'LIVE', $7)`,
            [null, null, userId, accountId, symbol, side, quantity, terminalId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "PUSH_FAILED", message: err.message });
    }
});

router.post("/mt5/execution", async (req, res) => {
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

// ─── Docs routes ─────────────────────────────────────────────────────────────
// Serves markdown documentation files from the docs/guide directory.
// Files are read from disk on every request — no caching so edits are live.
// WS broadcast on file change is handled by the broadcaster (DOC_UPDATED event).

const docsFs   = require("fs");
const docsPath = require("path");

const DOCS_DIR = docsPath.resolve(process.cwd(), "docs", "guide");

// Map of slug → filename for clean URLs
const DOC_FILES = {
    "readme":          "README.md",
    "scripting":       "COREX_SCRIPTING.md",
    "backtesting":     "BACKTESTING.md",
    "connectors":      "CONNECTORS.md",
    "maintenance":     "MAINTENANCE.md",
};

router.get("/docs", (req, res) => {
    // Return doc index — list of available docs with slug, title, size
    try {
        const items = Object.entries(DOC_FILES).map(([slug, filename]) => {
            const filepath = docsPath.join(DOCS_DIR, filename);
            let size = 0;
            let exists = false;
            try {
                const stat = docsFs.statSync(filepath);
                size = stat.size;
                exists = true;
            } catch { /* file missing */ }
            return { slug, filename, exists, size };
        });
        return res.json({ success: true, payload: items });
    } catch (err) {
        return res.status(500).json({ success: false, error: "DOCS_LIST_FAILED", message: err.message });
    }
});

router.get("/docs/:slug", (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const filename = DOC_FILES[slug];
    if (!filename) {
        return res.status(404).json({ success: false, error: "DOC_NOT_FOUND" });
    }
    const filepath = docsPath.join(DOCS_DIR, filename);
    try {
        const content = docsFs.readFileSync(filepath, "utf8");
        return res.json({ success: true, payload: { slug, filename, content } });
    } catch (err) {
        if (err.code === "ENOENT") {
            return res.status(404).json({ success: false, error: "DOC_FILE_MISSING", message: `${filename} not found` });
        }
        return res.status(500).json({ success: false, error: "DOC_READ_FAILED", message: err.message });
    }
});

// Watch docs dir and broadcast DOC_UPDATED on change
// Called once at startup — idempotent (guards against double-registration)
let _docsWatcherStarted = false;
function startDocsWatcher() {
    if (_docsWatcherStarted) return;
    _docsWatcherStarted = true;
    try {
        if (!docsFs.existsSync(DOCS_DIR)) {
            docsFs.mkdirSync(DOCS_DIR, { recursive: true });
        }
        docsFs.watch(DOCS_DIR, { persistent: false }, (eventType, changedFile) => {
            if (!changedFile || !changedFile.endsWith(".md")) return;
            const slug = Object.entries(DOC_FILES).find(([, fn]) => fn === changedFile)?.[0] || null;
            if (!slug) return;
            try {
                bus.emit(EVENTS.SYSTEM.LOG,
                    { level: "info", module: "DOCS", message: `Doc updated: ${changedFile}`, slug },
                    { category: "system", channel: "system" }
                );
                // Broadcast DOC_UPDATED so the UI can hot-reload the panel
                broadcaster.transmit("DOC_UPDATED", { slug, filename: changedFile }, { channel: "system" });
            } catch { /* non-fatal */ }
        });
    } catch (err) {
        logger.warn(`[DOCS] Watcher not started: ${err.message}`);
    }
}

// Start watcher when this module loads (safe — only runs once)
setImmediate(startDocsWatcher);

// Chart / view settings persistence per user
// Stored in user_engine_settings as JSON under key "chartSettings"

router.get("/chart-settings", async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const settings = await pgStore.getSystemSettingsForUser(userId);
        const payload  = settings?.payload || {};
        return res.json({ success: true, payload: payload.chartSettings || {} });
    } catch (err) {
        return res.status(500).json({ success: false, error: "CHART_SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch("/chart-settings", async (req, res) => {
    try {
        const userId  = getUserId(req);
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const patch   = req.body && typeof req.body === "object" ? req.body : {};
        const current = await pgStore.getSystemSettingsForUser(userId);
        const existing = current?.payload || {};
        const next = {
            ...existing,
            chartSettings: {
                ...(existing.chartSettings || {}),
                ...patch,
            }
        };
        await pgStore.upsertSystemSettingsForUser(userId, next);
        return res.json({ success: true, payload: next.chartSettings });
    } catch (err) {
        return res.status(500).json({ success: false, error: "CHART_SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

router.get("/db/summary", requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.getSummary() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_SUMMARY_FAILED", message: err.message });
    }
});

router.get("/db/users", requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listUsers() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_USERS_READ_FAILED", message: err.message });
    }
});

router.post("/db/users", requireAdmin, async (req, res) => {
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

router.get("/db/accounts", requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, payload: await pgStore.listAccounts() });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_ACCOUNTS_READ_FAILED", message: err.message });
    }
});

router.post("/db/accounts", requireAdmin, async (req, res) => {
    try {
        const account = await pgStore.upsertAccount(req.body || {});
        res.json({ success: true, payload: account });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_ACCOUNT_UPSERT_FAILED", message: err.message });
    }
});

router.get("/db/quota/:userId", requireAdmin, async (req, res) => {
    try {
        const quota = await pgStore.getQuota(String(req.params.userId || ""));
        if (!quota) return res.status(404).json({ success: false, error: "QUOTA_NOT_FOUND" });
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(500).json({ success: false, error: "DB_QUOTA_READ_FAILED", message: err.message });
    }
});

router.patch("/db/quota/:userId", requireAdmin, async (req, res) => {
    try {
        const quota = await pgStore.upsertQuota(String(req.params.userId || ""), req.body || {});
        res.json({ success: true, payload: quota });
    } catch (err) {
        res.status(400).json({ success: false, error: "DB_QUOTA_UPDATE_FAILED", message: err.message });
    }
});

module.exports = router;