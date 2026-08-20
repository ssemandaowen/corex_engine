"use strict";

const SymbolNormalizer = require("../src/utils/SymbolNormalizer");

describe("SymbolNormalizer", () => {
    test("normalizes EUR/USD to EURUSD canonical form", () => {
        const result = SymbolNormalizer.normalize("EUR/USD");
        expect(result.symbol).toBe("EURUSD");
        expect(result.pipScale).toBe(4);
        expect(result.digits).toBe(4);
    });

    test("normalizes eurusd to EURUSD canonical form", () => {
        const result = SymbolNormalizer.normalize("eurusd");
        expect(result.symbol).toBe("EURUSD");
        expect(result.pipScale).toBe(4);
    });

    test("normalizes EUR_USD to EURUSD", () => {
        const result = SymbolNormalizer.normalize("EUR_USD");
        expect(result.symbol).toBe("EURUSD");
    });

    test("normalizes BTC.USD to BTCUSD", () => {
        const result = SymbolNormalizer.normalize("BTC.USD");
        expect(result.symbol).toBe("BTCUSD");
    });

    test("JPY pairs have pipScale 2", () => {
        const result = SymbolNormalizer.normalize("USD/JPY");
        expect(result.symbol).toBe("USDJPY");
        expect(result.pipScale).toBe(2);
    });

    test("handles empty/null input gracefully", () => {
        const result = SymbolNormalizer.normalize("");
        expect(result.symbol).toBe("");
        expect(result.pipScale).toBe(0);
        expect(result.digits).toBe(0);
    });

    test("pipScale returns correct scale for known symbols", () => {
        expect(SymbolNormalizer.pipScale("EURUSD")).toBe(4);
        expect(SymbolNormalizer.pipScale("USDJPY")).toBe(2);
    });

    test("toPips converts price difference to pips correctly for 4-digit pair", () => {
        expect(SymbolNormalizer.toPips(0.0050, "EURUSD")).toBe(50);
    });

    test("toPips converts price difference to pips correctly for 2-digit pair", () => {
        expect(SymbolNormalizer.toPips(0.10, "USDJPY")).toBe(10);
    });

    test("fromProvider maps provider-specific formats", () => {
        const result = SymbolNormalizer.fromProvider("EUR_USD");
        expect(result.symbol).toBe("EURUSD");
        expect(result.oanda).toBe("EUR/USD");
    });

    test("legacy pip scale map is accessible", () => {
        expect(SymbolNormalizer.LEGACY_PIP_SCALE).toHaveProperty("EURUSD", 4);
        expect(SymbolNormalizer.LEGACY_PIP_SCALE).toHaveProperty("USDJPY", 2);
    });
});
