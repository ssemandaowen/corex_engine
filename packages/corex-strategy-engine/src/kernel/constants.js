"use strict";

/**
 * Kernel constants — mirror of @config/constants values used on the hot path.
 * Copied verbatim; do not invent new values here.
 */

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

const TIME = {
    MS: {
        SECOND: 1000,
        MINUTE: 60000,
        HOUR: 3600000,
        DAY: 86400000
    },
    TF_PATTERN: /^(\d+)([smhd])$/
};

const LIMITS = {
    LOOKBACK: 100,
    MAX_DATA_HISTORY: 5000,
    BACKTEST_MAX_CANDLES: 5000
};

module.exports = Object.freeze({
    INTENTS,
    SIDES,
    TIME,
    LIMITS
});
