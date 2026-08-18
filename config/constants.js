// config/constants.js
"use strict";

/**
 * @file CoreX Engine Constants
 * @description Centralized configuration constants for consistent behavior across the application.
 * Harmonized with decoupled polymorphic runtimes, multi-instance trackers, and execution brokers.
 */

// ────────────────────────────────────────────────
// EXECUTION MODES
// ────────────────────────────────────────────────

const MODES = {
    LIVE: "LIVE",
    PAPER: "PAPER",
    BACKTEST: "BACKTEST"
};

const BRIDGE_INTEGRATIONS = {
    MQL5_RECEIVER: "mql5_receiver",
    PYTHON_RECEIVER: "python_receiver",
    METAAPI: "metaapi"
};

// ────────────────────────────────────────────────
// STRATEGY SIGNALS & POSITION STATES
// ────────────────────────────────────────────────

const INTENTS = {
    ENTER: "ENTER",
    EXIT: "EXIT",
    NONE: "NONE"
};

const SIDES = {
    LONG: "long",
    SHORT: "short",
    FLAT: "flat"
};

// ────────────────────────────────────────────────
// EVENT BUS STRUCTURE
// ────────────────────────────────────────────────

const EVENTS = {
    SYSTEM: {
        STRATEGY_LOADED: "system:strategy:loaded",
        STRATEGY_UNLOADED: "system:strategy:unloaded",
        STRATEGY_START: "system:strategy:start",
        STRATEGY_STOP: "system:strategy:stop",
        STATE_CHANGED: "system:strategy:state_changed",
        WORKER_STATE: "system:worker:state",
        JOB_PROGRESS: "system:job:progress",
        ERROR: "system:error",
        LOG: "system:log",
        SETTINGS_UPDATED: "system:settings:updated",
        CONFIG_REFRESH: "system:config:refresh"
    },
    BACKTEST: {
        START: "backtest:start",
        END: "backtest:end",
        ERROR: "backtest:error"
    },
    MARKET: {
        TICK: "market:tick",
        CANDLE: "market:candle",
        CONNECTION_LOST: "market:lost"
    },
    STRATEGY: {
        SIGNAL: "strategy:signal",
        SIGNAL_EXECUTED: "strategy:signal_executed",
        PARAMS_UPDATED: "strategy:params_updated",
        METRICS_TICK: "strategy:metrics_tick"
    },
    RUNTIME: {
        MEMORY_WARNING: "runtime:memory_warning",
        STOPPED: "runtime:stopped"
    },
    ORDER: {
        CREATE: "order:create",
        FILLED: "order:filled",
        CANCELLED: "order:cancelled",
        UPDATE: "order:update"
    },
    POSITION: {
        UPDATED: "position:updated",
        PORTFOLIO_UPDATE: "position:portfolio_update"
    },
    MT5: {
        CONNECTED: "mt5:connected",
        DISCONNECTED: "mt5:disconnected",
        AUTHORIZED: "mt5:authorized",
        AUTH_FAILED: "mt5:auth_failed",
        HEARTBEAT: "mt5:heartbeat",
        ACCOUNT_SYNC: "mt5:account_sync",
        POSITIONS_SYNC: "mt5:positions_sync",
        ORDER_REQUEST: "mt5:order_request",
        ORDER_RESULT: "mt5:order_result"
    }
    ,
    BROKER: {
        STATE_CHANGED: "broker:state_changed"
    }
};

