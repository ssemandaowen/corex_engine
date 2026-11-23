"use strict";

/**
 * TwelveDataProvider.js
 *
 * Adapter that wraps the package-internal legacy TwelveData singleton
 * (`src/legacy/twelvedata.js`) behind the DataProviderContract. Moves from
 * engine/core/data/providers/ to packages/corex-market-data/src/providers/.
 *
 * DESIGN NOTES
 * ────────────
 * - Thin adapter: delegates transport/reconnection/fallback logic to the
 *   singleton. Does NOT reimplement those.
 * - Canonical symbols stay internal; the adapter formats them for Twelve Data
 *   (EURUSD → EUR/USD) on every outbound path (REST history, WS subscribe,
 *   WS unsubscribe, REST price polling). Inbound ticks and returned bars are
 *   normalized back to the canonical identity.
 * - Behavior-preserving otherwise: adapter output is identical to calling
 *   twelvedata.js directly, except symbols are translated at the boundary.
 */

const twelvedata = require("../legacy/twelvedata");
const { SymbolNormalizer } = require("corex-broker-contract");
const {
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError
} = require("../DataProviderContract");
const { toProviderSymbol: formatTwelveDataSymbol } = require("./twelvedata/symbolFormat");

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
                const canonical = SymbolNormalizer.normalize(symbol).symbol;
                const tick = await originalFetchLatest(this.toProviderSymbol(canonical));
                if (tick) tick.symbol = canonical || SymbolNormalizer.normalize(tick.symbol).symbol;
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
     * toProviderSymbol(symbol, opts)
     *
     * Canonical CoreX symbol → Twelve Data wire symbol (EURUSD → EUR/USD).
     * See providers/twelvedata/symbolFormat.js.
     */
    toProviderSymbol(symbol, opts = {}) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol);
        if (!canonical && symbol == null) return "";
        return formatTwelveDataSymbol(canonical || symbol, opts);
    }

    /**
     * subscribe(symbols)
     *
     * Canonicalizes caller symbols, formats them for Twelve Data, then adds
     * them to the singleton's tracked subscription set. The legacy
     * subscribe() only queues a message and never updates that set, so
     * unsubscribe() (a set replacement) must go through updateSymbols() to
     * keep the upstream state authoritative.
     */
    async subscribe(symbols) {
        const arr = Array.isArray(symbols) ? symbols : [];
        const providerSymbols = arr
            .map((s) => this.toProviderSymbol(s))
            .filter(Boolean);
        if (providerSymbols.length === 0) return;

        const current = this._broker.getStatus().symbols || [];
        const next = Array.from(new Set([...current, ...providerSymbols]));
        return this._broker.updateSymbols(next);
    }

    /**
     * unsubscribe(symbols)
     *
     * TwelveData's broker exposes updateSymbols() (set replacement) but no
     * direct unsubscribe(). Implemented via set-difference on the current
     * symbol set; comparisons happen in canonical space, the remaining set
     * stays in provider form.
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
     * Formats the symbol for Twelve Data, fetches, then re-tags returned bars
     * with the canonical symbol so the rest of CoreX never sees provider form.
     */
    async fetchHistory({ symbol, interval, outputsize }) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol);
        if (!canonical) {
            throw new DataProviderError("SYMBOL_NOT_FOUND", {
                provider: "twelvedata",
                symbol: symbol == null ? null : String(symbol),
                message: "A non-empty symbol is required for a historical fetch."
            });
        }

        try {
            const bars = await this._broker.fetchHistory({
                symbol: this.toProviderSymbol(canonical),
                interval,
                outputsize
            });
            if (!Array.isArray(bars)) return bars;
            return bars.map((bar) => (bar && typeof bar === "object" ? { ...bar, symbol: canonical } : bar));
        } catch (err) {
            throw this._mapLegacyError(err, canonical);
        }
    }

    /**
     * Map legacy/transport failures onto the typed provider error set.
     * DataProviderError instances are passed through untouched.
     */
    _mapLegacyError(err, symbol) {
        if (err instanceof DataProviderError) return err;

        const message = String(err?.message || err || "");
        const status = err?.response?.status;

        if (err?.code === "PROVIDER_KEY_MISSING" || message.startsWith("PROVIDER_KEY_MISSING")) {
            return new DataProviderError("PROVIDER_KEY_MISSING", {
                provider: "twelvedata",
                symbol,
                message,
                cause: err
            });
        }

        if (message.startsWith("DATA_UNAVAILABLE") || status === 404) {
            return new DataProviderError("SYMBOL_NOT_FOUND", {
                provider: "twelvedata",
                symbol,
                message: message || `Symbol '${symbol}' not found.`,
                cause: err
            });
        }

        if (status === 401 || status === 403) {
            return new DataProviderError("AUTH_FAILED", {
                provider: "twelvedata",
                symbol,
                message: message || "Twelve Data rejected the credentials.",
                cause: err
            });
        }

        return new DataProviderError("PROVIDER_UNAVAILABLE", {
            provider: "twelvedata",
            symbol,
            message: message || "Twelve Data request failed.",
            cause: err
        });
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
