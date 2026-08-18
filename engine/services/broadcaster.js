
"use strict";

const WebSocket = require("ws");
const os = require("os");
const crypto = require("crypto");
const { bus, EVENTS } = require("@events/bus");
const { BUS_EVENT_TO_WS, WS_EVENT_TYPES } = require("@config/constants");
const logger = require("@utils/logger");
const engine = require("@core/core/engine");
const loader = require("@core/strategyLoader");
const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");
const { getMarketStatus, marketConnectivityLabel } = require("@core/services/marketStatus");
const { parseScopedId, fromScopedId } = require("@core/services/userScope");
const db = require("@core/services/postgres");
const jobWorkerSupervisor = require("@core/services/jobWorkerSupervisor");

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();
// Cached once per statusInterval tick (server-side, shared by every client) so
// adding this to the WS payload never means "N clients = N DB round trips".
let lastDbStatus = "DISABLED";

// ─── Helpers ────────────────────────────────────────────────────────────────

const parseCsv = (raw) =>
    String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

// ─── Env / Tunables ──────────────────────────────────────────────────────────

const WS_MAX_BUFFERED_BYTES = Math.max(
    256 * 1024,
    Number(process.env.COREX_WS_MAX_BUFFERED_BYTES || 5 * 1024 * 1024)
);
const WS_STATUS_INTERVAL_MS  = Math.max(1000, Number(process.env.COREX_WS_STATUS_INTERVAL_MS  || 8000));
const WS_FEED_INTERVAL_MS    = Math.max(1000, Number(process.env.COREX_WS_FEED_INTERVAL_MS    || 8000));
const WS_MT5_INTERVAL_MS     = Math.max(1000, Number(process.env.COREX_WS_MT5_INTERVAL_MS     || 5000));
const WS_TICK_INTERVAL_MS    = Math.max(0,    Number(process.env.COREX_WS_TICK_INTERVAL_MS    || 0));

/**
 * How many consecutive back-pressure misses before we force-disconnect a client.
 * A stale trading UI is more dangerous than a dropped connection.
 * Default: 3 misses → terminate.
 */
const WS_MAX_BUFFER_MISSES = Math.max(
    1,
    Number(process.env.COREX_WS_MAX_BUFFER_MISSES || 3)
);

/**
 * FIX (Owen, Jul 2026): Unaddressed SYSTEM_LOG / SYSTEM_ERROR events were being
 * dropped for every client whose role wasn't exactly "admin". On a single-operator
 * deployment this silently hid ALL general system/startup logs from the only user,
 * leaving just the two hardcoded placeholder lines seeded in the frontend store.
 * Default is now OFF (visible to every authenticated client). Set
 * COREX_WS_SYSTEM_LOGS_ADMIN_ONLY=true to restore the old admin-only behavior
 * (e.g. for a real multi-tenant deployment where you don't want every user
 * seeing server-wide diagnostic noise).
 */
const WS_SYSTEM_LOGS_ADMIN_ONLY = ["1", "true", "yes", "on"].includes(
    String(process.env.COREX_WS_SYSTEM_LOGS_ADMIN_ONLY || "false").trim().toLowerCase()
);

const WS_GLOBAL_EVENT_TYPES = new Set([
    WS_EVENT_TYPES.DATA_TICK,
    WS_EVENT_TYPES.DATA_CANDLE,
    WS_EVENT_TYPES.STATUS_UPDATE,
    WS_EVENT_TYPES.FEED_METRICS,
    WS_EVENT_TYPES.MT5_CONNECTED,
    WS_EVENT_TYPES.MT5_DISCONNECTED,
    WS_EVENT_TYPES.MT5_AUTHORIZED,
    WS_EVENT_TYPES.MT5_AUTH_FAILED,
    WS_EVENT_TYPES.MT5_HEARTBEAT,
    WS_EVENT_TYPES.MT5_ACCOUNT_SYNC,
    WS_EVENT_TYPES.MT5_POSITIONS_SYNC,
    WS_EVENT_TYPES.MT5_ORDER_REQUEST,
    WS_EVENT_TYPES.MT5_ORDER_RESULT,
]);

