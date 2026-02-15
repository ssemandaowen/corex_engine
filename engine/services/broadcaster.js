"use strict";

const WebSocket = require("ws");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

class Broadcaster {
    constructor() {
        this.wss = null;
        this.isInitialized = false;
        this.heartbeatInterval = null;
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

        this.isInitialized = true;
        logger.info("[📡 Broadcaster Service: \x1b[36mLIVE\x1b[0m]");
    }

    _bindInternalEvents() {
        const mappings = [
            { event: EVENTS.MARKET.TICK, type: "DATA_TICK" },
            { event: EVENTS.ORDER.FILLED, type: "ORDER_FILLED" },
            { event: EVENTS.SYSTEM.SETTINGS_UPDATED, type: "PARAM_UPDATE" },
            { event: EVENTS.STRATEGY.SIGNAL, type: "STRATEGY_SIGNAL" },
            { event: EVENTS.MT5.CONNECTED, type: "MT5_CONNECTED" },
            { event: EVENTS.MT5.DISCONNECTED, type: "MT5_DISCONNECTED" },
            { event: EVENTS.MT5.AUTHORIZED, type: "MT5_AUTHORIZED" },
            { event: EVENTS.MT5.AUTH_FAILED, type: "MT5_AUTH_FAILED" },
            { event: EVENTS.MT5.HEARTBEAT, type: "MT5_HEARTBEAT" },
            { event: EVENTS.MT5.ACCOUNT_SYNC, type: "MT5_ACCOUNT_SYNC" },
            { event: EVENTS.MT5.POSITIONS_SYNC, type: "MT5_POSITIONS_SYNC" },
            { event: EVENTS.MT5.ORDER_REQUEST, type: "MT5_ORDER_REQUEST" },
            { event: EVENTS.MT5.ORDER_RESULT, type: "MT5_ORDER_RESULT" }
        ];

        mappings.forEach(({ event, type }) => {
            const handler = (payload) => this.transmit(type, payload);
            bus.on(event, handler);
            this._listeners.push({ event, handler });
        });
    }

    transmit(type, payload) {
        if (!this.wss) return;

        const message = JSON.stringify({
            type,
            payload,
            meta: { server: "CoreX-Hub", ts: Date.now() }
        });

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
    }

    _handleConnection(ws, req) {
        const ip = req.socket.remoteAddress;
        logger.info(`🔌 WS Client Connected [IP: ${ip}]`);

        ws.isAlive = true;

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

    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
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
