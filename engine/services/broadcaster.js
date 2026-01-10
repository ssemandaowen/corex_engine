"use strict";

const { bus, EVENTS } = require("../../events/bus");
const logger = require("../../utils/logger");

/**
 * @service Broadcaster
 * @description Bridges internal engine events to the outside world (Web UI)
 */
function initBroadcaster(wss) {
    wss.on("connection", (ws, req) => {
        const ip = req.socket.remoteAddress;
        logger.info(`🔌 UI Terminal Connected: ${ip}`);

        // Helper to send formatted JSON
        const transmit = (event, payload) => {
            if (ws.readyState === 1) { // 1 = OPEN
                ws.send(JSON.stringify({ 
                    event, 
                    data: payload, 
                    ts: Date.now() 
                }));
            }
        };

        // --- BIND REAL-TIME FEEDERS ---
        // 1. Market Ticks (The "Heartbeat")
        const tickHandler = (tick) => transmit("MARKET_TICK", tick);
        bus.on(EVENTS.MARKET.TICK, tickHandler);

        // 2. Execution Logs (When a strategy buys/sells)
        const orderHandler = (order) => transmit("ORDER_UPDATE", order);
        bus.on(EVENTS.ORDER.CREATE, orderHandler);

        // 3. System Alerts (Start/Stop/Reload)
        const sysHandler = (info) => transmit("SYSTEM_ALERT", info);
        bus.on(EVENTS.SYSTEM.STRATEGY_START, sysHandler);
        bus.on(EVENTS.SYSTEM.STRATEGY_STOP, sysHandler);

        // --- CLEANUP ON DISCONNECT ---
        ws.on("close", () => {
            logger.warn(`🔌 UI Terminal Disconnected: ${ip}`);
            bus.removeListener(EVENTS.MARKET.TICK, tickHandler);
            bus.removeListener(EVENTS.ORDER.CREATE, orderHandler);
            bus.removeListener(EVENTS.SYSTEM.STRATEGY_START, sysHandler);
            bus.removeListener(EVENTS.SYSTEM.STRATEGY_STOP, sysHandler);
        });
    });
}

module.exports = { initBroadcaster };