"use strict";

/**
 * IndicatorManager dispatch-path coverage.
 *
 * Indicator math itself is covered by the package's Indicators.test.js, which
 * calls update()/reseed() directly. That blind spot is exactly how indicators
 * whose declared `updateMode` disagreed with their real `update()` signature
 * shipped producing NaN on every live tick. These tests drive the REAL
 * IndicatorManager.updateIndicators() path with real packet objects.
 */

const { IndicatorManager } = require("@root/packages/corex-strategy-engine/src/IndicatorManager");
const { globalIndicatorRegistry } = require("@root/packages/corex-strategy-engine/src/IndicatorRegistry");

// Three packets with hand-computable high/low/close/volume.
const PACKETS = [
    { open: 10,  high: 11, low: 9,  close: 10.5, volume: 100 },
    { open: 10.5, high: 12, low: 10, close: 11,   volume: 200 },
    { open: 11,  high: 12, low: 9,  close: 10,   volume: 300 },
];

function buildStrategy(indicatorDefs, seriesValues = []) {
    class TestStrategy {}
    TestStrategy.indicators = indicatorDefs;

    const strategy = new TestStrategy();
    strategy.params = {};
    strategy.symbols = ["EURUSD"];
    strategy.series = () => seriesValues;
    strategy.dataManager = {
        getLookbackWindow: () => PACKETS,
    };
    return strategy;
}

function feed(manager, packets = PACKETS) {
    for (const p of packets) manager.updateIndicators(p);
}

describe("IndicatorManager dispatch (live per-tick path)", () => {
    test("EaseOfMovement receives high/low/volume and produces a finite value", () => {
        const im = new IndicatorManager(buildStrategy({ eom: { type: "EOM", period: 2 } }));
        im.initialize();

        // Hand-computed over PACKETS (scale = 10000):
        //   t1 seeds prevHigh/prevLow only
        //   t2: highMove (12-11)/2 = 0.5, lowMove (9-10)/2 = -0.5  -> boxMove 0    -> emv 0
        //   t3: highMove (12-12)/2 = 0,   lowMove (10-9)/2  = 0.5  -> boxMove 0.5
        //       range 3, emv = 0.5 * 10000 / 300 = 16.6667
        //   buffer [0, 16.6667] -> value = 8.3333
        feed(im);

        const eom = im.getIndicatorValue("eom");
        expect(eom.ready).toBe(true);
        expect(Number.isNaN(eom.value)).toBe(false);
        expect(eom.value).toBeCloseTo(8.3333333, 6);
    });

    test("AccumulationDistribution receives high/low/close/volume and accumulates", () => {
        const im = new IndicatorManager(buildStrategy({ ad: { type: "AD" } }));
        im.initialize();

        // mfm = ((close-low)-(high-close))/(high-low); value += mfm * volume
        //   t1: ((10.5-9)-(11-10.5))/2 = 0.5 -> +0.5*100 =  50
        //   t2: ((11-10)-(12-11))/2     = 0   -> +0         =  50
        //   t3: ((10-9)-(12-10))/3     = -1/3 -> -(1/3)*300 = -50
        feed(im);

        const ad = im.getIndicatorValue("ad");
        expect(Number.isNaN(ad.value)).toBe(false);
        expect(ad.value).toBeCloseTo(-50, 10);
    });

    test("CMF receives high/low/close/volume and computes over its window", () => {
        const im = new IndicatorManager(buildStrategy({ cmf: { type: "CMF", period: 2 } }));
        im.initialize();

        // Window after t3 holds t2 (mfv 0, vol 200) and t3 (mfv -100, vol 300):
        //   value = (-100 + 0) / (300 + 200) = -0.2
        feed(im);

        const cmf = im.getIndicatorValue("cmf");
        expect(cmf.ready).toBe(true);
        expect(Number.isNaN(cmf.value)).toBe(false);
        expect(cmf.value).toBeCloseTo(-0.2, 10);
    });

    test("BollingerBands receives a single value and respects def.source", () => {
        const im = new IndicatorManager(buildStrategy({ bb: { type: "BOLLINGERBANDS", period: 2 } }));
        im.initialize();
        feed(im);

        // Default source "close" -> closes [10.5, 11, 10]; period 2 window after t3
        // is [11, 10] -> sma 10.5, population stddev 0.5, multiplier 2.
        const bb = im.getIndicatorValue("bb");
        expect(bb.ready).toBe(true);
        expect(Number.isNaN(bb.value)).toBe(false);
        expect(bb.value).toBeCloseTo(10.5, 10);
        expect(bb.upper).toBeCloseTo(11.5, 10);
        expect(bb.lower).toBeCloseTo(9.5, 10);

        const imHigh = new IndicatorManager(buildStrategy({ bb: { type: "BOLLINGERBANDS", period: 2, source: "high" } }));
        imHigh.initialize();
        feed(imHigh);
        // highs [11, 12, 12] -> window [12, 12] -> sma 12
        expect(imHigh.getIndicatorValue("bb").value).toBeCloseTo(12, 10);
    });

    test("reseed path feeds candles for the new hlv/hlcv modes", () => {
        const series = [10, 11, 10];
        const im = new IndicatorManager(buildStrategy({
            eom: { type: "EOM", period: 2 },
            ad: { type: "AD" },
        }, series));
        im.initialize();
        im.reseedIndicators();

        const EoM = require("@root/packages/corex-strategy-engine/src/indicators/eom");
        const AD = require("@root/packages/corex-strategy-engine/src/indicators/ad");

        const refEom = new EoM(2, 10000);
        refEom.reseed(PACKETS);
        const refAd = new AD();
        refAd.reseed(PACKETS);

        const eom = im.getIndicatorValue("eom");
        const ad = im.getIndicatorValue("ad");
        expect(Number.isNaN(eom.value)).toBe(false);
        expect(eom.value).toBeCloseTo(refEom.value, 10);
        expect(ad.value).toBeCloseTo(refAd.value, 10);
    });
});

