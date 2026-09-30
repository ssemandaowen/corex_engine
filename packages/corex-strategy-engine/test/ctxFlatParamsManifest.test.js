"use strict";

const { Strategy } = require("../src/Strategy");
const ParamSchema = require("../src/ParamSchema");
const { CORE_METHOD_MANIFEST } = require("../src/validation/StrategyManifest");

function makeBar(i) {
    return {
        symbol: "EURUSD",
        time: 1000 * (i + 1),
        open: 1.1,
        high: 1.12,
        low: 1.09,
        close: 1.11 + i * 0.001,
        volume: 100
    };
}

describe("ctx.flat is wired and usable from onBar", () => {
    class FlatStrategy extends Strategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";

        onStart(ctx) {
            this.seenFlat = typeof ctx.flat;
        }

        onBar(ctx, bar) {
            this.ctxFlatType = typeof ctx.flat;
            return ctx.flat(null, bar.close);
        }
    }

    test("ctx.flat is a function and produces an EXIT/FLAT signal without throwing", () => {
        const strategy = new FlatStrategy({ symbols: ["EURUSD"], timeframe: "1m" });

        let signal = null;
        expect(() => { signal = strategy.onBar(makeBar(0)); }).not.toThrow();

        expect(strategy.seenFlat).toBe("function");
        expect(strategy.ctxFlatType).toBe("function");
        expect(signal).toBeTruthy();
        expect(signal.intent).toBe("EXIT");
        expect(String(signal.side).toLowerCase()).toBe("flat");
        expect(signal.symbol).toBe("EURUSD");

        strategy.destroy();
    });
});

describe("periodKey resolution reaches indicator constructors", () => {
    function indicatorFor(def, params) {
        class Probe extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
        }
        Probe.indicators = { probe: def };
        Probe.params = params;
        const strategy = new Probe({ symbols: ["EURUSD"], timeframe: "1m" });
        strategy._ensureInitialized();
        const inst = strategy._indicatorManager.getIndicatorValue("probe");
        const out = { instance: inst };
        strategy.destroy();
        return out;
    }

    test("STOCHASTIC kPeriod follows periodKey", () => {
        const { instance } = indicatorFor(
            { type: "STOCHASTIC", periodKey: "sp" },
            { sp: { type: "integer", default: 21 } }
        );
        expect(instance.kPeriod).toBe(21);
    });

    test("TSI shortPeriod follows periodKey", () => {
        const { instance } = indicatorFor(
            { type: "TSI", periodKey: "tp" },
            { tp: { type: "integer", default: 34 } }
        );
        expect(instance.shortPeriod).toBe(34);
    });

    test("CONNORSRSI rsiPeriod follows periodKey", () => {
        const { instance } = indicatorFor(
            { type: "CONNORSRSI", periodKey: "cp" },
            { cp: { type: "integer", default: 7 } }
        );
        expect(instance.rsiPeriod).toBe(7);
    });

    test("explicit indicator fields still win over the resolved period", () => {
        const { instance } = indicatorFor(
            { type: "STOCHASTIC", periodKey: "sp", kPeriod: 5 },
            { sp: { type: "integer", default: 21 } }
        );
        expect(instance.kPeriod).toBe(5);
    });
});

describe("StrategyManifest exposes exactly one series descriptor", () => {
    test("only one entry labelled series exists, with the real 3-arg signature", () => {
        const seriesEntries = CORE_METHOD_MANIFEST.filter((m) => m.label === "series");
        expect(seriesEntries).toHaveLength(1);
        expect(seriesEntries[0].signature).toBe("series(symbol, field = 'close', n?)");
    });

    test("no duplicate labels exist anywhere in the manifest", () => {
        const labels = CORE_METHOD_MANIFEST.map((m) => m.label);
        const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
        expect(dupes).toEqual([]);
    });
});

describe("updateParams skips schema validation for no-op patches", () => {
    class ParamStrategy extends Strategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";
        static params = {
            period: { type: "integer", default: 14, min: 1, max: 100 },
            label: { type: "string", default: "base" }
        };
    }

    let spy;

    beforeEach(() => {
        spy = jest.spyOn(ParamSchema, "applyPatch");
    });

    afterEach(() => {
        spy.mockRestore();
    });

    test("an unchanged patch does not call applyPatch", () => {
        const strategy = new ParamStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        spy.mockClear();

        const res = strategy.updateParams({ period: 14, label: "base" });
        expect(res.valid).toBe(true);
        expect(spy).not.toHaveBeenCalled();

        strategy.destroy();
    });

    test("an empty patch does not call applyPatch", () => {
        const strategy = new ParamStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        spy.mockClear();

        const res = strategy.updateParams({});
        expect(res.valid).toBe(true);
        expect(spy).not.toHaveBeenCalled();

        strategy.destroy();
    });

    test("a value that would need coercion is not treated as a no-op", () => {
        const strategy = new ParamStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        spy.mockClear();

        const res = strategy.updateParams({ period: "20" });
        expect(res.valid).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(strategy.params.period).toBe(20);
        expect(typeof strategy.params.period).toBe("number");

        strategy.destroy();
    });

    test("a real change still validates and is applied", () => {
        const strategy = new ParamStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        spy.mockClear();

        const res = strategy.updateParams({ period: 25 });
        expect(res.valid).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(strategy.params.period).toBe(25);

        const bad = strategy.updateParams({ period: 500 });
        expect(bad.valid).toBe(false);
        expect(bad.errors).toBeDefined();
        expect(strategy.params.period).toBe(25);

        strategy.destroy();
    });
});
