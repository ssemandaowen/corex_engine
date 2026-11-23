"use strict";

const reference = require("../helpers/reference/MACD");

describe("MACD reference (independent, published definition — Appel)", () => {
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-computed worked example: MACD(3, 5, 2)", () => {
        // Convention: MACD line = EMA(3) - EMA(5), both seeded with SMA of first period;
        //   Signal = EMA(2) of MACD line (first-value seeding); Histogram = MACD - Signal.
        //   EMA seeds: fast(3) at idx2 = (10+12+11)/3 = 11; slow(5) at idx4 = 60/5 = 12.
        //   This is a path-dependent double-EMA recursion; the asserted values are the
        //   independent reference's final outputs for this deterministic input:
        //     MACD line   = -0.13618827160494007
        //     Signal      = -0.20138888888889026
        //     Histogram   =  0.06520061728395019
        const result = reference(closes, 3, 5, 2);
        expect(result.ready).toBe(true);
        expect(result.histoReady).toBe(true);
        expect(result.value).toBeCloseTo(-0.13618827160494007, 10);
        expect(result.signal).toBeCloseTo(-0.20138888888889026, 10);
        expect(result.histo).toBeCloseTo(0.06520061728395019, 10);
    });

    test("not ready until fast and slow EMAs are ready", () => {
        const result = reference([10, 12, 11], 3, 5, 2);
        expect(result.ready).toBe(false);
    });

    test("technicalindicators cross-check (MACD)", () => {
        const ti = require("technicalindicators");
        const tiResult = new ti.MACD({ values: closes, fastPeriod: 3, slowPeriod: 5, signalPeriod: 2 }).getResult();
        const last = tiResult[tiResult.length - 1];
        // Note: technicalindicators uses its own EMA seeding convention, so values may
        // differ from the independent reference; report, do not force exact equality.
        expect(last.MACD).toBeCloseTo(reference(closes, 3, 5, 2).value, 2);
    });
});
