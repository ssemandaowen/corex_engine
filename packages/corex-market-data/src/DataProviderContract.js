"use strict";

/**
 * DataProviderContract.js
 *
 * Defines the strict interface that all market data provider implementations
 * must conform to. This file establishes the contract only — no implementation logic.
 *
 * The validation style mirrors broker/base/BrokerContract.js + BaseBroker.js:
 *   - Methods are declared on the contract class (they throw "must be implemented").
 *   - validateProviderImplementation() fail-fast checks that a concrete instance
 *     provides every required method and that the method has been overridden
 *     (i.e. it is not still the contract's own prototype method).
 *
 * Required methods:
 *   connect()                              — establish upstream connection / init state
 *   subscribe(symbols : string[])          — begin streaming ticks for `symbols`
 *   unsubscribe(symbols : string[])       — stop streaming ticks for `symbols`
 *   fetchHistory({ symbol, interval, outputsize }) -> Promise<Array<Bar>>
 *   getCapabilities() -> { maxBars, supportedIntervals, streaming }
 *   getStatus()       -> { connected, authorized, lastHeartbeat }
 *   cleanup()          — release all resources, close connections, clear timers
 *
 * RUNTIME CONTRACT (not structurally validated):
 *   Providers are expected to emit individual ticks on the existing event bus
 *   via EVENTS.MARKET.TICK (see events/bus.js / config/constants.js).
 *   A tick payload shape is: { symbol: string, time: number, price: number,
 *                             bid?: number, ask?: number, volume?: number }
 *   The MarketFeed service (src/MarketFeed.js) listens for
 *   this event and dispatches to active runtimes — the provider does NOT
 *   interact with MarketFeed directly.
 *
 * Every provider must normalize symbols to canonical format
 * (uppercase, no separators, e.g. EURUSD) at its own boundary,
 * before emitting ticks. Uses SymbolNormalizer from corex-broker-contract.
 */

/**
 * Standard Bar (OHLCV) Shape
 *
 * @typedef {Object} Bar
 * @property {number} time   — Timestamp in milliseconds (epoch ms)
 * @property {number} open   — Opening price
 * @property {number} high   — Highest price
 * @property {number} low    — Lowest price
 * @property {number} close  — Closing price
 * @property {number} volume — Trade volume (0 if unavailable)
 * @property {string} [symbol] — Instrument ticker (canonical, uppercase, no separators)
 */

/**
 * Capabilities return shape
 *
 * @typedef {Object} Capabilities
 * @property {number} maxBars              — Hard cap on bars per fetchHistory request
 * @property {string[]} supportedIntervals — e.g. ["1m", "5m", "15m", "1h", "4h", "1d"]
 * @property {boolean} streaming           — Whether real-time tick streaming is available
 */

/**
 * Status return shape
 *
 * @typedef {Object} ProviderStatus
 * @property {boolean} connected         — Whether the upstream connection is active
 * @property {boolean} authorized        — Whether the provider API key is valid
 * @property {number|null} lastHeartbeat  — Epoch ms of last successful upstream contact
 */

class DataProviderContract {
    /**
     * connect()
     *
     * Establish the upstream connection, authenticate, and prepare the provider
     * to accept subscribe / fetchHistory calls.
     *
     * @returns {Promise<void>}
     * @throws {DataProviderError} with code PROVIDER_UNAVAILABLE on failure
     */
    async connect() {
        throw new Error("connect() must be implemented by subclass");
    }

    /**
     * subscribe(symbols)
     *
     * Begin streaming real-time ticks for the given symbols.
     *
     * @param {string[]} symbols — Upper-case ticker symbols, e.g. ["AAPL", "EURUSD"]
     * @returns {Promise<void>}
     * @throws {DataProviderError} with code SYMBOL_NOT_FOUND or PROVIDER_UNAVAILABLE
     */
    async subscribe(symbols) {
        throw new Error("subscribe() must be implemented by subclass");
    }

    /**
     * unsubscribe(symbols)
     *
     * Stop streaming ticks for the given symbols.
     *
     * @param {string[]} symbols — Upper-case ticker symbols
     * @returns {Promise<void>}
     */
    async unsubscribe(symbols) {
        throw new Error("unsubscribe() must be implemented by subclass");
    }

    /**
     * fetchHistory({ symbol, interval, outputsize })
     *
     * Fetch historical OHLCV bars from the provider's REST endpoint.
     * Symbol is already canonical (normalized at boundary).
     *
     * @param {Object} opts
     * @param {string} opts.symbol      — Canonical ticker symbol
     * @param {string} opts.interval    — E.g. "1m", "5m", "1h", "1d"
     * @param {number} opts.outputsize  — Number of bars to retrieve
     * @returns {Promise<Array<Bar>>} Array of normalized bar objects
     * @throws {DataProviderError} with code SYMBOL_NOT_FOUND, INVALID_INTERVAL,
     *                                 MAX_CANDLES_EXCEEDED, RATE_LIMITED, or PROVIDER_UNAVAILABLE
     */
    async fetchHistory({ symbol, interval, outputsize }) {
        throw new Error("fetchHistory() must be implemented by subclass");
    }

