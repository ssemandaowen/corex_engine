"use strict";

const marketBroker = require("@broker/twelvedata");
const mt5Bridge = require("@core/services/mt5Bridge");

function getMarketStatus() {
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
}

function marketConnectivityLabel(status) {
    if (!status?.websocketEnabled) return "DISABLED";
    if (status?.connected) return "CONNECTED";
    if (Number(status?.nextReconnectAt || 0) > Date.now()) return "RECONNECTING";
    return "DISCONNECTED";
}

module.exports = { getMarketStatus, marketConnectivityLabel };