const WS_EVENT_TYPES = {
    DATA_TICK: "DATA_TICK",
    DATA_CANDLE: "DATA_CANDLE",
    MARKET_LOST: "MARKET_LOST",
    ORDER_CREATED: "ORDER_CREATED",
    ORDER_FILLED: "ORDER_FILLED",
    ORDER_CANCELLED: "ORDER_CANCELLED",
    ORDER_UPDATED: "ORDER_UPDATED",
    POSITION_UPDATED: "POSITION_UPDATED",
    PORTFOLIO_UPDATED: "PORTFOLIO_UPDATED",
    STRATEGY_SIGNAL: "STRATEGY_SIGNAL",
    STRATEGY_LOADED: "STRATEGY_LOADED",
    STRATEGY_UNLOADED: "STRATEGY_UNLOADED",
    STRATEGY_START: "STRATEGY_START",
    STRATEGY_STOP: "STRATEGY_STOP",
    STRATEGY_STATE: "STRATEGY_STATE",
    STRATEGY_PARAMS_UPDATED: "STRATEGY_PARAMS_UPDATED",
    STRATEGY_METRICS_TICK: "STRATEGY_METRICS_TICK",
    WORKER_STATE: "WORKER_STATE",
    BACKTEST_PROGRESS: "BACKTEST_PROGRESS",
    RUNTIME_MEMORY_WARNING: "RUNTIME_MEMORY_WARNING",
    SYSTEM_ERROR: "SYSTEM_ERROR",
    SYSTEM_LOG: "SYSTEM_LOG",
    PARAM_UPDATE: "PARAM_UPDATE",
    STATUS_UPDATE: "STATUS_UPDATE",
    FEED_METRICS: "FEED_METRICS",
    MT5_CONNECTED: "MT5_CONNECTED",
    MT5_DISCONNECTED: "MT5_DISCONNECTED",
    MT5_AUTHORIZED: "MT5_AUTHORIZED",
    MT5_AUTH_FAILED: "MT5_AUTH_FAILED",
    MT5_HEARTBEAT: "MT5_HEARTBEAT",
    MT5_ACCOUNT_SYNC: "MT5_ACCOUNT_SYNC",
    MT5_POSITIONS_SYNC: "MT5_POSITIONS_SYNC",
    MT5_ORDER_REQUEST: "MT5_ORDER_REQUEST",
    MT5_ORDER_RESULT: "MT5_ORDER_RESULT"
};

