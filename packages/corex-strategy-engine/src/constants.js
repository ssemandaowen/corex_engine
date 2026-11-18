"use strict";

const INTENTS = Object.freeze({
    ENTER: "ENTER",
    EXIT: "EXIT",
    NONE: "NONE"
});

const SIDES = Object.freeze({
    LONG: "long",
    SHORT: "short",
    FLAT: "flat"
});

const DEFAULT_STRATEGY_CONFIG = Object.freeze({
    LOOKBACK: 100,
    MAX_DATA_HISTORY: 5000,
    TIMEFRAME: "1m",
    INITIAL_CASH: 100000
});

const PERFORMANCE = Object.freeze({
    SIGNAL_COOLDOWN_MS: 500,
    WARMUP_MULTIPLIER: 3,
    MIN_BARS_FOR_STRATEGY: 20,
    FS_WATCH_DEBOUNCE_MS: 100
});

const TIME = Object.freeze({
    MS: {
        SECOND: 1000,
        MINUTE: 60000,
        HOUR: 3600000,
        DAY: 86400000
    },
    DEFAULT_TIMEFRAMES: ["1m", "5m", "15m", "1h", "4h", "1d"],
    TF_PATTERN: /^(\d+)([smhd])$/
});

module.exports = Object.freeze({
    INTENTS,
    SIDES,
    DEFAULT_STRATEGY_CONFIG,
    PERFORMANCE,
    TIME
});
