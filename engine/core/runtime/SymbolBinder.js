"use strict";

/**
 * SymbolBinder.js
 *
 * One binding contract shared by live start and backtest runs:
 *
 *   declared universe (strategy metadata) + requested chart symbol
 *        -> resolved instrument (canonical identity + asset class)
 *
 * Both sides are canonicalised before comparison, so a strategy that declares
 * "BTC/USD" can be bound to a request for "BTCUSD".
 *
 * Strategies must declare at least one symbol: Strategy, BaseStrategy and the
 * compiler all reject an empty list. The empty-list branch below is defensive
 * only, for missing/legacy metadata that predates that invariant; it is not an
 * authorable "trade anything" mode.
 *
 * The *identity* spelling (used for the runtimeId) is intentionally kept
 * separate from the canonical spelling (used for data/registry):
 *   - a request that matches a declared symbol keeps the declared spelling, so
 *     existing ids like `<id>::BTC/USD::PAPER` are reproduced exactly;
 *   - an outside-universe or free-symbol request uses the canonical spelling.
 */

const { resolveInstrument } = require("corex-broker-contract");

const SYMBOL_NOT_SUPPORTED_BY_STRATEGY = "SYMBOL_NOT_SUPPORTED_BY_STRATEGY";

class SymbolBindingError extends Error {
    /**
     * @param {Object} opts
     * @param {string} opts.requested
     * @param {string[]} opts.declared
     */
    constructor({ requested, declared }) {
        const universe = (declared || []).join(", ");
        super(
            `Symbol '${requested || ""}' is not supported by this strategy` +
            (universe ? ` (declared: ${universe})` : "")
        );
        this.name = "SymbolBindingError";
        this.code = SYMBOL_NOT_SUPPORTED_BY_STRATEGY;
        this.requestedSymbol = requested || "";
        this.declaredSymbols = [...(declared || [])];
        this.retryable = false;
    }
}

function _toDeclaredList(declaredSymbols) {
    return (Array.isArray(declaredSymbols) ? declaredSymbols : [])
        .map((s) => String(s == null ? "" : s).trim())
        .filter(Boolean);
}

function _instrumentWith(identitySymbol, declaredSymbol, instrument, extra = {}) {
    return {
        ...instrument,
        identitySymbol,
        declaredSymbol,
        ...extra
    };
}

/**
 * Bind a requested symbol to a strategy's declared universe.
 *
 * @param {string[]} declaredSymbols
 * @param {string} requestedSymbol
 * @param {{ allowOutsideUniverse?: boolean }} [opts]
 * @returns {{ canonical: string, assetClass: string, base: string|null, quote: string|null,
 *             pipScale: number, identitySymbol: string, declaredSymbol: string|null,
 *             outsideUniverse?: boolean }}
 * @throws {SymbolBindingError} when the request is outside the declared universe
 *         and `allowOutsideUniverse` is not set
 */
function bindSymbol(declaredSymbols, requestedSymbol, opts = {}) {
    const allowOutsideUniverse = opts.allowOutsideUniverse === true;
    const declared = _toDeclaredList(declaredSymbols);
    const requestedRaw = requestedSymbol == null ? "" : String(requestedSymbol).trim();

    if (declared.length === 0) {
        // Defensive fallback for missing/legacy metadata only. Authorable
        // strategies cannot reach this branch (constructors/compiler reject []).
        const instrument = resolveInstrument(requestedRaw);
        if (!instrument.canonical) {
            throw new SymbolBindingError({ requested: requestedRaw, declared });
        }
        return _instrumentWith(instrument.canonical, null, instrument);
    }

    const effectiveRequested = requestedRaw || declared[0];
    const requestedInstrument = resolveInstrument(effectiveRequested);

    const requestedUpper = effectiveRequested.toUpperCase();
    let match = declared.find((symbol) => symbol.toUpperCase() === requestedUpper);
    if (!match) {
        // Canonical comparison: declared "BTC/USD" matches requested "BTCUSD".
        match = declared.find(
            (symbol) => resolveInstrument(symbol).canonical === requestedInstrument.canonical
        );
    }

    if (match) {
        return _instrumentWith(match.toUpperCase(), match, resolveInstrument(match));
    }

    if (allowOutsideUniverse && requestedInstrument.canonical) {
        return _instrumentWith(
            requestedInstrument.canonical,
            null,
            requestedInstrument,
            { outsideUniverse: true }
        );
    }

    throw new SymbolBindingError({ requested: effectiveRequested, declared });
}

/**
 * Build the composite runtime identity. Unchanged from the historical scheme:
 * `<strategyId>::<symbol>::<mode>`.
 */
function runtimeIdFor(strategyId, identitySymbol, mode) {
    return `${strategyId}::${identitySymbol}::${mode}`;
}

/**
 * Re-scope a strategy instance to exactly one bound instrument.
 *
 * Shared by live start and backtest: the instance's symbol list and data
 * manager must agree with the bound chart symbol, otherwise default helpers
 * (series(), getLookbackWindow(), pos()) keep reading the constructor's first
 * declared symbol and see no data.
 *
 * @param {Object} instance — Strategy / BaseStrategy instance
 * @param {Object} binding  — result of bindSymbol()
 * @param {{ broker?: Object, mode?: string, runtimeId?: string }} [opts]
 * @returns {Object} the same instance
 */
function rescopeStrategy(instance, binding, opts = {}) {
    if (!instance || typeof instance !== "object") {
        throw new TypeError("[SymbolBinder] rescopeStrategy requires a strategy instance");
    }
    const instrument = binding && binding.canonical ? binding : resolveInstrument(binding);
    const canonical = instrument.canonical;

    instance.symbols = [canonical];

    const dataManager = instance.dataManager;
    const DataManagerClass = dataManager && dataManager.constructor;
    if (typeof DataManagerClass === "function" && DataManagerClass !== Object) {
        instance.dataManager = new DataManagerClass({
            symbols: [canonical],
            maxHistory: instance.max_data_history || dataManager.maxHistory || 500
        });
    }

    // Backtest wires the broker after rescope; _attachRuntime falls back to this
    // so env.pipScale/assetClass survive that later attach.
    instance._corexInstrument = instrument;

    if (typeof instance._attachRuntime === "function" && (opts.mode || opts.runtimeId)) {
        instance._attachRuntime({
            broker: opts.broker,
            mode: opts.mode,
            runtimeId: opts.runtimeId,
            symbol: canonical,
            instrument
        });
    }

    return instance;
}

module.exports = {
    bindSymbol,
    rescopeStrategy,
    runtimeIdFor,
    SymbolBindingError,
    SYMBOL_NOT_SUPPORTED_BY_STRATEGY
};
