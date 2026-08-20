// broker/connectors/MT5MQL5Connector.js
"use strict";

const mt5Bridge = require("../mt5Bridge");
const { NETWORK_TUNING, EVENTS } = require("@config/constants");
const { bus } = require("@events/bus");

/**
 * CoreX MT5 MQL5 Bridge Connector
 * Wraps your existing terminal bridge service into the standardized Polymorphic Connector interface.
 */
class MT5MQL5Connector {
    constructor() {
        this.host = NETWORK_TUNING.MT5_HOST || "127.0.0.1";
        this.port = NETWORK_TUNING.MT5_PORT || 8082;
    }

    /**
     * Sends a buy/sell trade request payload directly down to the MQL5 Expert Advisor listener.
     * @param {Object} intent - Standardized, validated IntentObject payload
     * @returns {Promise<Object>} Execution result containing order ID and transaction details
     */
    async executeOrder(intent) {
        const { symbol, side, quantity, sl, tp, runtimeId } = intent;

        // Map internal lowercase position states to clear MT5 Action terms
        let actionType = "BUY";
        if (side.toLowerCase() === "short") {
            actionType = "SELL";
        }

        const payload = {
            action: actionType,
            symbol: symbol.toUpperCase(),
            volume: Number(quantity),
            sl: Number(sl || 0),
            tp: Number(tp || 0),
            comment: String(runtimeId) // Pass runtime identification token safely inside transaction comments
        };

        try {
            // Forward directly across your core socket handler instance
            const response = await mt5Bridge.sendOrderRequest(payload);
            
            if (!response || response.retcode !== 0) {
                throw new Error(response?.comment || "Terminal connection rejected order placement.");
            }

            try { if (intent.runtimeId) bus.emit(EVENTS.BROKER.STATE_CHANGED, { userId: intent.userId || null, mode: intent.mode || null, payload: {} }); } catch (e) {}
            return {
                success: true,
                orderId: response.order_ticket || `mt5_${Date.now()}`,
                executionPrice: response.price || intent.price,
                raw: response
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                raw: null
            };
        }
    }

    /**
     * Explicit position liquidation path mapping down to the terminal.
     * @param {string} symbol - Canonical financial asset string identifier
     * @param {string} runtimeId - The tracking identifier owning the active asset position
     */
    async liquidatePosition(symbol, runtimeId) {
        const payload = {
            action: "CLOSE_ALL",
            symbol: symbol.toUpperCase(),
            comment: String(runtimeId)
        };

        try {
            const response = await mt5Bridge.sendOrderRequest(payload);
            try { if (runtimeId) bus.emit(EVENTS.BROKER.STATE_CHANGED, { userId: null, mode: null, payload: {} }); } catch (e) {}
            return {
                success: response?.retcode === 0,
                raw: response
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = MT5MQL5Connector;