describe("IndicatorManager dispatch-arity safeguard", () => {
    afterEach(() => {
        globalIndicatorRegistry.register("TESTBAD", class extends Object {});
    });

    test("initialize() throws when updateMode arity does not match update()", () => {
        class ArityMismatch {
            static updateMode = "single";
            constructor() { this.value = 0; }
            update(value, extra) { this.value = value + extra; }
        }
        globalIndicatorRegistry.register("TESTBAD", ArityMismatch);

        const im = new IndicatorManager(buildStrategy({ bad: { type: "TESTBAD" } }));
        expect(() => im.initialize()).toThrow(/TESTBAD/);
        expect(() => im.initialize()).toThrow(/dispatch mismatch/);
        expect(() => im.initialize()).toThrow(/'single' dispatches 1 argument\(s\) but update\(\) accepts 2/);
    });

    test("initialize() throws when updateMode is unknown", () => {
        class UnknownMode {
            static updateMode = "not_a_mode";
            constructor() { this.value = 0; }
            update(value) { this.value = value; }
        }
        globalIndicatorRegistry.register("TESTBAD", UnknownMode);

        const im = new IndicatorManager(buildStrategy({ bad: { type: "TESTBAD" } }));
        expect(() => im.initialize()).toThrow(/unknown updateMode 'not_a_mode'/);
    });

    test("initialize() throws when a mode is declared but update() is missing", () => {
        class NoUpdate {
            static updateMode = "single";
            constructor() { this.value = 0; }
        }
        globalIndicatorRegistry.register("TESTBAD", NoUpdate);

        const im = new IndicatorManager(buildStrategy({ bad: { type: "TESTBAD" } }));
        expect(() => im.initialize()).toThrow(/has no update\(\) method/);
    });

    test("every registered indicator satisfies its declared mode arity", () => {
        const { DISPATCH_MODES } = require("@root/packages/corex-strategy-engine/src/IndicatorManager");
        const { indicators } = require("@root/packages/corex-strategy-engine/src/IndicatorRegistry");

        const mismatches = [];
        for (const [key, Cls] of Object.entries(indicators)) {
            const mode = typeof Cls.updateMode === "string" ? Cls.updateMode : "single";
            const spec = DISPATCH_MODES[mode];
            const updateFn = Cls.prototype && Cls.prototype.update;
            if (!spec) {
                mismatches.push(`${key}: unknown mode '${mode}'`);
            } else if (typeof updateFn !== "function") {
                mismatches.push(`${key}: no update() for mode '${mode}'`);
            } else if (updateFn.length !== spec.arity) {
                mismatches.push(`${key}: mode '${mode}' wants ${spec.arity}, update() takes ${updateFn.length}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});