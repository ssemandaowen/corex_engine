"use strict";

/**
 * DataProviderFactory.js
 *
 * Central registry + dispatch for market data providers.
 * - Single active provider at a time (locked constraint #3)
 * - Idempotent connect() (decision #1)
 * - Transparent pagination via DataPaginationLayer (decision #2)
 *
 * Usage in integration points:
 *   const factory = require("@data/DataProviderFactory");
 *   const provider = factory.getActive();           // for subscribe/unsubscribe/status
 *   const bars   = factory.fetchHistorical({...});  // for historical fetches with pagination
 */

const DataPaginationLayer = require("../../corex-broker-contract/src/utils/DataPaginationLayer");
const { DataProviderError } = require("./DataProviderContract");
const logger = require("@utils/logger");

const MAX_BARS_LIMIT = 5000;

const log = logger.createModuleLogger("DATA_FACTORY");

class DataProviderFactory {
    constructor() {
        this._providers = new Map();
        this._active = null;
        this._activeName = null;
        this._connectPromise = null;
        this._connectStarted = false;
        this._destroyed = false;
    }

    /**
     * Register a data provider by name.
     * @param {string} name
     * @param {DataProviderContract|Function} provider — instance or factory fn
     */
    register(name, provider) {
        if (!name) throw new DataProviderError("PROVIDER_UNAVAILABLE", { message: "Provider name required" });
        this._providers.set(name, provider);
        if (this._activeName === name && !this._active) {
            this._resolveActive();
        }
        log.debug(`Provider '${name}' registered`);
    }