const WS_USER_SCOPED_EVENT_TYPES = new Set([ 
    WS_EVENT_TYPES.ORDER_CREATED, 
    WS_EVENT_TYPES.ORDER_FILLED, 
    WS_EVENT_TYPES.ORDER_CANCELLED, 
    WS_EVENT_TYPES.ORDER_UPDATED, 
    WS_EVENT_TYPES.POSITION_UPDATED, 
    WS_EVENT_TYPES.PORTFOLIO_UPDATED, 
    WS_EVENT_TYPES.STRATEGY_SIGNAL, 
    WS_EVENT_TYPES.STRATEGY_LOADED, 
    WS_EVENT_TYPES.STRATEGY_UNLOADED, 
    WS_EVENT_TYPES.STRATEGY_START, 
    WS_EVENT_TYPES.STRATEGY_STOP, 
    WS_EVENT_TYPES.STRATEGY_STATE, 
    WS_EVENT_TYPES.WORKER_STATE, 
    WS_EVENT_TYPES.BACKTEST_PROGRESS, 
    WS_EVENT_TYPES.BACKTEST_UPLOAD_CREATED, 
    WS_EVENT_TYPES.BACKTEST_UPLOAD_DELETED, 
    WS_EVENT_TYPES.BACKTEST_UPLOAD_ARCHIVED 
]); 

// Production-safe defaults: status-only unless the client explicitly subscribes.
const DEFAULT_CHANNELS_RAW = String(process.env.COREX_WS_DEFAULT_CHANNELS || "status").trim().toLowerCase();
const DEFAULT_CHANNELS = new Set(
    DEFAULT_CHANNELS_RAW === "all"
        ? ["status", "feed", "system", "strategy", "execution", "market", "mt5"]
        : parseCsv(DEFAULT_CHANNELS_RAW)
);

const DEFAULT_SYMBOLS_RAW = String(process.env.COREX_WS_DEFAULT_SYMBOLS || "").trim();
const DEFAULT_SYMBOLS = new Set(
    !DEFAULT_SYMBOLS_RAW
        ? []
        : DEFAULT_SYMBOLS_RAW === "*"
            ? ["*"]
            : parseCsv(DEFAULT_SYMBOLS_RAW).map((s) => s.toUpperCase())
);

// Market helpers moved to engine/services/marketStatus.js

// ─── Broadcaster ─────────────────────────────────────────────────────────────

class Broadcaster {
    constructor() {
        this.wss               = null;
        this.isInitialized     = false;
        this.heartbeatInterval = null;
        this.statusInterval    = null;
        this.feedInterval      = null;
        this.mt5Interval       = null;
        this.tickFlushInterval = null;
        this.dbHealthInterval  = null;

        /** symbol → { payload, meta }  (tick aggregation) */
        this.latestTickBySymbol = new Map();

        /** Registered bus listeners — kept so we can cleanly remove them on stop(). */
        this._listeners = [];
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize WS server and bind engine events.
     * Safe to call multiple times — subsequent calls are no-ops.
     *
     * @param {http.Server} server - HTTP server instance (upgrade handled centrally)
     */
    initServer(server) {
        if (this.isInitialized) return;

        this.wss = new WebSocket.Server({ noServer: true });
        this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));

        // Guard against double-registration if initServer is somehow invoked again
        // before isInitialized flips — clear any stale listeners first.
        this._unbindInternalEvents();
        this._bindInternalEvents();

        this.heartbeatInterval = setInterval(() => this._heartbeat(), 30_000);
        this.statusInterval    = setInterval(() => this._emitStatusUpdate(),  WS_STATUS_INTERVAL_MS);
        this.feedInterval      = setInterval(() => this._emitFeedMetrics(),   WS_FEED_INTERVAL_MS);
        // One lightweight DB ping shared by every client, on its own slow cadence —
        // NOT per-client polling. _emitStatusUpdate just reads the cached result.
        this._refreshDbHealth();
        this.dbHealthInterval  = setInterval(() => this._refreshDbHealth(), 10_000);
        // FIX 3: Gate MT5 interval behind isConnected check — no MT5 = no broadcast
        this.mt5Interval       = setInterval(() => {
            const bridgeStatus = mt5Bridge.getStatus();
            if (bridgeStatus?.connected || bridgeStatus?.authorized) {
                this._emitMt5Status();
            }
        }, WS_MT5_INTERVAL_MS);

        if (WS_TICK_INTERVAL_MS > 0) {
            this.tickFlushInterval = setInterval(() => this._flushTickAggregation(), WS_TICK_INTERVAL_MS);
        }

