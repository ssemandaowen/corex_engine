"use strict";

/**
 * @file CoreX Engine Constants
 * @description Centralized configuration constants for consistent behavior across the application.
 */

// ────────────────────────────────────────────────
// EXECUTION MODES
// ────────────────────────────────────────────────

const MODES = {
  LIVE: 'LIVE',
  PAPER: 'PAPER',
  BACKTEST: 'BACKTEST'
};

// ────────────────────────────────────────────────
// STRATEGY SIGNALS & POSITION STATES
// ────────────────────────────────────────────────

const INTENTS = {
  ENTER: 'ENTER',
  EXIT: 'EXIT',
  NONE: 'NONE'
};

const SIDES = {
  LONG: 'long',
  SHORT: 'short',
  FLAT: 'flat'
};

// ────────────────────────────────────────────────
// EVENT BUS STRUCTURE
// ────────────────────────────────────────────────

const EVENTS = {
  SYSTEM: {
    STRATEGY_LOADED: 'system:strategy:loaded',
    STRATEGY_START: 'system:strategy:start',
    STRATEGY_STOP: 'system:strategy:stop',
    ERROR: 'system:error',
    SETTINGS_UPDATED: 'system:settings:updated'
  },
  MARKET: {
    TICK: 'market:tick',
    CANDLE: 'market:candle',
    CONNECTION_LOST: 'market:lost'
  },
  STRATEGY: {
    SIGNAL: 'strategy:signal'
  },
  ORDER: {
    CREATE: 'order:create',
    FILLED: 'order:filled',
    CANCELLED: 'order:cancelled',
    UPDATE: 'order:update'
  },
  POSITION: {
    UPDATED: 'position:updated',
    PORTFOLIO_UPDATE: 'position:portfolio_update'
  }
};

// ────────────────────────────────────────────────
// DEFAULT CONFIGURATION VALUES
// ────────────────────────────────────────────────

const DEFAULT_STRATEGY_CONFIG = {
  LOOKBACK: 100,
  MAX_DATA_HISTORY: 5000,
  TIMEFRAME: '1m',
  INITIAL_CASH: 100000
};

const PAPER_BROKER_DEFAULTS = {
  INITIAL_CASH: 100000,
  COMMISSION_PER_SHARE: 0.005,
  COMMISSION_MIN: 1.00,
  SLIPPAGE_BPS: 5,
  FILL_PROBABILITY: 0.98
};

const RISK_DEFAULTS = {
  RISK_PER_TRADE: 0.01,      // 1% of portfolio risk per trade
  MAX_POSITION_SIZE: 0.25,    // Maximum 25% of portfolio per position
  MIN_TRADE_SIZE: 0.01        // Minimum 1% of portfolio for micro positions
};

// ────────────────────────────────────────────────
// FILE SYSTEM PATHS
// ────────────────────────────────────────────────

const PATHS = {
  STRATEGIES: './strategies',
  DATA: './data',
  SETTINGS: './data/settings',
  CACHE: './data/cache',
  BACKTESTS: './data/backtests'
};

// ────────────────────────────────────────────────
// API RESPONSE CONSTANTS
// ────────────────────────────────────────────────

const API_RESPONSES = {
  SUCCESS: { success: true },
  ERROR: { success: false },
  ERRORS: {
    STRATEGY_NOT_FOUND: 'STRATEGY_NOT_FOUND',
    INVALID_ACTION: 'INVALID_ACTION',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    FETCH_FAILED: 'FETCH_FAILED',
    SECURITY_VIOLATION: 'Security Violation: Illegal code patterns detected.',
    INVALID_MODE: "Invalid mode. Use 'PAPER' or 'BACKTEST'"
  }
};

// ────────────────────────────────────────────────
// LOGGING & MONITORING
// ────────────────────────────────────────────────

const LOG_PREFIXES = {
  BOOT: '⚙️ Booting',
  STRATEGY: '✅ Strategy',
  ENGINE: '🟢 CoreX Engine',
  HUB: '🌐 CoreX Hub',
  ADAPTER: '[ADAPTER]',
  PAPER: '[PAPER]',
  API: '[API]',
  ERROR: '💥',
  WARN: '⚠️',
  INFO: 'ℹ️',
  DEBUG: '🔍'
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
  DEFAULT_TIMEFRAMES: ['1m', '5m', '15m', '1h', '4h', '1d'],
  TF_PATTERN: /^(\d+)([smhd])$/ // Regex pattern for timeframe validation
};

const PERFORMANCE = {
  SIGNAL_COOLDOWN_MS: 500,    // Minimum 500ms between same-symbol signals
  WARMUP_MULTIPLIER: 3,       // Warmup data = lookback * 3
  MIN_BARS_FOR_STRATEGY: 20,  // Minimum bars needed beyond lookback window
  FS_WATCH_DEBOUNCE_MS: 100   // File system watch debounce time
};

// ────────────────────────────────────────────────
// EXPORT ALL CONSTANTS
// ────────────────────────────────────────────────

module.exports = {
  MODES,
  INTENTS,
  SIDES,
  EVENTS,
  DEFAULT_STRATEGY_CONFIG,
  PAPER_BROKER_DEFAULTS,
  RISK_DEFAULTS,
  PATHS,
  API_RESPONSES,
  LOG_PREFIXES,
  TIME,
  PERFORMANCE
};