"use strict";

/**
 * YahooFinanceProvider.js
 *
 * Yahoo Finance market data provider backed by Yahoo's public API.
 * Uses the @yahoo/finance/client library if available, falls back to
 * direct fetch to query1.finance.yahoo.com.
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
const { DataProviderContract, validateProviderImplementation, DataProviderError } = require("../DataProviderContract");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("YAHOO_PROVIDER");

const SUPPORTED_INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk"];
const MAX_BARS = 5000;
const YAHOO_BASE = "https://query1.finance.yahoo.com";

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

class YahooFinanceProvider extends DataProviderContract {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.apiKey]     — optional Yahoo API key
     * @param {Object} [opts.fetchImpl]  — inject fetch (for testing)
     */
    constructor(opts = {}) {
        super();
        this._apiKey = opts.apiKey || process.env.YAHOO_API_KEY || null;
        this._fetch = opts.fetchImpl !== undefined ? opts.fetchImpl : (typeof fetch !== "undefined" ? fetch : null);
        this._connected = false;
        this._lastHeartbeat = null;
        /** Canonical symbol -> Yahoo symbol mapping */
        this._symbolMap = new Map();

        validateProviderImplementation(this);
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
        const range = this._estimateRange(Number(outputsize), interval);

        if (!this._fetch) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: "No fetch implementation available"
            });
        }

        const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${apiInterval}&range=${range}&includePrePost=false`;

        let response;
        try {
            response = await this._fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; CoreX/1.0)"
                }
            });
        } catch (err) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: `Network error: ${err.message}`,
                cause: err
            });
        }

        if (!response.ok) {
            const status = response.status;
            if (status === 404) {
                throw new DataProviderError("SYMBOL_NOT_FOUND", {
                    provider: "yahoo",
                    symbol: canonical,
                    message: `Symbol not found on Yahoo Finance (${yahooSymbol})`
                });
            }
            if (status === 429) {
                throw new DataProviderError("RATE_LIMITED", {
                    provider: "yahoo",
                    symbol: canonical,
                    message: "Rate limit exceeded"
                });
            }
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: `HTTP ${status}: ${response.statusText}`
            });
        }

        let data;
        try {
            data = await response.json();
        } catch (err) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "yahoo",
                symbol: canonical,
                message: "Invalid JSON response"
            });
        }

        const result = data?.chart?.result?.[0];
        if (!result || !result.timestamps) {
            throw new DataProviderError("SYMBOL_NOT_FOUND", {
                provider: "yahoo",
                symbol: canonical,
                message: "No chart data returned"
            });
        }

        const { timestamps, indicators } = result;
        const quotes = indicators?.quote?.[0] || {};
        const volumes = indicators?.quote?.[0]?.volume || [];
        const barCount = Math.min(Number(outputsize) || Infinity, timestamps.length, MAX_BARS);

        const bars = [];
        for (let i = 0; i < barCount; i++) {
            const ts = Number(timestamps[i]) * 1000;
            const open = Number(quotes.open?.[i] || quotes.close?.[i] || 0);
            const high = Number(quotes.high?.[i] || 0);
            const low = Number(quotes.low?.[i] || 0);
            const close = Number(quotes.close?.[i] || 0);

            if (!Number.isFinite(ts) || ts <= 0) continue;

            bars.push({
                time: ts,
                open: Number.isFinite(open) ? open : close,
                high: Number.isFinite(high) ? high : close,
                low: Number.isFinite(low) ? low : close,
                close: Number.isFinite(close) ? close : 0,
                volume: Number(volumes[i] || 0),
                symbol: canonical
            });
        }

        this._lastHeartbeat = Date.now();
        return bars;
    }

    /**
     * Estimate Yahoo "range" parameter from outputsize + interval.
     * Yahoo uses "range" (e.g. "5d", "1mo") rather than explicit bar count.
     */
    _estimateRange(outputsize, interval) {
        const intervalMs = this._intervalToMs(interval);
        const totalMs = outputsize * intervalMs;
        const days = Math.ceil(totalMs / (86400 * 1000));
        if (days <= 1) return "1d";
        if (days <= 7) return "7d";
        if (days <= 30) return "30d";
        if (days <= 60) return "60d";
        if (days <= 90) return "90d";
        if (days <= 180) return "180d";
        if (days <= 365) return "1y";
        if (days <= 730) return "2y";
        if (days <= 1825) return "5y";
        return "max";
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
