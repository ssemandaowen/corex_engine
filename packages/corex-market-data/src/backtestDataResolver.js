"use strict";

/**
 * backtestDataResolver.js
 *
 * Guarded fetcher for market data providers.
 * Enforces a hard cap of 5,000 points per request to ensure system stability
 * and respect API provider limits.
 *
 * Moved from engine/core/backtestDataResolver.js to
 * packages/corex-market-data/src/backtestDataResolver.js.
 *
 * Error unification (decision #5): all thrown errors are now DataProviderError
 * instances with typed codes. The generic Error("LIMIT_EXCEEDED") is retired
 * in favor of DataProviderError("MAX_CANDLES_EXCEEDED").
 */

const logger = require("@utils/logger").createModuleLogger("BACKTEST_DATA_RESOLVER", {
    category: "backtest",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});
const { DataProviderError } = require("./DataProviderContract");

const MAX_BARS_LIMIT = 5000;

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

    if (!broker || typeof broker.fetchHistory !== "function") {
        throw new DataProviderError("PROVIDER_UNAVAILABLE", {
            provider: "unknown",
            message: "broker module must have fetchHistory method"
        });
    }

    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    const normalizedInterval = String(interval || "").trim().toLowerCase();
    const requestedSize = Math.floor(Number(outputsize) || 5000);

    if (requestedSize > MAX_BARS_LIMIT) {
        const errMsg = `Maximum ${MAX_BARS_LIMIT} bars allowed for API fetch. Please reduce range or use CSV upload.`;
        emit("ERROR", errMsg, 100);
        throw new DataProviderError("MAX_CANDLES_EXCEEDED", {
            provider: broker?.constructor?.name || "unknown",
            symbol: normalizedSymbol,
            message: errMsg
        });
    }

    if (!normalizedSymbol) {
        throw new DataProviderError("SYMBOL_NOT_FOUND", {
            provider: "unknown",
            message: "No symbol specified for historical fetch"
        });
    }

    if (!normalizedInterval) {
        throw new DataProviderError("INVALID_INTERVAL", {
            provider: "unknown",
            message: "No interval specified for historical fetch"
        });
    }

    logger.info(`Guarded fetch: ${normalizedSymbol} @ ${normalizedInterval} (${requestedSize} bars)`);
    emit("FETCH_START", `Fetching ${requestedSize} bars...`, 20);

    try {
        const bars = await broker.fetchHistory({
            symbol: normalizedSymbol,
            interval: normalizedInterval,
            outputsize: requestedSize
        });

        if (!Array.isArray(bars)) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: broker?.constructor?.name || "unknown",
                symbol: normalizedSymbol,
                message: "broker returned non-array response"
            });
        }

        const validated = bars.filter(isValidBar).map(normalizeBar);
        logger.info(`Guarded fetch successful: ${validated.length} bars received`);
        emit("FETCH_COMPLETE", `Fetched ${validated.length} bars`, 100);

        return validated;
    } catch (err) {
        if (err instanceof DataProviderError) throw err;
        logger.error(`Guarded fetch failed: ${err.message}`);
        emit("ERROR", `API fetch failed: ${err.message}`, 100);
        throw new DataProviderError("PROVIDER_UNAVAILABLE", {
            provider: broker?.constructor?.name || "unknown",
            symbol: normalizedSymbol,
            message: err.message,
            cause: err
        });
    }
}

module.exports = {
    fetchGuardedHistory,
    MAX_BARS_LIMIT
};
