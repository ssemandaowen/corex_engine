"use strict";

/**
 * Instruments.js
 *
 * Canonical symbol → instrument metadata resolution, plus the generic
 * provider-symbol formatter used at adapter boundaries.
 *
 * Resolution order:
 *   1. explicit table (EXPLICIT_INSTRUMENTS) — wins over every rule below
 *   2. conservative classification rules (fx / crypto)
 *   3. pass-through (equity for plain tickers, "other" otherwise)
 *
 * Unknown symbols are never guessed into fx or crypto. The canonical identity
 * is produced by SymbolNormalizer and is lossy for names with separators
 * (BRK.B → BRKB), so base/quote are only derived for identities the rules
 * positively recognize.
 */

const SymbolNormalizer = require("./SymbolNormalizer");

// ISO-style fiat codes we can positively recognize as currency legs.
const FIAT_CODES = new Set([
    "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD",
    "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "ZAR",
    "MXN", "SGD", "HKD", "CNH", "CNY", "INR", "BRL", "RUB",
    "ILS", "THB", "KRW"
]);

// Crypto bases we can positively recognize. A crypto instrument requires a
// known base plus a known fiat quote leg. USDT is deliberately absent from
// both sets: its provider spelling is unverified, so USDT pairs pass through
// as canonical identities instead of being formatted.
const CRYPTO_BASES = new Set([
    "BTC", "ETH", "XRP", "LTC", "BCH", "ADA", "SOL", "DOGE", "DOT",
    "LINK", "AVAX", "MATIC", "XLM", "TRX", "ATOM", "ETC", "FIL",
    "NEAR", "APT", "ARB", "OP", "SHIB", "BNB", "USDC"
]);
const CRYPTO_QUOTES = new Set(["USD"]);
const CRYPTO_BASES_BY_LENGTH = Array.from(CRYPTO_BASES).sort((a, b) => b.length - a.length);

// Explicit overrides. Keep this table nearly empty: only add an entry when a
// symbol's identity/provider spelling has actually been verified. Entries are
// merged over the rule-derived record.
const EXPLICIT_INSTRUMENTS = Object.freeze({
    // Example shape (do not add unverified entries):
    // XAUUSD: { assetClass: "other", base: "XAU", quote: "USD" }
});

function _classify(canonical) {
    if (!canonical) {
        return { assetClass: "other", base: null, quote: null };
    }

    if (canonical.length === 6) {
        const base = canonical.slice(0, 3);
        const quote = canonical.slice(3);
        if (FIAT_CODES.has(base) && FIAT_CODES.has(quote)) {
            return { assetClass: "fx", base, quote };
        }
    }

    for (const base of CRYPTO_BASES_BY_LENGTH) {
        if (!canonical.startsWith(base)) continue;
        const quote = canonical.slice(base.length);
        if (CRYPTO_QUOTES.has(quote)) {
            return { assetClass: "crypto", base, quote };
        }
    }

    // Plain 1–5 letter tickers are pass-through equities; anything else
    // (indices, broker instruments, metals, futures) stays "other" because we
    // cannot verify its identity.
    if (/^[A-Z]{1,5}$/.test(canonical)) {
        return { assetClass: "equity", base: canonical, quote: null };
    }
    return { assetClass: "other", base: null, quote: null };
}

/**
 * Resolve a symbol-like value (or an already-resolved instrument) to
 * instrument metadata.
 *
 * @param {string|Object} symbolLike — "EUR/USD", "eurusd", "EUR_USD", ...
 * @returns {{ canonical: string, assetClass: string, base: string|null, quote: string|null, pipScale: number, aliases?: string[] }}
 */
function resolveInstrument(symbolLike) {
    if (symbolLike && typeof symbolLike === "object" && symbolLike.canonical !== undefined) {
        return { ...symbolLike };
    }

    const { symbol: canonical, pipScale } = SymbolNormalizer.normalize(symbolLike);
    const classified = _classify(canonical);
    const override = canonical ? EXPLICIT_INSTRUMENTS[canonical] : null;

    return {
        canonical,
        assetClass: classified.assetClass,
        base: classified.base,
        quote: classified.quote,
        pipScale,
        ...(override || {})
    };
}

/**
 * Generic provider-symbol formatter. FX and crypto pairs are emitted as
 * BASE/QUOTE; everything else passes through as the canonical identity.
 * An explicit per-call override (keyed by canonical) wins.
 *
 * @param {string|Object} symbolLike
 * @param {{ overrides?: Object<string,string> }} [opts]
 * @returns {string}
 */
function toProviderSymbol(symbolLike, opts = {}) {
    const instrument = resolveInstrument(symbolLike);
    if (!instrument.canonical) return "";

    const overrides = opts && opts.overrides;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, instrument.canonical)) {
        return overrides[instrument.canonical];
    }

    if (
        (instrument.assetClass === "fx" || instrument.assetClass === "crypto") &&
        instrument.base &&
        instrument.quote
    ) {
        return `${instrument.base}/${instrument.quote}`;
    }

    return instrument.canonical;
}

module.exports = {
    resolveInstrument,
    toProviderSymbol,
    FIAT_CODES,
    CRYPTO_BASES,
    EXPLICIT_INSTRUMENTS
};
