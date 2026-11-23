"use strict";

/**
 * Twelve Data provider symbol formatting.
 *
 * Canonical CoreX symbols (EURUSD, BTCUSD) are internal; this module converts
 * them to the representation Twelve Data expects on the wire (EUR/USD,
 * BTC/USD) and leaves equities pass-through.
 *
 * Twelve Data's exact names for metals, indices and USDT pairs are not
 * verified here, so no override entries are shipped. Add entries to
 * TWELVEDATA_SYMBOL_OVERRIDES only after verifying them against the provider.
 */

const { toProviderSymbol: formatProviderSymbol, resolveInstrument } = require("corex-broker-contract");

// canonical -> Twelve Data symbol, for names the generic rules cannot derive.
// Intentionally empty: unverified spellings must not be guessed.
const TWELVEDATA_SYMBOL_OVERRIDES = Object.freeze({});

/**
 * @param {string|Object} symbol — canonical symbol or resolved instrument
 * @param {{ overrides?: Object<string,string> }} [opts]
 * @returns {string} the symbol to send to Twelve Data
 */
function toProviderSymbol(symbol, opts = {}) {
    const instrument = typeof symbol === "string" ? resolveInstrument(symbol) : symbol;
    return formatProviderSymbol(instrument, {
        overrides: {
            ...TWELVEDATA_SYMBOL_OVERRIDES,
            ...((opts && opts.overrides) || {})
        }
    });
}

module.exports = {
    toProviderSymbol,
    TWELVEDATA_SYMBOL_OVERRIDES
};
