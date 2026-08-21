"use strict";

/**
 * YahooFinanceProvider.js
 *
 * Yahoo Finance market data provider backed by the official
 * `yahoo-finance2` npm package (v4.x).
 *
 * Symbol normalization at provider boundary (spec #4 / decision #3):
 *   Yahoo symbols like "BRK.B", "VOW.DE" are normalized to canonical
 *   format (e.g. "BERKB", "VOWDE") before being used to emit ticks.
 *   Note: Yahoo symbol formats are lossy on normalization (BRK.B → BERKB),
 *   so the provider keeps an internal map from canonical → Yahoo symbol
 *   for API requests.
 *
 * Human verification required: requires real Yahoo Finance API access
 * to verify end-to-end against live data (per AGENTS.md §Human verification).
 */

const SymbolNormalizer = require("../../../corex-broker-contract/src/utils/SymbolNormalizer");
const {
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError
} = require("../DataProviderContract");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("YAHOO_PROVIDER");

const SUPPORTED_INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk"];
const MAX_BARS = 5000;

const INTERVAL_MAP = {
    "1m": "1m",
    "2m": "2m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "60m",
    "1d": "1d",
    "1wk": "1wk"
};

const RANGE_MAP = {
    "1d": "1d",
    "5d": "5d",
    "1mo": "1mo",
    "3mo": "3mo",
    "6mo": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "max": "max"
};

