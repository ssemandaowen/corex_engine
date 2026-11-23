"use strict";

/**
 * P0-B — one symbol-binding contract for live and backtest.
 *
 * The failing-first case is intentionally written against the *current*
 * shape of the bug: a strategy constructed with symbols ["EURUSD"] that is
 * asked to run GBPUSD keeps reading its constructor's first symbol, so
 * series()/getLookbackWindow() come back empty even though GBPUSD bars were
 * ingested. Rescoping fixes the read.
 */

const {
    bindSymbol,
    rescopeStrategy,
    runtimeIdFor,
    SymbolBindingError
} = require("@core/core/runtime/SymbolBinder");
const { Strategy } = require("corex-strategy-engine");

function makeBars(symbol, count = 3) {
    return Array.from({ length: count }, (_, i) => ({
        symbol,
        time: 1_700_000_000_000 + i * 60_000,
        open: 1.1 + i,
        high: 1.2 + i,
        low: 1.0 + i,
        close: 1.15 + i,
        volume: 10
    }));
}

class EurUsdStrategy extends Strategy {
    constructor() {
        super({ symbols: ["EURUSD"], timeframe: "1m", lookback: 3 });
    }
}

describe("bindSymbol", () => {
    test("binds an exact declared symbol", () => {
        const bound = bindSymbol(["EURUSD"], "EURUSD");
        expect(bound).toMatchObject({
            canonical: "EURUSD",
            identitySymbol: "EURUSD",
            declaredSymbol: "EURUSD",
            assetClass: "fx"
        });
    });

    test("a declared 'BTC/USD' matches a request for 'BTCUSD'", () => {
        const bound = bindSymbol(["BTC/USD"], "BTCUSD");
        expect(bound.canonical).toBe("BTCUSD");
        expect(bound.identitySymbol).toBe("BTC/USD");
        expect(bound.assetClass).toBe("crypto");
        expect(bound.pipScale).toBeDefined();
    });

    test("identity spelling follows the declaration even for lowercase requests", () => {
        expect(bindSymbol(["BTC/USD"], "btc/usd").identitySymbol).toBe("BTC/USD");
        expect(bindSymbol(["EURUSD"], "eurusd").identitySymbol).toBe("EURUSD");
    });

    test("an empty declared list is only a defensive fallback (not authorable)", () => {
        // Strategies cannot declare an empty universe: construction and
        // compilation reject it. This branch only serves legacy metadata.
        const bound = bindSymbol([], "EUR/USD");
        expect(bound.canonical).toBe("EURUSD");
        expect(bound.identitySymbol).toBe("EURUSD");
        expect(bound.declaredSymbol).toBeNull();
    });

    test("an outside-universe request is rejected with a typed, non-retryable error", () => {
        let error;
        try {
            bindSymbol(["EURUSD"], "GBPUSD");
        } catch (err) {
            error = err;
        }
        expect(error).toBeInstanceOf(SymbolBindingError);
        expect(error.code).toBe("SYMBOL_NOT_SUPPORTED_BY_STRATEGY");
        expect(error.retryable).toBe(false);
        expect(error.requestedSymbol).toBe("GBPUSD");
        expect(error.declaredSymbols).toEqual(["EURUSD"]);
    });

    test("allowOutsideUniverse opts into the requested symbol", () => {
        const bound = bindSymbol(["EURUSD"], "GBP/USD", { allowOutsideUniverse: true });
        expect(bound.canonical).toBe("GBPUSD");
        expect(bound.identitySymbol).toBe("GBPUSD");
        expect(bound.outsideUniverse).toBe(true);
    });

    test("runtime id derivation preserves the historical identity spelling", () => {
        const bound = bindSymbol(["BTC/USD"], "BTCUSD");
        expect(runtimeIdFor("u1::S", bound.identitySymbol, "PAPER")).toBe("u1::S::BTC/USD::PAPER");
        expect(runtimeIdFor("u1::S", "EURUSD", "PAPER")).toBe("u1::S::EURUSD::PAPER");
    });
});

describe("strategy symbol universe invariant", () => {
    test("Strategy construction rejects an empty symbol list", () => {
        expect(() => new Strategy({ symbols: [], timeframe: "1m" })).toThrow(/at least one symbol/);
    });
});

describe("rescopeStrategy (wrong-symbol read)", () => {
    test("before rescope, default helpers read the constructor's first symbol (empty)", () => {
        const strategy = new EurUsdStrategy();
        strategy.dataManager.ingestBar({ ...makeBars("GBPUSD", 1)[0] });

        expect(strategy.symbols[0]).toBe("EURUSD");
        expect(strategy.series()).toEqual([]); // GBPUSD bars are invisible
        expect(strategy.dataManager.getLookbackWindow(strategy.symbols[0])).toEqual([]);
    });

    test("after rescope, symbols/env/dataManager agree on GBPUSD and series() reads it", () => {
        const strategy = new EurUsdStrategy();
        const bound = bindSymbol(["EURUSD"], "GBPUSD", { allowOutsideUniverse: true });

        rescopeStrategy(strategy, bound, { mode: "BACKTEST" });

        expect(strategy.symbols).toEqual(["GBPUSD"]);
        expect(strategy.env.symbol).toBe("GBPUSD");
        expect(strategy.env.pipScale).toBe(4);
        expect(strategy.env.assetClass).toBe("fx");

        for (const bar of makeBars("GBPUSD")) strategy.dataManager.ingestBar(bar);

        expect(strategy.series()).toEqual([1.15, 2.15, 3.15]);
        expect(strategy.dataManager.getLookbackWindow("GBPUSD")).toHaveLength(3);
    });

    test("rescope keeps identity when declared spelling differs (BTC/USD)", () => {
        const strategy = new EurUsdStrategy();
        strategy.symbols = ["BTC/USD"];
        strategy.dataManager = new strategy.dataManager.constructor({ symbols: ["BTC/USD"] });

        rescopeStrategy(strategy, bindSymbol(["BTC/USD"], "BTCUSD"), { mode: "BACKTEST" });

        expect(strategy.symbols).toEqual(["BTCUSD"]);
        expect(strategy.env.symbol).toBe("BTCUSD");
        expect(strategy.env.assetClass).toBe("crypto");
        expect(strategy._corexInstrument.identitySymbol).toBe("BTC/USD");
    });
});
