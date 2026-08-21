"use strict";

/**
 * TwelveDataProvider.js
 *
 * Adapter that wraps the existing `broker/twelvedata.js` singleton behind
 * the DataProviderContract. Moves from engine/core/data/providers/ to
 * packages/corex-market-data/src/providers/.
 *
 * DESIGN NOTES
 * ────────────
 * - Thin adapter: delegates transport/reconnection/fallback logic to the
 *   singleton. Does NOT reimplement those.
 * - Symbol normalization at provider boundary (spec #4 / decision #3):
 *   every symbol passed to subscribe/fetchHistory is canonicalized via
 *   SymbolNormalizer before reaching the upstream. Tick emission is
 *   normalized by wrapping the singleton's _normalize and
 *   fetchLatestPrice tick constructors, so emitted EVENTS.MARKET.TICK
 *   always carries a canonical symbol.
 * - Behavior-preserving: adapter output is identical to calling
 *   twelvedata.js directly, except symbols are canonicalized first.
 */

const twelvedata = require("@broker/twelvedata");
const SymbolNormalizer = require("../../../corex-broker-contract/src/utils/SymbolNormalizer");
const {
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError
} = require("../DataProviderContract");

const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const MAX_BARS = 5000;

class TwelveDataProvider extends DataProviderContract {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.apiKey]           — overrides the singleton's key for this instance
     * @param {Object} [opts.broker]           — injects a different broker (for testing)
     */
    constructor(opts = {}) {
        super();
        this._broker = opts.broker || twelvedata;
        this._apiKey = opts.apiKey != null ? String(opts.apiKey)
            : (process.env.TWELVE_DATA_KEY || process.env.TWELVE_DATA_API_KEY || null);
        this._lastHeartbeat = null;

        this._wrapTickNormalization();

        validateProviderImplementation(this);
    }

    /**
     * Wrap the singleton's _normalize and fetchLatestPrice so that every
     * tick emitted on the bus carries a canonical symbol.
     * Idempotent — safe if the singleton is shared across multiple adapters.
     */
    _wrapTickNormalization() {
        if (!this._broker || this._broker.__symbolNormalized) return;

        if (typeof this._broker._normalize === "function") {
            const originalNormalize = this._broker._normalize.bind(this._broker);
            this._broker._normalize = (data, symbolOverride = null) => {
                const tick = originalNormalize(data, symbolOverride);
                if (tick && tick.symbol) {
                    const { symbol } = SymbolNormalizer.normalize(tick.symbol);
                    tick.symbol = symbol;
                }
                return tick;
            };
        }

        if (typeof this._broker.fetchLatestPrice === "function") {
            const originalFetchLatest = this._broker.fetchLatestPrice.bind(this._broker);
            this._broker.fetchLatestPrice = async (symbol) => {
                const tick = await originalFetchLatest(symbol);
                if (tick && tick.symbol) {
                    const { symbol: normalized } = SymbolNormalizer.normalize(tick.symbol);
                    tick.symbol = normalized;
                }
                return tick;
            };
        }

        this._broker.__symbolNormalized = true;
    }

    /**
     * connect()
     * Delegates to the singleton's connect(). If a runtime API key was
     * supplied via constructor opts, it is applied first via
     * applyRuntimeConfig().
     */
    async connect() {
        if (this._apiKey) {
            try { this._broker.applyRuntimeConfig({ apiKey: this._apiKey }); } catch { /* no-op */ }
        }
        return this._broker.connect();
    }

    /**
     * subscribe(symbols)
     * Delegates to the singleton's subscribe(). Symbols are normalized to
     * canonical format at the provider boundary before reaching upstream.
     */
    async subscribe(symbols) {
        const arr = Array.isArray(symbols) ? symbols : [];
        const normalized = arr.map((s) => SymbolNormalizer.normalize(s).symbol).filter(Boolean);
        return this._broker.subscribe(normalized);
    }

    /**
     * unsubscribe(symbols)
     *
     * TwelveData's broker exposes updateSymbols() (set replacement) but no
     * direct unsubscribe(). Implemented via set-difference on the current
     * symbol set, normalized at the boundary.
     */
    async unsubscribe(symbols) {
        const toRemove = new Set(
            (Array.isArray(symbols) ? symbols : []).map((s) => SymbolNormalizer.normalize(s).symbol).filter(Boolean)
        );
        if (toRemove.size === 0) return;

        const current = this._broker.getStatus().symbols || [];
        const remaining = current.filter((s) => !toRemove.has(SymbolNormalizer.normalize(s).symbol));
        this._broker.updateSymbols(remaining);
    }

    /**
     * fetchHistory({ symbol, interval, outputsize })
     * Normalizes the symbol at the boundary, then delegates to the singleton.
     */
    async fetchHistory({ symbol, interval, outputsize }) {
        const { symbol: normalized } = SymbolNormalizer.normalize(symbol);
        return this._broker.fetchHistory({ symbol: normalized, interval, outputsize });
    }

    /**
     * getCapabilities()
     *
     * @returns {{ maxBars: number, supportedIntervals: string[], streaming: boolean }}
     */
    getCapabilities() {
        return {
            maxBars: MAX_BARS,
            supportedIntervals: [...SUPPORTED_INTERVALS],
            streaming: true
        };
    }

    /**
     * getStatus()
     * Delegates to the singleton's getStatus() and augments with the
     * contract-required `authorized` and `lastHeartbeat` fields.
     */
    getStatus() {
        const base = typeof this._broker.getStatus === "function"
            ? this._broker.getStatus()
            : {};
        const apiKey = this._apiKey || this._broker?.config?.apiKey;
        return {
            connected: !!base.connected,
            authorized: !!apiKey,
            lastHeartbeat: this._lastHeartbeat,
            ...base
        };
    }

    /**
     * cleanup()
     * Delegates to the singleton's cleanup().
     */
    async cleanup() {
        return this._broker.cleanup();
    }
}

function create(opts = {}) {
    return new TwelveDataProvider(opts);
}

module.exports = {
    TwelveDataProvider,
    create,
    MAX_BARS,
    SUPPORTED_INTERVALS,
    CODES: DataProviderError.CODES
};