class YahooFinanceProvider extends DataProviderContract {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.apiKey]  — optional Yahoo API key (falls back to process.env.YAHOO_API_KEY)
     * @param {Object} [opts.yahooImpl] — inject a yahoo-finance2 instance (for testing)
     */
    constructor(opts = {}) {
        super();
        this._apiKey = opts.apiKey || process.env.YAHOO_API_KEY || null;
        this._yahooImpl = opts.yahooImpl || null;
        this._connected = false;
        this._lastHeartbeat = null;
        /** Canonical symbol -> Yahoo symbol mapping */
        this._symbolMap = new Map();

        validateProviderImplementation(this);
    }

    /**
     * Lazily create the yahoo-finance2 instance on first connect.
     * This allows the test injector (yahooImpl) to bypass construction.
     */
    _getYahoo() {
        if (this._yahooImpl) return this._yahooImpl;
        const YahooFinance = require("yahoo-finance2").default;
        const opts = {};
        if (this._apiKey) {
            opts.fetchOptions = { headers: { "User-Agent": "Mozilla/5.0 (compatible; CoreX/1.0)" } };
        }
        this._yahooImpl = new YahooFinance(opts);
        return this._yahooImpl;
    }

    /**
     * Map a CoreX canonical symbol back to Yahoo's format.
     * Since normalization is lossy (strips separators), we rely on
     * a best-effort reverse mapping stored on first use.
     */
    _yahooSymbol(canonicalSymbol) {
        const yahooSymbol = this._symbolMap.get(canonicalSymbol);
        if (yahooSymbol) return yahooSymbol;
        return canonicalSymbol;
    }

    async connect() {
        this._connected = true;
        this._lastHeartbeat = Date.now();
        return;
    }

    async subscribe(symbols) {
        const arr = Array.isArray(symbols) ? symbols : [];
        for (const sym of arr) {
            const normalized = SymbolNormalizer.normalize(sym);
            this._symbolMap.set(normalized.symbol, sym);
        }
        return;
    }

    async unsubscribe(symbols) {
        const arr = Array.isArray(symbols) ? symbols : [];
        for (const sym of arr) {
            const normalized = SymbolNormalizer.normalize(sym);
            this._symbolMap.delete(normalized.symbol);
        }
        return;
    }

    async fetchHistory({ symbol, interval, outputsize }) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol);
        const yahooSymbol = this._yahooSymbol(canonical);
        const apiInterval = INTERVAL_MAP[interval] || interval;
        const range = this._estimateRange(Number(outputsize) || MAX_BARS, interval);

        let yahoo;
        try {
            yahoo = this._getYahoo();
        } catch (err) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: "yahoo-finance2 not installed",
                cause: err
            });
        }

        const queryOpts = {
            symbol: yahooSymbol,
            interval: apiInterval,
            range: range,
            includePrePost: false
        };

        let result;
        try {
            result = await yahoo.chart(queryOpts);
        } catch (err) {
            const status = err?.result?.response?.status || err?.statusCode;
            if (status === 404) {
                throw new DataProviderError("SYMBOL_NOT_FOUND", {
                    provider: "yahoo",
                    symbol: canonical,
                    message: `Symbol not found on Yahoo Finance (${yahooSymbol})`
                });
            }
            if (status === 429 || /rate.?limit/i.test(err?.message || "")) {
                throw new DataProviderError("RATE_LIMITED", {
                    provider: "yahoo",
                    symbol: canonical,
                    message: "Rate limit exceeded"
                });
            }
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: err?.message || "Unknown Yahoo Finance error",
                cause: err
            });
        }

        const { timestamps, quotes } = result;
        if (!timestamps || !quotes || !quotes.length) {
            throw new DataProviderError("SYMBOL_NOT_FOUND", {
                provider: "yahoo",
                symbol: canonical,
                message: "No chart data returned"
            });
        }

        const barCount = Math.min(Number(outputsize) || Infinity, timestamps.length, MAX_BARS);

        const bars = [];
        for (let i = 0; i < barCount; i++) {
            const ts = Number(timestamps[i]) * 1000;
            const quote = quotes[i] || {};
            const open = Number(quote.open || quote.close || 0);
            const high = Number(quote.high || 0);
            const low = Number(quote.low || 0);
            const close = Number(quote.close || 0);

            if (!Number.isFinite(ts) || ts <= 0) continue;

            bars.push({
                time: ts,
                open: Number.isFinite(open) ? open : close,
                high: Number.isFinite(high) ? high : close,
                low: Number.isFinite(low) ? low : close,
                close: Number.isFinite(close) ? close : 0,
                volume: Number(quote.volume || 0),
                symbol: canonical
            });
        }

        this._lastHeartbeat = Date.now();
        return bars;
    }

    /**
     * Estimate Yahoo "range" parameter from outputsize + interval.
     * Yahoo uses range (e.g. "5d", "1mo") rather than explicit bar count.
     * Falls back to chart module's outputsize for intraday ranges.
     */
    _estimateRange(outputsize, interval) {
        const intervalMs = this._intervalToMs(interval);
        const totalMs = outputsize * intervalMs;
        const days = Math.ceil(totalMs / (86400 * 1000));
        if (days <= 1) return RANGE_MAP["1d"];
        if (days <= 5) return RANGE_MAP["5d"];
        if (days <= 30) return RANGE_MAP["1mo"];
        if (days <= 90) return RANGE_MAP["3mo"];
        if (days <= 180) return RANGE_MAP["6mo"];
        if (days <= 365) return RANGE_MAP["1y"];
        if (days <= 730) return RANGE_MAP["2y"];
        if (days <= 1825) return RANGE_MAP["5y"];
        return RANGE_MAP["max"];
    }

    _intervalToMs(interval) {
        const m = /(\d+)([smhd])/.exec(String(interval || ""));
        if (!m) return 60000;
        const n = Number(m[1]);
        const unit = m[2];
        const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        return n * (multipliers[unit] || 60000);
    }

    getCapabilities() {
        return {
            maxBars: MAX_BARS,
            supportedIntervals: [...SUPPORTED_INTERVALS],
            streaming: false
        };
    }

    getStatus() {
        return {
            connected: this._connected,
            authorized: !!this._apiKey,
            lastHeartbeat: this._lastHeartbeat
        };
    }

    async cleanup() {
        this._connected = false;
        this._symbolMap.clear();
        this._lastHeartbeat = null;
        if (this._yahooImpl && typeof this._yahooImpl.cleanup === "function") {
            try { this._yahooImpl.cleanup(); } catch { /* no-op */ }
        }
    }
}

function create(opts = {}) {
    return new YahooFinanceProvider(opts);
}

module.exports = {
    YahooFinanceProvider,
    create,
    MAX_BARS,
    SUPPORTED_INTERVALS
};
