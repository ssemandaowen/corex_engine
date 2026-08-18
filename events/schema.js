"use strict";
const crypto = require("crypto");

function normalizeMeta(meta = {}) {
    const ts = Number.isFinite(Number(meta.ts)) ? meta.ts : Date.now();
  
    // Only include keys if they have value to avoid "delete" overhead
    const next = { ts };
    if (meta.userId) next.userId = String(meta.userId).trim();
    if (meta.strategyId) next.strategyId = String(meta.strategyId).trim();
    if (meta.symbol) next.symbol = String(meta.symbol).trim();
    if (meta.correlationId) next.correlationId = String(meta.correlationId).trim();

    return next;
}

/**
 * EventPayloadSchemas
 * 
 * Documentation of all event payload shapes emitted on the event bus.
 * This is the source of truth for what data is attached to each event.
 * 
 * Event emitters must conform to these schemas. Consumers can rely on
 * the documented fields being present and correctly typed.
 */
const EventPayloadSchemas = {
    // ─────────────────────────────────────────────────────────
    // STRATEGY LIFECYCLE EVENTS
    // ─────────────────────────────────────────────────────────
  
    "strategy:signal": {
        description: "Generated buy/sell/exit signal from strategy",
        payload: {
            runtimeId: "string",
            symbol: "string",
            side: "string (LONG|SHORT|FLAT)",
            quantity: "number",
            price: "number",
            intent: "string (ENTER|EXIT|NONE)",
            confidence: "number (0-1)",
            ts: "number (ms epoch)"
        }
    },

    "system:strategy:loaded": {
        description: "Strategy script has been loaded and validated",
        payload: {
            strategyId: "string",
            name: "string",
            version: "string",
            schema: "object (parameter definitions)",
            ts: "number (ms epoch)"
        }
    },

    "system:strategy:unloaded": {
        description: "Strategy has been unloaded from memory",
        payload: {
            strategyId: "string",
            reason: "string (optional: WHY it was unloaded)",
            ts: "number (ms epoch)"
        }
    },

    "system:strategy:start": {
        description: "Strategy runtime has started",
        payload: {
            runtimeId: "string",
            strategyId: "string",
            mode: "string (LIVE|PAPER|BACKTEST)",
            symbol: "string",
            ts: "number (ms epoch)"
        }
    },

    "system:strategy:stop": {
        description: "Strategy runtime has stopped",
        payload: {
            runtimeId: "string",
            strategyId: "string",
            reason: "string (optional)",
            ts: "number (ms epoch)"
        }
    },

    "strategy:params_updated": {
        description: "Strategy parameters have been patched at runtime",
        payload: {
            runtimeId: "string",
            strategyId: "string",
            changed: "object { paramKey: { old, new } }",
            ts: "number (ms epoch)"
        }
    },

    "strategy:metrics_tick": {
        description: "Metrics snapshot on every closed trade (live/paper only)",
        payload: {
            runtimeId: "string",
            strategyId: "string",
            trade: "object (closed trade record)",
            metrics: "object (standard metrics snapshot)",
            ts: "number (ms epoch)"
        }
    },

    // ─────────────────────────────────────────────────────────
    // POSITION & EXECUTION EVENTS
    // ─────────────────────────────────────────────────────────

    "order:create": {
        description: "New order has been created",
        payload: {
            orderId: "string",
            runtimeId: "string",
            symbol: "string",
            side: "string (BUY|SELL|LONG|SHORT)",
            quantity: "number",
            orderType: "string (MARKET|LIMIT|STOP)",
            price: "number (for limit/stop orders)",
            ts: "number (ms epoch)"
        }
    },

    "order:filled": {
        description: "Order has been fully or partially filled",
        payload: {
            orderId: "string",
            runtimeId: "string",
            symbol: "string",
            filledQuantity: "number",
            fillPrice: "number",
            commission: "number",
            ts: "number (ms epoch)"
        }
    },

    "order:cancelled": {
        description: "Order has been cancelled",
        payload: {
            orderId: "string",
            runtimeId: "string",
            reason: "string",
            ts: "number (ms epoch)"
        }
    },

    "position:updated": {
        description: "Position has changed (entry, exit, update)",
        payload: {
            runtimeId: "string",
            symbol: "string",
            side: "string (LONG|SHORT|FLAT)",
            quantity: "number",
            entryPrice: "number",
            currentPrice: "number",
            unrealizedPnL: "number",
            ts: "number (ms epoch)"
        }
    },

    "position:portfolio_update": {
        description: "Portfolio state has changed",
        payload: {
            runtimeId: "string",
            userId: "string",
            balance: "number",
            equity: "number",
            positions: "array of position objects",
            ts: "number (ms epoch)"
        }
    },

    // ─────────────────────────────────────────────────────────
    // MARKET DATA EVENTS
    // ─────────────────────────────────────────────────────────

    "market:tick": {
        description: "Incoming market tick data",
        payload: {
            symbol: "string",
            price: "number",
            bid: "number",
            ask: "number",
            volume: "number",
            ts: "number (ms epoch)"
        }
    },

    "market:candle": {
        description: "Incoming OHLCV candle data",
        payload: {
            symbol: "string",
            timeframe: "string (1m|5m|15m|1h|4h|1d)",
            open: "number",
            high: "number",
            low: "number",
            close: "number",
            volume: "number",
            ts: "number (ms epoch)"
        }
    },

    "market:lost": {
        description: "Market connection has been lost",
        payload: {
            reason: "string",
            ts: "number (ms epoch)"
        }
    },

    // ─────────────────────────────────────────────────────────
    // RUNTIME & SYSTEM EVENTS
    // ─────────────────────────────────────────────────────────

    "runtime:memory_warning": {
        description: "Runtime memory usage approaching limits",
        payload: {
            runtimeId: "string",
            strategyId: "string",
            currentUsagePercent: "number (0-100)",
            threshold: "number (0-100)",
            component: "string (dataManager|positionManager|etc)",
            ts: "number (ms epoch)"
        }
    },

    "system:state_changed": {
        description: "System state has changed",
        payload: {
            state: "string",
            details: "object",
            ts: "number (ms epoch)"
        }
    },

    "system:error": {
        description: "System error has occurred",
        payload: {
            level: "string (error|critical)",
            message: "string",
            component: "string",
            stack: "string (optional)",
            ts: "number (ms epoch)"
        }
    },

    "system:log": {
        description: "System log entry",
        payload: {
            level: "string (debug|info|warn|error)",
            message: "string",
            component: "string",
            ts: "number (ms epoch)"
        }
    },

    "broker:state_changed": {
        description: "Broker state has changed (balance, config, etc)",
        payload: {
            userId: "string",
            mode: "string (LIVE|PAPER|BACKTEST)",
            payload: "object (changed fields: { cash, balance, positions, etc })",
            ts: "number (ms epoch)"
        }
    },

    // ─────────────────────────────────────────────────────────
    // BACKTEST EVENTS
    // ─────────────────────────────────────────────────────────

    "backtest:start": {
        description: "Backtest simulation has started",
        payload: {
            backtestId: "string",
            strategyId: "string",
            startDate: "string (ISO 8601)",
            endDate: "string (ISO 8601)",
            ts: "number (ms epoch)"
        }
    },

    "backtest:end": {
        description: "Backtest simulation has completed",
        payload: {
            backtestId: "string",
            metrics: "object (final performance metrics)",
            totalTrades: "number",
            totalBars: "number",
            duration: "number (ms)",
            ts: "number (ms epoch)"
        }
    },

    "backtest:error": {
        description: "Backtest encountered an error",
        payload: {
            backtestId: "string",
            message: "string",
            ts: "number (ms epoch)"
        }
    },

    // ─────────────────────────────────────────────────────────
    // MT5 INTEGRATION EVENTS
    // ─────────────────────────────────────────────────────────

    "mt5:connected": {
        description: "MT5 terminal connected",
        payload: {
            terminalId: "string",
            ts: "number (ms epoch)"
        }
    },

    "mt5:disconnected": {
        description: "MT5 terminal disconnected",
        payload: {
            terminalId: "string",
            reason: "string",
            ts: "number (ms epoch)"
        }
    },

    "mt5:authorized": {
        description: "MT5 account authorized",
        payload: {
            terminalId: "string",
            accountNumber: "string",
            ts: "number (ms epoch)"
        }
    },

    "mt5:auth_failed": {
        description: "MT5 authorization failed",
        payload: {
            terminalId: "string",
            reason: "string",
            ts: "number (ms epoch)"
        }
    }
};

module.exports = { normalizeMeta, newCorrelationId: crypto.randomUUID, EventPayloadSchemas };