    /**
     * Set the active data provider (single active provider constraint).
     * Triggers idempotent connect().
     * @param {string} name
     */
    setActive(name) {
        if (!this._providers.has(name)) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                message: `Provider '${name}' is not registered`
            });
        }
        this._activeName = name;
        this._active = null;
        this._resolveActive();
        this._connectSafe();
        log.info(`Active data provider set to '${name}'`);
    }

    _resolveActive() {
        if (!this._activeName || !this._providers.has(this._activeName)) return;
        const entry = this._providers.get(this._activeName);
        if (typeof entry === "function") {
            this._active = entry();
        } else {
            this._active = entry;
        }
    }

    /**
     * Idempotent connect — safe to call multiple times, even across
     * mode switches (backtest → paper → live).
     */
    _connectSafe() {
        if (!this._active) return;
        if (this._connectStarted) return;
        if (this._destroyed) return;
        this._connectStarted = true;
        const p = Promise.resolve().then(() => {
            if (this._destroyed) return;
            return this._active.connect();
        });
        this._connectPromise = p.finally(() => { this._connectStarted = false; });
    }

    /**
     * Public connect — idempotent. Safe to call during mode switches.
     */
    async connect() {
        if (!this._active) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                message: "No active provider set"
            });
        }
        if (this._destroyed) return;
        if (this._connectPromise) return this._connectPromise;
        this._connectStarted = true;
        this._connectPromise = Promise.resolve()
            .then(() => {
                if (this._destroyed) return;
                return this._active.connect();
            })
            .finally(() => {
                this._connectStarted = false;
                this._connectPromise = null;
            });
        return this._connectPromise;
    }

    /** @returns {DataProviderContract|null} the active provider instance */
    getActive() {
        return this._active;
    }

    /** @returns {string|null} the active provider name */
    getActiveName() {
        return this._activeName;
    }

    /**
     * Fetch historical bars with transparent pagination.
     *
     * Decision #2: By default (max_candles not provided), wraps
     * DataPaginationLayer.fetchall for transparent chunking to honor
     * the 5000-candle global backtest cap. When `max_candles` is provided,
     * bypasses the chunking loop and issues a single request capped at
     * min(max_candles, MAX_BARS_LIMIT) — used by warmup fetches that want
     * a small/fast single-shot request.
     *
     * @param {Object} opts
     * @param {string} opts.symbol
     * @param {string} [opts.interval]   default "1m"
     * @param {number} [opts.outputsize]  default 5000 (ignored when max_candles is given)
     * @param {number} [opts.max_candles]  when provided, bypasses pagination
     * @returns {Promise<Array<Bar>>}
     * @throws {DataProviderError} with code MAX_CANDLES_EXCEEDED if outputsize > 5000 and no max_candles
     */
    async fetchHistorical({ symbol, interval = "1m", outputsize = 5000, max_candles = null }) {
        const provider = this._active;
        if (!provider) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                message: "No active data provider"
            });
        }

        // Decision #2: max_candles bypass — single-shot request
        if (max_candles != null) {
            const cap = Math.min(Number(max_candles) || 0, MAX_BARS_LIMIT);
            if (cap <= 0) {
                throw new DataProviderError("MAX_CANDLES_EXCEEDED", {
                    provider: this._activeName,
                    symbol,
                    message: "max_candles must be a positive number"
                });
            }
            const bars = await provider.fetchHistory({ symbol, interval, outputsize: cap });
            if (!Array.isArray(bars)) throw new DataProviderError("PROVIDER_UNAVAILABLE", { provider: this._activeName, symbol, message: "Non-array response" });
            return bars;
        }

        // Default: transparent pagination via DataPaginationLayer
        const total = Number(outputsize) || MAX_BARS_LIMIT;
        if (total > MAX_BARS_LIMIT) {
            throw new DataProviderError("MAX_CANDLES_EXCEEDED", {
                provider: this._activeName,
                symbol,
                message: `Requested ${total} bars exceeds global cap of ${MAX_BARS_LIMIT}`
            });
        }
        const cappedTotal = Math.min(total, MAX_BARS_LIMIT);

        const caps = provider.getCapabilities
            ? provider.getCapabilities()
            : { maxBars: MAX_BARS_LIMIT, streaming: false };
        const providerMax = caps.maxBars || MAX_BARS_LIMIT;

        // If the request fits in a single provider request, skip pagination
        if (cappedTotal <= providerMax) {
            const bars = await provider.fetchHistory({ symbol, interval, outputsize: cappedTotal });
            if (!Array.isArray(bars)) throw new DataProviderError("PROVIDER_UNAVAILABLE", { provider: this._activeName, symbol, message: "Non-array response" });
            return bars;
        }

        // Chunk via DataPaginationLayer
        const layer = new DataPaginationLayer({ provider: this._activeName || "twelvedata" });
        layer._providerFetch = async (sym, opts) => {
            const limit = Math.min(opts.limit || providerMax, providerMax);
            const bars = await provider.fetchHistory({ symbol: sym, interval: opts.interval, outputsize: limit });
            if (!Array.isArray(bars)) return [];
            return bars;
        };
        const allData = await layer.fetchAll(symbol, { limit: cappedTotal, interval });

        // Deduplicate by timestamp, sort ascending
        const seen = new Set();
        const unique = [];
        for (const bar of allData) {
            const key = typeof bar.time === "number" ? bar.time : Number(bar.time);
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(bar);
            }
        }
        unique.sort((a, b) => Number(a.time) - Number(b.time));
        return unique.slice(0, cappedTotal);
    }

    /**
     * Backwards-compatible alias: some integration points call
     * fetchHistory() directly on a provider. The factory provides this
     * so callers don't need to know about pagination.
     */
    async fetchHistory(opts) {
        return this.fetchHistorical(opts);
    }

    /**
     * Route symbol subscription through the active provider.
     */
    async subscribe(symbols) {
        if (!this._active) return;
        return this._active.subscribe(symbols);
    }

    /**
     * Route symbol unsubscription through the active provider.
     */
    async unsubscribe(symbols) {
        if (!this._active) return;
        return this._active.unsubscribe(symbols);
    }

    /**
     * Get status from the active provider.
     */
    getStatus() {
        if (!this._active || typeof this._active.getStatus !== "function") {
            return { connected: false, authorized: false, lastHeartbeat: null };
        }
        return this._active.getStatus();
    }

    /**
     * Get capabilities from the active provider.
     */
    getCapabilities() {
        if (!this._active || typeof this._active.getCapabilities !== "function") {
            return { maxBars: MAX_BARS_LIMIT, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], streaming: false };
        }
        return this._active.getCapabilities();
    }

    /**
     * Cleanup the active provider.
     */
    async cleanup() {
        this._destroyed = true;
        // Wait for any pending connect to settle so it doesn't override cleanup
        if (this._connectPromise) {
            try { await this._connectPromise; } catch { }
        }
        if (this._active && typeof this._active.cleanup === "function") {
            await this._active.cleanup();
        }
        this._active = null;
        this._activeName = null;
        this._connectPromise = null;
        this._connectStarted = false;
    }
}

const factory = new DataProviderFactory();

module.exports = factory;
module.exports.DataProviderFactory = DataProviderFactory;
module.exports.MAX_BARS_LIMIT = MAX_BARS_LIMIT;
