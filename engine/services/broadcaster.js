"use strict";

const WebSocket = require("ws");
const os = require("os");
const { bus, EVENTS } = require("@events/bus");
const { BUS_EVENT_TO_WS, WS_EVENT_TYPES } = require("@config/constants");
const logger = require("@utils/logger");
const engine = require("@core/core/engine");
const loader = require("@core/strategyLoader");
const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");
const { getPaperBroker } = require("@broker/paperStore");

class Broadcaster {
    constructor() {
        this.wss = null;
        this.isInitialized = false;
        this.heartbeatInterval = null;
        this.statusInterval = null;
        this.feedInterval = null;
        this.mt5Interval = null;
        this._listeners = [];
    }

    /**
     * Initialize WS server & bind engine events
     * @param {http.Server} server - HTTP server instance
     */
    initServer(server) {
        if (this.isInitialized) return;

        // Create WS server without binding to HTTP server (upgrade handled centrally)
        this.wss = new WebSocket.Server({ noServer: true });

        // Handle connections
        this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));

        // Map bus events → WS
        this._bindInternalEvents();

        // Heartbeat ping/pong
        this.heartbeatInterval = setInterval(() => this._heartbeat(), 30000);
        this.statusInterval = setInterval(() => this._emitStatusUpdate(), 5000);
        this.feedInterval = setInterval(() => this._emitFeedMetrics(), 5000);
        this.mt5Interval = setInterval(() => this._emitMt5Status(), 3000);

        this.isInitialized = true;
        logger.info("[📡 Broadcaster Service: \x1b[36mLIVE\x1b[0m]");
    }

    _bindInternalEvents() {
        BUS_EVENT_TO_WS.forEach(({ event, type, category }) => {
            const handler = (payload) => this.transmit(type, payload, { category });
            bus.on(event, handler);
            this._listeners.push({ event, handler, category });
        });
    }

    transmit(type, payload, meta = {}) {
        if (!this.wss) return;

        const message = JSON.stringify({
            type,
            payload,
            meta: { server: "CoreX-Hub", ts: Date.now(), ...meta }
        });

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
    }

    _handleConnection(ws, req) {
        const ip = req.socket.remoteAddress;
        logger.info(`🔌 WS Client Connected [IP: ${ip}]`);

        ws.isAlive = true;
        this._emitStatusUpdate(ws);
        this._emitFeedMetrics(ws);

        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("error", (err) => logger.error(`📡 WS Error [${ip}]: ${err.message}`));
        ws.on("close", (code, reason) => {
            logger.info(`🔌 WS Client Disconnected [IP: ${ip}, Code: ${code}, Reason: ${reason || "none"}]`);
        });
    }

    _heartbeat() {
        if (!this.wss) return;
        this.wss.clients.forEach(ws => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }

    _emitStatusUpdate(target = null) {
        try {
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
            const payload = {
                systemStatus: {
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
                },
                pulse: null,
                strategies: loader.listStrategies(),
                accounts: {
                    paper: getPaperBroker()?.getAccountSnapshot?.() || null,
                    live: mt5Bridge.getAccountSnapshot() || null
                }
            };

            if (target) {
                if (target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: WS_EVENT_TYPES.STATUS_UPDATE, payload, meta: { server: "CoreX-Hub", ts: Date.now(), category: "system" } }));
                }
                return;
            }
            this.transmit(WS_EVENT_TYPES.STATUS_UPDATE, payload, { category: "system" });
        } catch (err) {
            logger.warn(`[WS] STATUS_UPDATE failed: ${err.message}`);
        }
    }

    _emitFeedMetrics(target = null) {
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

            const payload = { broker: brokerInfo, engine: engineMetrics, config };
            if (target) {
                if (target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: WS_EVENT_TYPES.FEED_METRICS, payload, meta: { server: "CoreX-Hub", ts: Date.now(), category: "system" } }));
                }
                return;
            }
            this.transmit(WS_EVENT_TYPES.FEED_METRICS, payload, { category: "system" });
        } catch (err) {
            logger.warn(`[WS] FEED_METRICS failed: ${err.message}`);
        }
    }

    _emitMt5Status(target = null) {
        try {
            const bridge = mt5Bridge.getStatus();
            const payload = {
                bridgeStatus: bridge.authorized ? "CONNECTED" : (bridge.connected ? "PENDING_AUTH" : "DISCONNECTED"),
                bridge,
                account: mt5Bridge.getAccountSnapshot(),
                positions: mt5Bridge.getPositions()
            };
            if (target) {
                if (target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: "MT5_BRIDGE_STATUS", payload, meta: { server: "CoreX-Hub", ts: Date.now(), category: "mt5" } }));
                }
                return;
            }
            this.transmit("MT5_BRIDGE_STATUS", payload, { category: "mt5" });
        } catch (err) {
            logger.warn(`[WS] MT5_BRIDGE_STATUS failed: ${err.message}`);
        }
    }

    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
        if (this.feedInterval) {
            clearInterval(this.feedInterval);
            this.feedInterval = null;
        }
        if (this.mt5Interval) {
            clearInterval(this.mt5Interval);
            this.mt5Interval = null;
        }

        this._listeners.forEach(({ event, handler }) => bus.off(event, handler));
        this._listeners = [];

        if (this.wss) {
            this.wss.clients.forEach(ws => {
                try { ws.terminate(); } catch { /* ignore */ }
            });
            try { this.wss.close(); } catch { /* ignore */ }
            this.wss = null;
        }

        this.isInitialized = false;
        logger.info("[Broadcaster Service: STOPPED]");
    }
}

module.exports = new Broadcaster();
