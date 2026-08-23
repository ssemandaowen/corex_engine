"use strict";

const RuntimeBrokerFactory = require("../RuntimeBrokerFactory");

class RiskGateway {
    static async submit({ connection, command }) {
        const { runtimeId, mode, payload } = command;
        const action = String(payload.action || "").toUpperCase();

        let broker;
        try {
            const existingSession = _findBrokerByRuntimeId(runtimeId);
            if (existingSession) {
                broker = existingSession;
            } else {
                broker = RuntimeBrokerFactory.createBroker(mode, {
                    runtimeId,
                    symbol: payload.symbol || "",
                    mode: mode.toUpperCase(),
                });
                await broker.initialize({ runtimeId, mode });
                _registerBrokerSession(runtimeId, broker);
            }
        } catch (err) {
            return { status: "REJECTED", reason: err.message, reasonCode: "BROKER_ERROR" };
        }

        try {
            let result;
            switch (action) {
            case "BUY":
                result = await broker.handle({
                    intent: "ENTER",
                    side: "long",
                    symbol: payload.symbol,
                    quantity: payload.quantity,
                    orderType: payload.orderType || "MARKET",
                    sl: payload.stopLoss,
                    tp: payload.takeProfit,
                    price: payload.limitPrice,
                });
                break;

            case "SELL":
                result = await broker.handle({
                    intent: "ENTER",
                    side: "short",
                    symbol: payload.symbol,
                    quantity: payload.quantity,
                    orderType: payload.orderType || "MARKET",
                    sl: payload.stopLoss,
                    tp: payload.takeProfit,
                    price: payload.limitPrice,
                });
                break;

            case "MODIFY":
                result = await broker.modify(payload.targetPositionId, {
                    stopLoss: payload.stopLoss,
                    takeProfit: payload.takeProfit,
                });
                break;

            case "CANCEL":
                result = await broker.cancel(payload.targetOrderId);
                break;

            default:
                return { status: "REJECTED", reason: `Unknown action: ${action}`, reasonCode: "INVALID_SYMBOL" };
            }

            return result;
        } catch (err) {
            return { status: "REJECTED", reason: err.message, reasonCode: "BROKER_ERROR" };
        }
    }
}

const _runtimeIdToBroker = new Map();

function _findBrokerByRuntimeId(runtimeId) {
    return _runtimeIdToBroker.get(runtimeId) || null;
}

function _registerBrokerSession(runtimeId, broker) {
    _runtimeIdToBroker.set(runtimeId, broker);
}

RiskGateway.registerBroker = function (runtimeId, broker) {
    _runtimeIdToBroker.set(runtimeId, broker);
};

RiskGateway.unregisterBroker = function (runtimeId) {
    _runtimeIdToBroker.delete(runtimeId);
};

module.exports = { RiskGateway };