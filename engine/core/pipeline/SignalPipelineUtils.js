"use strict";

function normalizeSignal(signal, context = {}) {
    if (!signal || typeof signal !== "object") return null;
    const strategyId = String(signal.strategyId || context.strategyId || "").trim();
    const symbol = String(signal.symbol || context.symbol || "").trim();
    const intent = String(signal.intent || "").trim().toUpperCase();

    if (!strategyId || !symbol || !intent) return null;

    const normalized = {
        ...signal,
        strategyId,
        symbol,
        intent,
        side: String(signal.side || "").trim().toLowerCase() || "flat",
        quantity: Number(signal.quantity || 0),
        ts: Number(signal.ts || Date.now())
    };

    if (!Number.isFinite(normalized.quantity) || normalized.quantity < 0) {
        normalized.quantity = 0;
    }
    if (!Number.isFinite(normalized.ts)) {
        normalized.ts = Date.now();
    }
    return normalized;
}

function isSignalValid(signal) {
    return !!(
        signal &&
        typeof signal === "object" &&
        signal.strategyId &&
        signal.symbol &&
        signal.intent
    );
}

module.exports = {
    normalizeSignal,
    isSignalValid
};