        this.isInitialized = true;
        logger.info("[WS] Broadcaster service live");
    }

    // ── Internal event bus ────────────────────────────────────────────────────

    _bindInternalEvents() {
        BUS_EVENT_TO_WS.forEach(({ event, type, category }) => {
            const handler = (payload, meta) => {
            // Standardize the envelope IMMEDIATELY
                const envelope = {
                    type,
                    payload,
                    meta: { 
                        ...meta, 
                        category, 
                        userId: this._resolveScopedUserId(meta, payload) 
                    }
                };
                this.transmit(envelope.type, envelope.payload, envelope.meta);
            };
            bus.on(event, handler);
            this._listeners.push({ event, handler });
        });
    }

    _unbindInternalEvents() {
        this._listeners.forEach(({ event, handler }) => bus.off(event, handler));
        this._listeners = [];
    }

    // ── Core broadcast ────────────────────────────────────────────────────────

    /**
     * Build and broadcast a WS message.
     *
     * Key optimisations vs. the original:
     *  1. JSON.stringify() is called ONCE, not once per client.
     *  2. Slow clients accumulate a miss counter; after WS_MAX_BUFFER_MISSES
     *     consecutive failures they are forcibly terminated rather than silently
     *     receiving stale data — critical for a trading UI.
     *
     * @param {string} type     - WS_EVENT_TYPES constant
     * @param {object} payload  - message body
     * @param {object} meta     - routing hints (userId, channel, category, …)
     */
    transmit(type, payload, meta = {}) {
        if (!this.wss) return;

        const routedUserId = this._resolveScopedUserId(meta, payload);
        const requiresUserScope = WS_USER_SCOPED_EVENT_TYPES.has(type);
        if (requiresUserScope && !routedUserId) {
            logger.warn(`[WS] transmit(${type}) dropped: missing scoped userId.`);
            return;
        }

        const channel = String(meta?.channel || meta?.category || "").trim().toLowerCase();

        // ── Tick aggregation (opt-in via env) ────────────────────────────────
        if (
            type === WS_EVENT_TYPES.DATA_TICK &&
            WS_TICK_INTERVAL_MS > 0 &&
            payload?.symbol &&
            !meta?.__flush
        ) {
            const sym = String(payload.symbol).trim().toUpperCase();
            if (sym) {
                this.latestTickBySymbol.set(sym, {
                    payload,
                    meta: { ...meta, category: meta?.category || "market" }
                });
            }
            return;
        }

        // ── Stringify ONCE ───────────────────────────────────────────────────
        const message = this._stringifyWsMessage(type, payload, {
            ...(meta && typeof meta === "object" ? meta : {}),
            ...(routedUserId ? { userId: routedUserId } : {})
        });

        // ── Fan-out ──────────────────────────────────────────────────────────
        this.wss.clients.forEach((client) => {
            if (client.readyState !== WebSocket.OPEN) return;

            // System events: gated to admins only if COREX_WS_SYSTEM_LOGS_ADMIN_ONLY=true.
            if (
                WS_SYSTEM_LOGS_ADMIN_ONLY &&
                !routedUserId &&
                (type === WS_EVENT_TYPES.SYSTEM_LOG || type === WS_EVENT_TYPES.SYSTEM_ERROR)
            ) {
                if (String(client.role || "").toLowerCase() !== "admin") return;
            }

            // User scoping — explicit first, inferred second.
            if (routedUserId && client.userId !== routedUserId) return;

            // Subscription gate.
            if (!this._isSubscribed(client, channel, type, payload)) return;

            this._safeSend(client, message);
        });
    }

    // ── Subscription helpers ──────────────────────────────────────────────────

    _channelForType(type) {
        if (type === WS_EVENT_TYPES.STATUS_UPDATE) return "status";
        if (type === WS_EVENT_TYPES.FEED_METRICS)  return "feed";
        if (type === WS_EVENT_TYPES.WORKER_STATE)  return "system";
        if (String(type || "").startsWith("MT5"))  return "mt5";
        return "";
    }

    _isSubscribed(ws, channel, type, payload) {
        const subs = ws?.subscriptions;
        if (!subs) return true; // legacy / unauthenticated fallback

        const ch = channel || this._channelForType(type);
        if (ch && subs.channels instanceof Set) {
            if (!subs.channels.has(ch) && !subs.channels.has("all")) return false;
        }

        if (type === WS_EVENT_TYPES.DATA_TICK || type === WS_EVENT_TYPES.DATA_CANDLE) {
            const sym = String(payload?.symbol || "").trim().toUpperCase();
            if (!sym) return false;
            if (!(subs.symbols instanceof Set)) return true;
            return subs.symbols.has("*") || subs.symbols.has(sym);
        }

        return true;
    }

    // ── Send / backpressure ───────────────────────────────────────────────────

    _getBufferedAmount(ws) {
        const direct = Number(ws?.bufferedAmount);
        if (Number.isFinite(direct)) return direct;
        const sock   = ws?._socket;
        const legacy = Number(sock?.bufferSize ?? sock?.writableLength);
        return Number.isFinite(legacy) ? legacy : 0;
    }

    /**
     * Send a pre-serialised message to one client.
     *
     * Back-pressure policy:
     *  - If the client buffer is above WS_MAX_BUFFERED_BYTES, increment its miss counter.
     *  - Once the miss counter exceeds WS_MAX_BUFFER_MISSES, terminate the connection.
     *    A trading client receiving stale data is worse than a terminated one.
     *  - On a successful send the miss counter resets to 0.
     *
     * @param  {WebSocket} ws       - target client
     * @param  {string}    message  - already-serialised JSON string
     * @returns {boolean}
     */
    _safeSend(ws, message) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;

        const buffered = this._getBufferedAmount(ws);

        if (buffered > WS_MAX_BUFFERED_BYTES) {
            ws._bufferMisses = (ws._bufferMisses || 0) + 1;

            if (ws._bufferMisses >= WS_MAX_BUFFER_MISSES) {
                logger.warn(
                    `[WS] Client ${ws.userId || "<anon>"} exceeded buffer limit ` +
                    `${ws._bufferMisses} times in a row — terminating slow connection.`
                );
                try { ws.terminate(); } catch { /* ignore */ }
                return false;
            }

            // Not yet at threshold — drop this message but keep the connection alive.
            return false;
        }

        // Buffer healthy — reset miss counter.
        ws._bufferMisses = 0;

        try {
            ws.send(message);
            return true;
        } catch {
            return false;
        }
    }

    // ── User-id extraction (fallback only) ────────────────────────────────────

    /**
     * Best-effort extraction of a userId from an event payload.
     * This is a FALLBACK path. Events should carry an explicit meta.userId
     * set by the originating service. If you find this path being hit
     * frequently in production logs, fix the event source.
     */
    _resolveScopedUserId(meta = {}, payload = {}) {
        const direct = String(meta?.userId || "").trim();
        if (direct) return direct;

        const candidates = [
            meta?.strategyId,
            payload?.strategyId,
            payload?.strategy_id,
            payload?.strategyName,
            payload?.strategy_name,
            payload?.id,
            payload?.name
        ];
        for (const candidate of candidates) {
            const parsed = parseScopedId(candidate);
            if (parsed?.userId) return String(parsed.userId).trim();
        }
        return "";
    }

    _newEventId(type, ts) {
        const rand = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
        return `${String(type || "EVENT").toUpperCase()}:${Number(ts || Date.now())}:${rand}`;
    }

    _stringifyWsMessage(type, payload, meta = {}) {
    // Reuse the existing meta where possible rather than spreading
        return JSON.stringify({
            type,
            payload: payload || {},
            meta: {
                server: "CoreX-Hub",
                ts: meta.ts || Date.now(),
                schema: "corex.ws.v1",
                eventId: meta.eventId || this._newEventId(type, meta.ts),
                // Explicitly map required fields instead of ...meta
                userId: meta.userId,
                channel: meta.channel,
                category: meta.category
            }
        });
    }

    // ── Connection handling ───────────────────────────────────────────────────

    getClientCountForUser(userId) {
        const uid = String(userId || "").trim();
        if (!uid || !this.wss?.clients) return 0;
        let count = 0;
        this.wss.clients.forEach((ws) => { if (ws.userId === uid) count += 1; });
        return count;
    }

    _handleConnection(ws, req) {
        const ip = req.socket.remoteAddress;

        ws.userId         = String(req?.user?.sub  || "").trim() || null;
        ws.role           = String(req?.user?.role  || "").trim().toLowerCase() || "user";
        ws._bufferMisses  = 0;
        ws.subscriptions  = {
            channels: new Set(DEFAULT_CHANNELS),
            symbols:  new Set(DEFAULT_SYMBOLS)
        };

        logger.info(
            `WS Client Connected [IP: ${ip}]` +
            (ws.userId ? ` [user=${ws.userId}]` : "")
        );

        ws.isAlive = true;
        this._emitStatusUpdate(ws);
        this._emitFeedMetrics(ws);

        ws.on("pong",    ()    => { ws.isAlive = true; });
        ws.on("message", (msg) => this._handleClientMessage(ws, msg));
        ws.on("error",   (err) => logger.error(`WS Error [${ip}]: ${err.message}`));
        ws.on("close",   (code, reason) => {
            logger.info(
                `WS Client Disconnected [IP: ${ip}, Code: ${code}, ` +
                `Reason: ${reason || "none"}]`
            );
        });
    }

    _handleClientMessage(ws, msg) {
        if (!ws) return;
        let parsed;
        try {
            const raw = Buffer.isBuffer(msg) ? msg.toString("utf8") : String(msg || "");
            parsed = JSON.parse(raw);
        } catch {
            return;
        }

        const type    = String(parsed?.type    || "").trim().toUpperCase();
        const payload = parsed?.payload && typeof parsed.payload === "object"
            ? parsed.payload
            : {};

        if (type === "SUBSCRIBE" || type === "UNSUBSCRIBE") {
            const channels = Array.isArray(payload.channels) ? payload.channels : null;
            const symbols  = Array.isArray(payload.symbols)  ? payload.symbols  : null;

            if (channels && ws.subscriptions?.channels instanceof Set) {
                for (const chRaw of channels) {
                    const ch = String(chRaw || "").trim().toLowerCase();
                    if (!ch) continue;
                    if (type === "SUBSCRIBE") ws.subscriptions.channels.add(ch);
                    else                      ws.subscriptions.channels.delete(ch);
                }
            }

            if (symbols && ws.subscriptions?.symbols instanceof Set) {
                for (const sRaw of symbols) {
                    const sym = String(sRaw || "").trim().toUpperCase();
                    if (!sym) continue;
                    if (type === "SUBSCRIBE") ws.subscriptions.symbols.add(sym);
                    else                      ws.subscriptions.symbols.delete(sym);
                }
            }
            return;
        }

        if (type === "SET_RATE") {
            // Reserved for future: server-enforced rate hints.
            return;
        }
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────

    _heartbeat() {
        if (!this.wss) return;
        this.wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }

    // ── Periodic emitters ─────────────────────────────────────────────────────

    /**
     * One shared DB ping, cached to `lastDbStatus` and read by every client's
     * STATUS_UPDATE — this is the opposite of polling: it's a single query on
     * its own 10s cadence no matter how many browsers are connected, instead
     * of N clients each hitting REST /status (and therefore the DB) on their
     * own timer.
     */
    async _refreshDbHealth() {
        if (this._dbHealthInFlight) return; // don't stack calls if the DB is slow
        this._dbHealthInFlight = true;
        try {
            if (!db.hasDbConfig()) {
                lastDbStatus = "DISABLED";
                return;
            }
            await db.query("SELECT 1");
            lastDbStatus = "CONNECTED";
        } catch {
            lastDbStatus = "DISCONNECTED";
        } finally {
            this._dbHealthInFlight = false;
        }
    }

    _emitStatusUpdate(target = null) {
        try {
            if (!this.wss?.clients) return;

            const uptime  = process.uptime();
            const memory  = process.memoryUsage();
            const cores   = os.cpus()?.length || 1;
            const load    = os.loadavg()[0] || 0;

            const currentCpuUsage = process.cpuUsage();
            const currentTime = Date.now();
            const cpuUsageDelta = process.cpuUsage(lastCpuUsage);
            const timeDelta = (currentTime - lastCpuTime) * 1000;
            const processCpuPct = timeDelta > 0 ? ((cpuUsageDelta.user + cpuUsageDelta.system) / timeDelta) * 100 : 0;

            lastCpuUsage = currentCpuUsage;
            lastCpuTime = currentTime;

            const systemCpuPct = (load / cores) * 100;
            const cpuPct = Math.min(100, Math.max(0, systemCpuPct > 0 ? systemCpuPct : (processCpuPct / cores)));

            const totalMem = os.totalmem();
            const freeMem  = os.freemem();
            const usedMem  = totalMem - freeMem;
            const ramPct   = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

            const bridgeStatus  = mt5Bridge.getStatus();
            const marketStatus  = getMarketStatus();
            const rawStrategies = typeof loader.listStrategies === "function"
                ? loader.listStrategies()
                : [];

            const sharedSystemStatus = {
                status: "OPERATIONAL",
                uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                // FIX (Owen, Jul 2026): these two used to only be available via
                // REST /status, which HomeView polled every 5s per client. `db`
                // is the cached result of _refreshDbHealth() (one query per 10s,
                // shared by every client, not per-client). `worker` is a cheap
                // in-process flag check — no cost either way.
                db: lastDbStatus,
                worker: jobWorkerSupervisor.isRunning() ? "CONNECTED" : "OFFLINE",
                resources: {
                    cpu:        load.toFixed(2),
                    cpuPct:     cpuPct.toFixed(1),
                    ram:        `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                    ramUsedMb:  (usedMem  / 1024 / 1024).toFixed(0),
                    ramTotalMb: (totalMem / 1024 / 1024).toFixed(0),
                    ramPct:     ramPct.toFixed(1)
                },
                connectivity: {
                    marketData:       marketConnectivityLabel(marketStatus),
                    marketDataDetail: marketStatus,
                    bridge:           bridgeStatus.authorized
                        ? "CONNECTED"
                        : bridgeStatus.connected ? "PENDING_AUTH" : "DISCONNECTED",
                    bridgeDetail: bridgeStatus,
                    latency:      marketStatus.lastLatency || 0
                }
            };

            // Group strategies by user once per tick — avoids repeated filtering per client.
            const strategiesByUser = new Map(); // userId → strategy[]
            for (const s of rawStrategies) {
                const sid  = String(s?.id || "");
                const user = sid.includes("::") ? sid.split("::")[0] : "";
                if (!strategiesByUser.has(user)) strategiesByUser.set(user, []);
                strategiesByUser.get(user).push(s);
            }

            // Build a per-user payload — only called for distinct userIds present
            // in the connected client set, so we don't build N copies for N clients.
            const payloadCache = new Map(); // userId → serialised JSON string

            const getOrBuildMessage = (userId) => {
                if (payloadCache.has(userId)) return payloadCache.get(userId);

                const uid  = String(userId || "").trim();
                const list = uid ? (strategiesByUser.get(uid) || []) : rawStrategies;
                const strategies = uid
                    ? list.map((s) => ({
                        ...s,
                        id:   fromScopedId(uid, s.id)              || s.id,
                        name: fromScopedId(uid, s.name || s.id)    || (s.name || s.id)
                    }))
                    : list;

                const payload = { systemStatus: sharedSystemStatus, pulse: sharedSystemStatus, strategies, accounts: null };
                const msg = this._stringifyWsMessage(
                    WS_EVENT_TYPES.STATUS_UPDATE,
                    payload,
                    { category: "status", channel: "status", ...(uid ? { userId: uid } : {}) }
                );
                payloadCache.set(userId, msg);
                return msg;
            };

            if (target) {
                return void this._safeSend(target, getOrBuildMessage(target.userId));
            }

            this.wss.clients.forEach((ws) => {
                if (!this._isSubscribed(ws, "status", WS_EVENT_TYPES.STATUS_UPDATE, null)) return;
                this._safeSend(ws, getOrBuildMessage(ws.userId));
            });

        } catch (err) {
            logger.warn(`[WS] STATUS_UPDATE failed: ${err.message}`);
        }
    }

    _emitFeedMetrics(target = null) {
        // Defensive: ensure engine and API exist before attempting metric collection
        if (!this.wss?.clients) return;

        try {
            const marketStatus = getMarketStatus();
            const brokerInfo   = {
                connected:            !!marketStatus.connected,
                websocketEnabled:     !!marketStatus.websocketEnabled,
                state:                marketConnectivityLabel(marketStatus),
                lastLatency:          Number(marketStatus.lastLatency          || 0),
                reconnectAttempts:    Number(marketStatus.reconnectAttempts    || 0),
                nextReconnectAt:      Number(marketStatus.nextReconnectAt      || 0),
                lastDisconnectAt:     Number(marketStatus.lastDisconnectAt     || 0),
                lastDisconnectReason: marketStatus.lastDisconnectReason        || null,
                symbols:              Array.isArray(marketStatus.symbols) ? marketStatus.symbols : []
            };

            // Guard: engine may be undefined during early shutdown or tests
            if (!engine || typeof engine.getFeedMetrics !== "function") {
                logger.debug("[WS] FEED_METRICS skipped: engine.getFeedMetrics unavailable");
                return;
            }

            const engineMetrics = engine.getFeedMetrics();

            // Stringify once — sent to all eligible clients.
            const message = this._stringifyWsMessage(
                WS_EVENT_TYPES.FEED_METRICS,
                { broker: brokerInfo, engine: engineMetrics },
                { category: "feed", channel: "feed" }
            );

            if (target) return void this._safeSend(target, message);

            this.wss.clients.forEach((ws) => {
                if (!this._isSubscribed(ws, "feed", WS_EVENT_TYPES.FEED_METRICS, null)) return;
                this._safeSend(ws, message);
            });

        } catch (err) {
            // Do not flood logs — surface as warn and keep service alive
            logger.warn(`[WS] FEED_METRICS failed: ${err && err.message ? err.message : String(err)}`);
        }
    }

    _emitMt5Status(target = null) {
        try {
            if (!this.wss?.clients) return;

            const bridge  = mt5Bridge.getStatus();
            const status  = bridge.authorized
                ? "CONNECTED"
                : bridge.connected ? "PENDING_AUTH" : "DISCONNECTED";

            const publicPayload = { bridgeStatus: status, bridge, account: null, positions: [] };
            const adminPayload  = {
                bridgeStatus: status,
                bridge,
                account:   mt5Bridge.getAccountSnapshot(),
                positions: mt5Bridge.getPositions()
            };

            // Stringify each privilege tier once.
            const publicMsg = this._stringifyWsMessage(
                WS_EVENT_TYPES.MT5_BRIDGE_STATUS,
                publicPayload,
                { category: "mt5", channel: "mt5" }
            );
            const adminMsg = this._stringifyWsMessage(
                WS_EVENT_TYPES.MT5_BRIDGE_STATUS,
                adminPayload,
                { category: "mt5", channel: "mt5" }
            );

            const sendTo = (ws) => {
                const isAdmin = String(ws?.role || "").toLowerCase() === "admin";
                this._safeSend(ws, isAdmin ? adminMsg : publicMsg);
            };

            if (target) return void sendTo(target);

            this.wss.clients.forEach((ws) => {
                if (!this._isSubscribed(ws, "mt5", "MT5_BRIDGE_STATUS", null)) return;
                sendTo(ws);
            });

        } catch (err) {
            logger.warn(`[WS] MT5_BRIDGE_STATUS failed: ${err.message}`);
        }
    }

    // ── Tick aggregation flush ────────────────────────────────────────────────

    _flushTickAggregation() {
        if (!this.wss || this.latestTickBySymbol.size === 0) return;
        const entries = Array.from(this.latestTickBySymbol.entries());
        this.latestTickBySymbol.clear();
        for (const [, { payload, meta }] of entries) {
            this.transmit(WS_EVENT_TYPES.DATA_TICK, payload, { ...(meta || {}), __flush: true });
        }
    }

    // ── Teardown ──────────────────────────────────────────────────────────────

    stop() {
        const clearIfSet = (key) => {
            if (this[key]) { clearInterval(this[key]); this[key] = null; }
        };
        clearIfSet("heartbeatInterval");
        clearIfSet("statusInterval");
        clearIfSet("feedInterval");
        clearIfSet("mt5Interval");
        clearIfSet("tickFlushInterval");
        clearIfSet("dbHealthInterval");

        this.latestTickBySymbol.clear();
        this._unbindInternalEvents();

        if (this.wss) {
            this.wss.clients.forEach((ws) => { try { ws.terminate(); } catch { /* ignore */ } });
            try { this.wss.close(); } catch { /* ignore */ }
            this.wss = null;
        }

        this.isInitialized = false;
        logger.info("[Broadcaster Service: STOPPED]");
    }
}

module.exports = new Broadcaster();
