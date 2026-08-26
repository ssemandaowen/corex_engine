"use strict";

const RuntimeBrokerFactory = require("@broker/RuntimeBrokerFactory");

const AUTH_ERROR_PATTERNS = [
    /401/,
    /unauthorized/i,
    /authentication/i,
    /credential/i,
    /token.*expired/i,
    /invalid.*token/i,
    /access.*denied/i,
    /forbidden/i,
];

const DEFAULT_MAX_DRAWDOWN_PCT = 10.0;

function _isAuthError(err) {
    const msg = String(err?.message || "");
    return AUTH_ERROR_PATTERNS.some((re) => re.test(msg));
}

function _defaultRiskCheck(broker, intent) {
    if (typeof broker.getEquity !== "function") return null;
    if (typeof broker.getPositionSnapshot !== "function") return null;
    const maxDrawdownPct = Number(broker.config?.maxDrawdownPct ?? DEFAULT_MAX_DRAWDOWN_PCT);
    if (!Number.isFinite(maxDrawdownPct) || maxDrawdownPct <= 0) return null;

    const currentEquity = broker.getEquity();
    const initialAllocation = broker.initialCash;
    if (!initialAllocation || initialAllocation <= 0) return null;

    const currentDrawdownPct = ((initialAllocation - currentEquity) / initialAllocation) * 100;
    if (currentDrawdownPct >= maxDrawdownPct) {
        return {
            reasonCode: "RISK_LIMIT_EXCEEDED",
            reason: `Portfolio drawdown limit exceeded (${currentDrawdownPct.toFixed(2)}% >= ${maxDrawdownPct}%)`,
        };
    }

    const currentPosition = broker.getPositionSnapshot(intent.symbol);

    if (intent.intent === "EXIT" && currentPosition.side === "FLAT") {
        return { reasonCode: "RISK_LIMIT_EXCEEDED", reason: "Cannot exit a flat position" };
    }

    if (intent.intent === "ENTER" && currentPosition.side === intent.side) {
        if (!intent.allowScaling) {
            return { reasonCode: "RISK_LIMIT_EXCEEDED", reason: "Already in position on this side" };
        }
    }

    return null;
}

function _buildIntent(action, payload) {
    switch (action) {
    case "BUY":
        return { intent: "ENTER", side: "long", symbol: payload.symbol };
    case "SELL":
        return { intent: "ENTER", side: "short", symbol: payload.symbol };
    case "MODIFY":
        return { intent: "MODIFY", side: null, symbol: payload.symbol };
    case "CANCEL":
        return { intent: "CANCEL", side: null, symbol: payload.symbol };
    default:
        return null;
    }
}

class RiskGateway {
    static _riskEngine = null;
    static _engineInjected = false;

    static setRiskEngine(engine) {
        RiskGateway._riskEngine = engine;
        RiskGateway._engineInjected = true;
    }

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
            const reasonCode = _isAuthError(err) ? "BROKER_UNAUTHORIZED" : "BROKER_ERROR";
            return { status: "REJECTED", reason: err.message, reasonCode };
        }

        const intent = _buildIntent(action, payload);
        if (intent) {
            const riskEngine = RiskGateway._riskEngine;
            if (!riskEngine) {
                const env = String(process.env.NODE_ENV || "").trim().toLowerCase();
                const isJest = !!process.env.JEST_WORKER_ID;
                const isTest = env === "test" || env === "testing" || isJest;
                if (isTest) {
                    console.warn("[RiskGateway] No risk engine injected — using default fallback. Wire SocketXRiskEngine at startup in production.");
                } else {
                    throw new Error("RiskGateway: no risk engine injected. Call RiskGateway.setRiskEngine(SocketXRiskEngine) at startup.");
                }
            }
            const portfolioRisk = riskEngine
                ? riskEngine.check(broker, intent)
                : _defaultRiskCheck(broker, intent);
            if (portfolioRisk) {
                return { status: "REJECTED", reason: portfolioRisk.reason, reasonCode: portfolioRisk.reasonCode };
            }
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
            const reasonCode = _isAuthError(err) ? "BROKER_UNAUTHORIZED" : "BROKER_ERROR";
            return { status: "REJECTED", reason: err.message, reasonCode };
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