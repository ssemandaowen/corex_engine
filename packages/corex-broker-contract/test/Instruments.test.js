"use strict";

const {
    resolveInstrument,
    toProviderSymbol,
    EXPLICIT_INSTRUMENTS
} = require("../src/utils/Instruments");

describe("Instruments.resolveInstrument", () => {
    test.each([
        ["EUR/USD", { canonical: "EURUSD", assetClass: "fx", base: "EUR", quote: "USD", pipScale: 4 }],
        ["eurusd", { canonical: "EURUSD", assetClass: "fx", base: "EUR", quote: "USD", pipScale: 4 }],
        ["EUR_USD", { canonical: "EURUSD", assetClass: "fx", base: "EUR", quote: "USD", pipScale: 4 }],
        ["USD/JPY", { canonical: "USDJPY", assetClass: "fx", base: "USD", quote: "JPY", pipScale: 2 }],
        ["BTC/USD", { canonical: "BTCUSD", assetClass: "crypto", base: "BTC", quote: "USD" }],
        ["BTCUSD", { canonical: "BTCUSD", assetClass: "crypto", base: "BTC", quote: "USD" }],
        // USDT pairs are not classified: the provider spelling is unverified.
        ["BTC/USDT", { canonical: "BTCUSDT", assetClass: "other", base: null, quote: null }],
        ["AAPL", { canonical: "AAPL", assetClass: "equity", base: "AAPL", quote: null }],
        // Metals/indices are not guessed into fx: their identity is unverified.
        ["SPX500", { canonical: "SPX500", assetClass: "other", base: null, quote: null }],
        ["XAUUSD", { canonical: "XAUUSD", assetClass: "other", base: null, quote: null }]
    ])("resolves %s to %j", (input, expected) => {
        const result = resolveInstrument(input);
        expect(result).toMatchObject(expected);
    });

    test("empty input resolves to an empty 'other' instrument", () => {
        const result = resolveInstrument(null);
        expect(result.canonical).toBe("");
        expect(result.assetClass).toBe("other");
        expect(result.base).toBeNull();
        expect(result.quote).toBeNull();
        expect(result.pipScale).toBe(0);
    });

    test("an already-resolved instrument passes through", () => {
        const instrument = { canonical: "EURUSD", assetClass: "fx", base: "EUR", quote: "USD", pipScale: 4 };
        expect(resolveInstrument(instrument)).toEqual(instrument);
    });

    test("explicit override table is empty until provider spellings are verified", () => {
        expect(Object.keys(EXPLICIT_INSTRUMENTS)).toHaveLength(0);
    });
});

describe("Instruments.toProviderSymbol", () => {
    test.each([
        ["EUR/USD", "EUR/USD"],
        ["eurusd", "EUR/USD"],
        ["EUR_USD", "EUR/USD"],
        ["BTC/USD", "BTC/USD"],
        ["BTCUSD", "BTC/USD"],
        // USDT formatting is unverified, so it passes through unformatted.
        ["BTC/USDT", "BTCUSDT"],
        ["AAPL", "AAPL"],
        // Unknown symbols are passed through unchanged, never reclassified.
        ["SPX500", "SPX500"],
        ["XAUUSD", "XAUUSD"]
    ])("formats %s as %s", (input, expected) => {
        expect(toProviderSymbol(input)).toBe(expected);
    });

    test("per-call overrides win over rule-derived formatting", () => {
        expect(toProviderSymbol("BTCUSD", { overrides: { BTCUSD: "BTC/USDT" } })).toBe("BTC/USDT");
        expect(toProviderSymbol("EURUSD", { overrides: { EURUSD: "EUR_USD" } })).toBe("EUR_USD");
    });

    test("unknown symbol passes through untouched (no guessing)", () => {
        expect(toProviderSymbol("ZZZZZ")).toBe("ZZZZZ");
        expect(toProviderSymbol("SOMETHING/ELSE")).toBe("SOMETHINGELSE");
    });

    test("null/empty resolves to an empty string", () => {
        expect(toProviderSymbol(null)).toBe("");
        expect(toProviderSymbol("")).toBe("");
    });
});
