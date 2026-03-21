"use strict";

function normalizeSignal(signal, context = {}) {
    if (!signal || typeof signal !== "object") return null;
    // Security/tenancy: always prefer engine-provided strategyId from context.
    // Strategy-emitted IDs are treated as advisory and must not override runtime ownership.
    const strategyId = String(context.strategyId || signal.strategyId || "").trim();
    const symbol = String(signal.symbol || context.symbol || "").trim();
    const rawIntent = String(signal.intent || signal.action || signal.type || "").trim().toUpperCase();
    const intent = ["EXIT", "CLOSE", "FLAT"].includes(rawIntent)
        ? "EXIT"
        : (["ENTER", "OPEN", "BUY", "SELL", "LONG", "SHORT"].includes(rawIntent) ? "ENTER" : rawIntent);

    if (!strategyId || !symbol || !intent) return null;

    const rawSide = String(signal.side || signal.direction || signal.orderSide || "").trim().toLowerCase();
    const normalizedSide = ["buy", "long"].includes(rawSide)
        ? "long"
        : (["sell", "short"].includes(rawSide) ? "short" : "flat");

    const normalized = {
        ...signal,
        strategyId,
        symbol,
        intent,
        side: normalizedSide,
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
