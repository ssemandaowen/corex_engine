"use strict";

const WebSocket = require("ws");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

class Broadcaster {
    constructor() {
        this.wss = null;
        this.isInitialized = false;
        this.heartbeatInterval = null;
    }

    /**
     * Initialize WS server & bind engine events
     * @param {http.Server} server - HTTP server instance
     */
    initServer(server) {
        if (this.isInitialized) return;

        // Create WS server on /ws path
        this.wss = new WebSocket.Server({ server, path: "/ws" });

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
            { event: EVENTS.ORDER.CREATE, type: "ORDER_FILLED" },
            { event: EVENTS.SYSTEM.SETTINGS, type: "PARAM_UPDATE" }
        ];

        mappings.forEach(({ event, type }) => {
            bus.on(event, (payload) => this.transmit(type, payload));
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
}

module.exports = new Broadcaster();
