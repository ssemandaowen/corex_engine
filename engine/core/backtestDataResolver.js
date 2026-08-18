"use strict";

/**
 * backtestDataResolver.js
 *
 * Guarded fetcher for Twelve Data API.
 * Enforces a hard cap of 5,000 points per request to ensure system stability
 * and respect API provider limits.
 */

const logger = require("@utils/logger").createModuleLogger("BACKTEST_DATA_RESOLVER", {
    category: "backtest",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BARS_LIMIT = 5000;           // Twelve Data single-request limit

/**
 * Validate bar object structure
 */
const isValidBar = (bar) => {
    if (!bar || typeof bar !== "object") return false;
    const { time, open, high, low, close } = bar;
    return (
        Number.isFinite(Number(time)) &&
        Number.isFinite(Number(open)) &&
        Number.isFinite(Number(high)) &&
        Number.isFinite(Number(low)) &&
        Number.isFinite(Number(close))
    );
};

/**
 * Normalize a bar to consistent numeric types
 */
const normalizeBar = (bar) => ({
    time: Number(bar.time),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume || 0),
    ...(bar.symbol && { symbol: bar.symbol }),
    ...(bar.exchange && { exchange: bar.exchange }),
});

/**
 * Guarded fetcher function (formerly Recursive)
 *
 * @param {object} broker - Broker module with fetchHistory(symbol, interval, outputsize)
 * @param {object} options - Fetch options
 * @returns {Promise<Array>} - Normalized bar array
 */
async function fetchGuardedHistory(broker, options = {}) {
    const {
        symbol = "",
        interval = "1m",
        outputsize = 5000,
        onProgress = null
    } = options;

    const emit = (stage, message, pct = null, meta = {}) => {
        if (!onProgress || typeof onProgress !== "function") return;
        try {
            onProgress({
                stage,
                message,
                pct: pct !== null ? Math.max(0, Math.min(100, pct)) : null,
                ...meta
            });
        } catch (err) {
            logger.warn(`Progress callback error: ${err.message}`);
        }
    };

    // ── Input Validation ──────────────────────────────────────────────────────

    if (!broker || typeof broker.fetchHistory !== "function") {
        const err = new Error("BROKER_INVALID: broker module must have fetchHistory method");
        throw err;
    }

    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    const normalizedInterval = String(interval || "").trim().toLowerCase();
    const requestedSize = Math.floor(Number(outputsize) || 5000);

    if (requestedSize > MAX_BARS_LIMIT) {
        const errMsg = `LIMIT_EXCEEDED: Maximum ${MAX_BARS_LIMIT} bars allowed for API fetch. Please reduce range or use CSV upload.`;
        emit("ERROR", errMsg, 100);
        throw new Error(errMsg);
    }

    if (!normalizedSymbol) {
        throw new Error("SYMBOL_REQUIRED");
    }

    if (!normalizedInterval) {
        throw new Error("INTERVAL_REQUIRED");
    }

    logger.info(`Guarded fetch: ${normalizedSymbol} @ ${normalizedInterval} (${requestedSize} bars)`);
    emit("FETCH_START", `Fetching ${requestedSize} bars from Twelve Data...`, 20);

    try {
        const bars = await broker.fetchHistory({
            symbol: normalizedSymbol,
            interval: normalizedInterval,
            outputsize: requestedSize
        });

        if (!Array.isArray(bars)) {
            throw new Error("FETCH_INVALID_RESPONSE: broker returned non-array");
        }

        const validated = bars.filter(isValidBar).map(normalizeBar);
        logger.info(`Guarded fetch successful: ${validated.length} bars received`);
        emit("FETCH_COMPLETE", `Fetched ${validated.length} bars`, 100);

        return validated;
    } catch (err) {
        logger.error(`Guarded fetch failed: ${err.message}`);
        emit("ERROR", `API fetch failed: ${err.message}`, 100);
        throw err;
    }
}

// ─── Module Exports ──────────────────────────────────────────────────────────

module.exports = {
    fetchGuardedHistory,
    MAX_BARS_LIMIT
};
