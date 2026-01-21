"use strict";

const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

class Broadcaster {
    constructor() {
        this.wss = null;
        this.isInitialized = false;
    }

    /**
     * @param {WebSocket.Server} wss - Express/HTTP shared WS server
     */
    init(wss) {
        if (this.isInitialized) return;
        this.wss = wss;

        // 1. Monitor Connections
        this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));

        // 2. Global Event Bindings (The Engine-to-UI Bridge)
        this._bindInternalEvents();

        this.isInitialized = true;
        logger.info("📡 Broadcaster Service: [===Stream Logic Finalized===]");
    }

    /**
     * Internal Routing Table
     * Maps internal Bus Events to specific UI Action Types
     */
    _bindInternalEvents() {
        const mappings = [
            { event: EVENTS.MARKET.TICK,      type: "DATA_TICK" },
            { event: EVENTS.ORDER.CREATE,     type: "ORDER_FILLED" },
            { event: EVENTS.SYSTEM.SETTINGS,  type: "PARAM_UPDATE" },
            { event: "BACKTEST_FRAME",        type: "BT_PROGRESS" }
        ];

        mappings.forEach(({ event, type }) => {
            bus.on(event, (payload) => this.transmit(type, payload));
        });
    }

    /**
     * Primary Transmission Method
     * Distinct pathing: ensures payload is wrapped with metadata
     */
    transmit(type, payload) {
        if (!this.wss) return;

        const message = JSON.stringify({
            type,
            payload,
            meta: { server: "CoreX-Hub", ts: Date.now() }
        });

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
            }
        });
    }

    _handleConnection(ws, req) {
        const ip = req.socket.remoteAddress;
        
        // Advanced: Simple Auth check on upgrade (optional)
        const protocol = req.headers['sec-websocket-protocol'];
        
        logger.info(`🔌 UI Terminal Connected [IP: ${ip}]`);

        ws.on("error", (err) => logger.error(`📡 WS Stream Error: ${err.message}`));
        ws.on("close", () => logger.debug(`🔌 UI Terminal Disconnected [IP: ${ip}]`));
    }
}

module.exports = new Broadcaster();