const BUS_EVENT_TO_WS = [
    { event: EVENTS.MARKET.TICK, type: WS_EVENT_TYPES.DATA_TICK, category: "market" },
    { event: EVENTS.MARKET.CANDLE, type: WS_EVENT_TYPES.DATA_CANDLE, category: "market" },
    { event: EVENTS.MARKET.CONNECTION_LOST, type: WS_EVENT_TYPES.MARKET_LOST, category: "market" },
    { event: EVENTS.ORDER.CREATE, type: WS_EVENT_TYPES.ORDER_CREATED, category: "execution" },
    { event: EVENTS.ORDER.FILLED, type: WS_EVENT_TYPES.ORDER_FILLED, category: "execution" },
    { event: EVENTS.ORDER.CANCELLED, type: WS_EVENT_TYPES.ORDER_CANCELLED, category: "execution" },
    { event: EVENTS.ORDER.UPDATE, type: WS_EVENT_TYPES.ORDER_UPDATED, category: "execution" },
    { event: EVENTS.POSITION.UPDATED, type: WS_EVENT_TYPES.POSITION_UPDATED, category: "execution" },
    { event: EVENTS.POSITION.PORTFOLIO_UPDATE, type: WS_EVENT_TYPES.PORTFOLIO_UPDATED, category: "execution" },
    { event: EVENTS.STRATEGY.SIGNAL, type: WS_EVENT_TYPES.STRATEGY_SIGNAL, category: "strategy" },
    { event: EVENTS.SYSTEM.STRATEGY_LOADED, type: WS_EVENT_TYPES.STRATEGY_LOADED, category: "system" },
    { event: EVENTS.SYSTEM.STRATEGY_UNLOADED, type: WS_EVENT_TYPES.STRATEGY_UNLOADED, category: "system" },
    { event: EVENTS.SYSTEM.STRATEGY_START, type: WS_EVENT_TYPES.STRATEGY_START, category: "system" },
    { event: EVENTS.SYSTEM.STRATEGY_STOP, type: WS_EVENT_TYPES.STRATEGY_STOP, category: "system" },
    { event: EVENTS.SYSTEM.STATE_CHANGED, type: WS_EVENT_TYPES.STRATEGY_STATE, category: "system" },
    { event: EVENTS.SYSTEM.WORKER_STATE, type: WS_EVENT_TYPES.WORKER_STATE, category: "system" },
    { event: EVENTS.SYSTEM.JOB_PROGRESS, type: WS_EVENT_TYPES.BACKTEST_PROGRESS, category: "execution" },
    { event: EVENTS.SYSTEM.ERROR, type: WS_EVENT_TYPES.SYSTEM_ERROR, category: "system" },
    { event: EVENTS.SYSTEM.LOG, type: WS_EVENT_TYPES.SYSTEM_LOG, category: "system" },
    { event: EVENTS.SYSTEM.SETTINGS_UPDATED, type: WS_EVENT_TYPES.PARAM_UPDATE, category: "system" },
    { event: EVENTS.STRATEGY.PARAMS_UPDATED, type: WS_EVENT_TYPES.STRATEGY_PARAMS_UPDATED, category: "strategy" },
    { event: EVENTS.STRATEGY.METRICS_TICK, type: WS_EVENT_TYPES.STRATEGY_METRICS_TICK, category: "strategy" },
    { event: EVENTS.RUNTIME.MEMORY_WARNING, type: WS_EVENT_TYPES.RUNTIME_MEMORY_WARNING, category: "runtime" },
    { event: EVENTS.MT5.CONNECTED, type: WS_EVENT_TYPES.MT5_CONNECTED, category: "mt5" },
    { event: EVENTS.MT5.DISCONNECTED, type: WS_EVENT_TYPES.MT5_DISCONNECTED, category: "mt5" },
    { event: EVENTS.MT5.AUTHORIZED, type: WS_EVENT_TYPES.MT5_AUTHORIZED, category: "mt5" },
    { event: EVENTS.MT5.AUTH_FAILED, type: WS_EVENT_TYPES.MT5_AUTH_FAILED, category: "mt5" },
    { event: EVENTS.MT5.HEARTBEAT, type: WS_EVENT_TYPES.MT5_HEARTBEAT, category: "mt5" },
    { event: EVENTS.MT5.ACCOUNT_SYNC, type: WS_EVENT_TYPES.MT5_ACCOUNT_SYNC, category: "mt5" },
    { event: EVENTS.MT5.POSITIONS_SYNC, type: WS_EVENT_TYPES.MT5_POSITIONS_SYNC, category: "mt5" },
    { event: EVENTS.MT5.ORDER_REQUEST, type: WS_EVENT_TYPES.MT5_ORDER_REQUEST, category: "mt5" },
    { event: EVENTS.MT5.ORDER_RESULT, type: WS_EVENT_TYPES.MT5_ORDER_RESULT, category: "mt5" }
];

// ────────────────────────────────────────────────
// DEFAULT CONFIGURATION VALUES
// ────────────────────────────────────────────────

const DEFAULT_STRATEGY_CONFIG = {
    LOOKBACK: 100,
    MAX_DATA_HISTORY: 5000,
    TIMEFRAME: "1m",
    INITIAL_CASH: 100000
};

const PAPER_BROKER_DEFAULTS = {
    INITIAL_CASH: 100000,
    COMMISSION_PER_SHARE: 0.005,
    COMMISSION_MIN: 1.00,
    SLIPPAGE_BPS: 5,
    SPREAD_BPS: 2,                        // Synced default spread bps tracking
    FILL_PROBABILITY: 1.0,
    LATENCY_MS_MIN: 0,
    LATENCY_MS_MAX: 0,
    POSITION_BROADCAST_MIN_MS: 250,
    LEVERAGE: 100                         // Synced margin allocation parameter
};

const RISK_DEFAULTS = {
    RISK_PER_TRADE: 0.01,                 // 1% of portfolio risk per trade
    MAX_POSITION_SIZE: 0.25,              // Maximum 25% of portfolio per position
    MIN_TRADE_SIZE: 0.01,                 // Minimum 1% of portfolio for micro positions
    MAX_POSITION_RISK_PCT: 5.0,           // Hard guardrail risk limit floor
    MAX_GLOBAL_DRAWDOWN_PCT: 10.0,         // Pipeline risk engine auto-halt cutoff
    MAX_DAILY_LOSS_LIMIT: 2500            // Daily floating account loss cap
};