    /**
     * getCapabilities()
     *
     * Return static provider metadata so callers can negotiate capabilities
     * before subscribing or fetching.
     *
     * @returns {Capabilities} { maxBars, supportedIntervals, streaming }
     */
    getCapabilities() {
        throw new Error("getCapabilities() must be implemented by subclass");
    }

    /**
     * getStatus()
     *
     * Return the current connection / authorization state.
     *
     * @returns {ProviderStatus} { connected, authorized, lastHeartbeat }
     */
    getStatus() {
        throw new Error("getStatus() must be implemented by subclass");
    }

    /**
     * cleanup()
     *
     * Full teardown. Close WebSocket/HTTP connections, clear timers,
     * and remove event listeners. After cleanup(), the instance should
     * not be used again without re-calling connect().
     *
     * @returns {Promise<void>}
     */
    async cleanup() {
        throw new Error("cleanup() must be implemented by subclass");
    }
}

/**
 * Validate that a provider instance satisfies the DataProviderContract.
 *
 * Checks that every required method:
 *   1. Is a function on the instance (or its prototype chain).
 *   2. Has been overridden relative to DataProviderContract.prototype
 *      (i.e. it is not just the abstract stub that throws).
 *
 * This mirrors the fail-fast validation in BaseBroker._validateContractImplementation().
 *
 * @param {DataProviderContract} instance — A concrete provider instance
 * @throws {Error} if any required method is missing or not overridden
 */
function validateProviderImplementation(instance) {
    if (!instance || typeof instance !== "object") {
        throw new Error("[DataProviderContract] validateProviderImplementation: instance must be an object.");
    }

    const requiredMethods = [
        "connect",
        "subscribe",
        "unsubscribe",
        "fetchHistory",
        "getCapabilities",
        "getStatus",
        "cleanup"
    ];

    for (const method of requiredMethods) {
        if (
            typeof instance[method] !== "function" ||
            instance[method] === DataProviderContract.prototype[method]
        ) {
            throw new Error(
                `[DataProviderContract] Contract violation: ` +
                `method '${method}()' must be implemented by the provider subclass. ` +
                "See DataProviderContract for the required interface."
            );
        }
    }
}

/**
 * DataProviderError — typed error for provider-specific failures.
 *
 * Constructor signature (documented):
 *   new DataProviderError(code, { provider, symbol, message, cause })
 *
 * @example
 *   throw new DataProviderError("SYMBOL_NOT_FOUND", { provider: "twelvedata", symbol: "FAKE", message: "..." });
 *
 * The `code` drives error-handling decisions in higher-level code
 * (e.g. retry vs. skip vs. fail). See CODES below for the allowed set.
 */
class DataProviderError extends Error {
    /**
     * @param {string} code       — One of DataProviderError.CODES
     * @param {Object} opts
     * @param {string} opts.provider  — Provider name / identifier
     * @param {string} [opts.symbol]  — Ticker symbol (when applicable)
     * @param {string} [opts.message] — Human-readable detail
     * @param {Error}  [opts.cause]   — Original error (if wrapping)
     */
    constructor(code, { provider, symbol, message, cause } = {}) {
        const detail = message || `${code}${provider ? ` [${provider}]` : ""}${symbol ? ` (${symbol})` : ""}`;
        super(detail);

        this.name = "DataProviderError";
        this.code = code;
        this.provider = provider || null;
        this.symbol = symbol || null;

        if (cause) {
            this.cause = cause;
        }
    }
}

/**
 * Allowed error codes.
 * MAX_CANDLES_EXCEEDED retires the generic Error("LIMIT_EXCEEDED") thrown
 * by backtestDataResolver.js.
 */
DataProviderError.CODES = {
    SYMBOL_NOT_FOUND: "SYMBOL_NOT_FOUND",
    RATE_LIMITED: "RATE_LIMITED",
    AUTH_FAILED: "AUTH_FAILED",
    PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
    INVALID_INTERVAL: "INVALID_INTERVAL",
    MAX_CANDLES_EXCEEDED: "MAX_CANDLES_EXCEEDED"
};

const DATA_PROVIDER_CONTRACT_VERSION = "2026.1.21";

/**
 * Minimal stub implementation — proves the contract is satisfiable.
 * Not a real provider. Exists so acceptance tests can verify
 * validateProviderImplementation() accepts a complete implementation.
 */
class StubDataProvider extends DataProviderContract {
    async connect() { /* no-op */ }
    async subscribe(symbols) { /* no-op */ }
    async unsubscribe(symbols) { /* no-op */ }
    async fetchHistory({ symbol, interval, outputsize }) { return []; }
    getCapabilities() {
        return { maxBars: 5000, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], streaming: false };
    }
    getStatus() {
        return { connected: true, authorized: true, lastHeartbeat: Date.now() };
    }
    async cleanup() { /* no-op */ }
}

/**
 * Incomplete stub — missing getCapabilities(). Used to verify the validator
 * rejects partial implementations.
 */
class IncompleteDataProvider extends DataProviderContract {
    async connect() { /* no-op */ }
    async subscribe() { /* no-op */ }
    async unsubscribe() { /* no-op */ }
    async fetchHistory() { return []; }
    // getCapabilities() intentionally omitted
    getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
    async cleanup() { /* no-op */ }
}

module.exports = {
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError,
    DATA_PROVIDER_CONTRACT_VERSION,
    __example__: { StubDataProvider, IncompleteDataProvider }
};