// ────────────────────────────────────────────────
// NETWORK & TERMINAL INTEGRATION PIPES
// ────────────────────────────────────────────────

const NETWORK_TUNING = {
    MT5_HOST: "127.0.0.1",
    MT5_PORT: 8082,
    REST_REQUEST_TIMEOUT_MS: 4000,
    LIVE_CONNECTOR_TIMEOUT_MS: 3000
};

// ────────────────────────────────────────────────
// FILE SYSTEM PATHS
// ────────────────────────────────────────────────

const PATHS = {
    STRATEGIES: "./strategies",
    DATA: "./data",
    SETTINGS: "./data/settings",
    CACHE: "./data/cache",
    BACKTESTS: "./data/backtests"
};

// ────────────────────────────────────────────────
// API RESPONSE CONSTANTS
// ────────────────────────────────────────────────

const API_RESPONSES = {
    SUCCESS: { success: true },
    ERROR: { success: false },
    ERRORS: {
        STRATEGY_NOT_FOUND: "STRATEGY_NOT_FOUND",
        INVALID_ACTION: "INVALID_ACTION",
        VALIDATION_FAILED: "VALIDATION_FAILED",
        FETCH_FAILED: "FETCH_FAILED",
        SECURITY_VIOLATION: "Security Violation: Illegal code patterns detected.",
        INVALID_MODE: "Invalid mode. Use 'PAPER' or 'BACKTEST'"
    }
};

// ────────────────────────────────────────────────
// LOGGING & MONITORING
// ────────────────────────────────────────────────

const LOG_PREFIXES = {
    BOOT: "⚙️ Booting",
    STRATEGY: "✅ Strategy",
    ENGINE: "🟢 CoreX Engine",
    HUB: "🌐 CoreX Hub",
    ADAPTER: "[ADAPTER]",
    PAPER: "[PAPER]",
    API: "[API]",
    ERROR: "💥",
    WARN: "⚠️",
    INFO: "ℹ️",
    DEBUG: "🔍"
};

// ────────────────────────────────────────────────
// TIME & PERFORMANCE
// ────────────────────────────────────────────────

const TIME = {
    MS: {
        SECOND: 1000,
        MINUTE: 60000,
        HOUR: 3600000,
        DAY: 86400000
    },
    DEFAULT_TIMEFRAMES: ["1m", "5m", "15m", "1h", "4h", "1d"],
    TF_PATTERN: /^(\d+)([smhd])$/
};

const PERFORMANCE = {
    SIGNAL_COOLDOWN_MS: 500,
    WARMUP_MULTIPLIER: 3,
    MIN_BARS_FOR_STRATEGY: 20,
    FS_WATCH_DEBOUNCE_MS: 100
};

const ENGINE_TUNING = {
    TICK_QUEUE_MAX: 5000,
    TICK_FLUSH_MAX: 10000,
    STRAT_QUEUE_MAX: 1000,
    STRAT_SLICE_MS: 5,
    WARMUP_LOOKBACK: 300,
    WARMUP_CACHE_MAX_PATCH_BARS: 5000,
    WARMUP_CACHE_MAX_WRITE_BARS: 2000
};

const BACKTEST = {
    DB_REQUIRED: true,
    BACKTEST_MAX_CANDLES: 5000            // 3-Gate safety cap matching BacktestFeed/Broker
};

// ────────────────────────────────────────────────
// EXPORT ALL CONSTANTS
// ────────────────────────────────────────────────

module.exports = Object.freeze({
    MODES,
    BRIDGE_INTEGRATIONS,
    INTENTS,
    SIDES,
    EVENTS,
    WS_EVENT_TYPES,
    BUS_EVENT_TO_WS,
    DEFAULT_STRATEGY_CONFIG,
    PAPER_BROKER_DEFAULTS,
    RISK_DEFAULTS,
    NETWORK_TUNING,
    PATHS,
    API_RESPONSES,
    LOG_PREFIXES,
    TIME,
    PERFORMANCE,
    ENGINE_TUNING,
    BACKTEST
});