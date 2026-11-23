"use strict";

const { indicators } = require("../../src/IndicatorRegistry");
const Frame = require("../../src/kernel/Frame");
const knownBroken = require("./known-broken.json").knownBroken;

const reference = name => require("../helpers/reference/" + name);

function makeSeed(kind, count) {
    const open = [], high = [], low = [], close = [], volume = [];
    for (let i = 0; i < count; i++) {
        let c, o, h, l, v;
        if (kind === "flat") {
            c = 100; o = h = l = 100; v = 0;
        } else {
            c = 100 + 0.35 * i + 2 * Math.sin(0.71 * i) + 0.8 * Math.cos(0.19 * i);
            o = c - 0.25 + 0.2 * Math.sin(0.31 * i);
            h = Math.max(c, o) + 0.7 + 0.1 * (i % 3);
            l = Math.min(c, o) - 0.6 - 0.1 * (i % 4);
            v = 1000 + 137 * (i % 7) + 3 * i;
            if (kind === "edge" && ((i >= 18 && i < 30) || (i >= 58 && i < 70))) o = h = l = c;
            if (kind === "edge" && ((i >= 18 && i < 38) || (i >= 58 && i < 76))) v = 0;
        }
        open.push(o); high.push(h); low.push(l); close.push(c); volume.push(v);
    }
    return { open, high, low, close, volume };
}

const seeds = [
    ["trend", makeSeed("trend", 64)],
    ["flat-zero-volume", makeSeed("flat", 64)],
    ["zero-range-zero-volume-segments", makeSeed("edge", 96)]
];

function makeFrame(data, i) {
    const frame = new Frame();
    if (!frame.load({
        symbol: "PARITY", time: i, price: data.close[i],
        open: data.open[i], high: data.high[i], low: data.low[i],
        close: data.close[i], volume: data.volume[i]
    })) throw new Error("Parity fixture produced invalid OHLCV at " + i);
    return frame;
}

const specs = [
    { name: "InstantTrend", args: [0.07], ref: d => reference("InstantTrend")(d.close, 0.07), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "VIDYA", args: [5, 2, 30], ref: d => reference("VIDYA")(d.close, 5), frame: true },
    { name: "McGinley", args: [5, 0.6], ref: d => reference("McGinley")(d.close, 5, 0.6), frame: true },
    { name: "ALMA", args: [5, 0.85, 6], ref: d => reference("ALMA")(d.close, 5, 0.85, 6), frame: true },
    { name: "Coppock", args: [11, 14], ref: d => reference("Coppock")(d.close, 10, 14, 11), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "ADX", args: [5], ref: d => reference("ADX")(d.high, d.low, d.close, 5), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]) },
    { name: "STC", args: [10, 0.3, 5], ref: d => reference("STC")(d.close, 23, 50, 10, 3), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "RVI", args: [4], ref: d => reference("RVI")(d.open, d.high, d.low, d.close, 4), feed: (x, d, i) => x.update(d.close[i], d.open[i], d.high[i], d.low[i]) },
    { name: "FDI", args: [5], ref: d => reference("FDI")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "HMA", args: [5], ref: d => reference("HMA")(d.close, 5), frame: true },
    { name: "ParabolicSAR", args: [0.02, 0.2], ref: d => reference("ParabolicSAR")(d.high, d.low, d.close, 0.02, 0.2), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]) },
    { name: "SuperTrend", args: [5, 3], ref: d => reference("SuperTrend")(d.high, d.low, d.close, 5, 3), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]) },
    { name: "LinearRegression", args: [5], ref: d => reference("LinearRegression")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "Fisher", args: [5], ref: d => reference("Fisher")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "LaguerreRSI", args: [0.5], ref: d => reference("LaguerreRSI")(d.close, 0.5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "ConnorsRSI", args: [3, 2, 2], ref: d => reference("ConnorsRSI")(d.close, 3, 2, 2), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "OBV", args: [], ref: d => reference("OBV")(d.close, d.volume), feed: (x, d, i) => x.update(d.close[i], d.volume[i]) },
    { name: "EoM", args: [5, 10000], ref: d => reference("EoM")(d.high, d.low, d.volume, 5, 10000), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.volume[i]) },
    { name: "Vortex", args: [5], ref: d => reference("Vortex")(d.high, d.low, d.close, 5), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]) },
    { name: "Choppiness", args: [5], ref: d => reference("Choppiness")(d.high, d.low, d.close, 5), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]) },
    { name: "KAMA", args: [5, 2, 30], ref: d => reference("KAMA")(d.close, 5, 2, 30), frame: true },
    { name: "Ichimoku", args: [3, 5, 7, 2], ref: d => reference("Ichimoku")(d.high, d.low, d.close, 3, 5, 7, 2), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]), components: ["tenkan", "kijun", "senkouA", "senkouB", "chikou", "cloudUpper", "cloudLower"] },
    { name: "SMA", args: [5], ref: d => reference("SMA")(d.close, 5), frame: true },
    { name: "EMA", args: [5], ref: d => reference("EMA")(d.close, 5), frame: true },
    { name: "WMA", args: [5], ref: d => reference("WMA")(d.close, 5), frame: true },
    { name: "StandardDeviation", args: [5], ref: d => reference("StandardDeviation")(d.close, 5), frame: true },
    { name: "MACD", args: [3, 6, 3], ref: d => reference("MACD")(d.close, 3, 6, 3), feed: (x, d, i) => x.update(d.close[i]), components: ["signal", "histo"] },
    { name: "ROC", args: [5], ref: d => reference("ROC")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "Momentum", args: [5], ref: d => reference("Momentum")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "WilliamsR", args: [5], ref: d => reference("WilliamsR")(d.high, d.low, d.close, 5), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]), warmupBars: 5 },
    { name: "UltimateOscillator", args: [3, 5, 7], ref: d => reference("UltimateOscillator")(d.high, d.low, d.close, 3, 5, 7), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]), warmupBars: 8 },
    { name: "CCI", args: [5], ref: d => reference("CCI")(d.close.map((v, i) => (d.high[i] + d.low[i] + v) / 3), 5), feed: (x, d, i) => x.update((d.high[i] + d.low[i] + d.close[i]) / 3) },
    { name: "TSI", args: [5, 10], ref: d => reference("TSI")(d.close, 5, 10), feed: (x, d, i) => x.update(d.close[i]), warmupBars: 15 },
    { name: "CMO", args: [5], ref: d => reference("CMO")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "BollingerBands", args: [5, 2], ref: d => reference("BollingerBands")(d.close, 5, 2), frame: true, components: ["upper", "lower"] },
    { name: "KeltnerChannels", args: [5, 2], ref: d => reference("KeltnerChannels")(d.high, d.low, d.close, 5, 2), frame: true, components: ["upper", "lower"] },
    { name: "DonchianChannels", args: [5], ref: d => reference("DonchianChannels")(d.high, d.low, d.close, 5), frame: true, components: ["upper", "lower"] },
    { name: "Stochastic", args: [5, 3], ref: d => reference("Stochastic")(d.high, d.low, d.close, 5, 3), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i]), components: ["k", "d"] },
    { name: "VWAP", args: [], ref: d => reference("VWAP")(d.close, d.volume), feed: (x, d, i) => x.update(d.close[i], d.volume[i]) },
    { name: "AnchoredVWAP", args: [], ref: d => reference("AnchoredVWAP")(d.close, d.volume, 0), feed: (x, d, i) => x.update(d.close[i], d.volume[i]) },
    { name: "MFI", args: [5], ref: d => reference("MFI")(d.high, d.low, d.close, d.volume, 5), feed: (x, d, i) => { const typical = (d.high[i] + d.low[i] + d.close[i]) / 3; x.update(typical, typical * d.volume[i], d.volume[i]); } },
    { name: "CMF", args: [5], ref: d => reference("CMF")(d.high, d.low, d.close, d.volume, 5), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i], d.volume[i]) },
    { name: "AD", args: [], ref: d => reference("AD")(d.high, d.low, d.close, d.volume), feed: (x, d, i) => x.update(d.high[i], d.low[i], d.close[i], d.volume[i]) },
    { name: "Hurst", args: [10], ref: d => reference("Hurst")(d.close, 10), feed: (x, d, i) => x.update(d.close[i]), warmupBars: 10 },
    { name: "ZScore", args: [5], ref: d => reference("ZScore")(d.close, 5), frame: true },
    { name: "DPO", args: [5], ref: d => reference("DPO")(d.close, 5), frame: true },
    { name: "SuperSmoother", args: [0.2], ref: d => reference("SuperSmoother")(d.close, 0.2), feed: (x, d, i) => x.update(d.close[i]) },
    { name: "ATR", args: [5], ref: d => reference("ATR")(d.high, d.low, d.close, 5), frame: true },
    { name: "RSI", args: [5], ref: d => reference("RSI")(d.close, 5), feed: (x, d, i) => x.update(d.close[i]) }
];

function assertSeriesParity(spec) {
    for (const [seedName, data] of seeds) {
        const instance = new indicators[spec.name](...spec.args);
        const expected = spec.ref(data);
        let expectedSeries = expected.series;
        let expectedReadySeries = null;
        if (!Array.isArray(expectedSeries) || expectedSeries.length !== data.close.length) {
            expectedSeries = [];
            expectedReadySeries = [];
            for (let end = 1; end <= data.close.length; end++) {
                const prefix = {
                    open: data.open.slice(0, end),
                    high: data.high.slice(0, end),
                    low: data.low.slice(0, end),
                    close: data.close.slice(0, end),
                    volume: data.volume.slice(0, end)
                };
                const result = spec.ref(prefix);
                expectedSeries.push(result.value);
                expectedReadySeries.push(result.ready === true);
            }
        }
        if (expectedSeries.length !== data.close.length) {
            throw new Error(spec.name + " reference series length mismatch for " + seedName);
        }
        let comparedBars = 0;
        for (let i = 0; i < data.close.length; i++) {
            if (spec.frame) instance.update(makeFrame(data, i));
            else spec.feed(instance, data, i);
            const row = expectedSeries[i];
            const expectedReady = spec.warmupBars
                ? i + 1 >= spec.warmupBars
                : (expectedReadySeries
                    ? expectedReadySeries[i]
                    : (row && typeof row === "object" && !Array.isArray(row) && typeof row.ready === "boolean"
                        ? row.ready
                        : row !== null && row !== undefined && Number.isFinite(row)));
            if (!instance.ready || !expectedReady) continue;
            comparedBars += 1;
            if (spec.components) {
                for (const field of spec.components) {
                    const target = row[field], actual = instance[field];
                    if (target == null) continue;
                    if (!Number.isFinite(actual) || Math.abs(actual - target) > 1e-9) {
                        throw new Error(spec.name + "." + field + " mismatch on " + seedName + " bar " + i);
                    }
                }
            } else {
                const target = typeof row === "number" ? row : row.value;
                if (!Number.isFinite(target) || !Number.isFinite(instance.value) ||
                    Math.abs(instance.value - target) > 1e-9) {
                    throw new Error(spec.name + " value mismatch on " + seedName + " bar " + i +
                        ": production=" + instance.value + ", reference=" + target);
                }
            }
        }
        if (comparedBars === 0 && expected.ready === true) {
            throw new Error(spec.name + " had no overlapping ready bars for " + seedName);
        }
    }
}

describe("full-series indicator parity ratchet", () => {
    test("parity harness includes three deterministic seeds and edge segments", () => {
        expect(seeds.map(([name]) => name)).toEqual([
            "trend", "flat-zero-volume", "zero-range-zero-volume-segments"
        ]);
        expect(specs).toHaveLength(49);
        expect(new Set(specs.filter(spec => knownBroken.includes(spec.name)).map(spec => spec.name))).toEqual(new Set(knownBroken));
        expect(seeds[1][1].volume.every(value => value === 0)).toBe(true);
        expect(seeds[2][1].volume.some(value => value === 0)).toBe(true);
        expect(seeds[2][1].high.some((value, i) => value === seeds[2][1].low[i])).toBe(true);
    });

    for (const spec of specs) {
        const diverges = knownBroken.includes(spec.name);
        const registerTest = diverges ? test.failing : test;
        registerTest(spec.name + (diverges ? " diverges" : " matches") + " full-series references", () => {
            assertSeriesParity(spec);
        });
    }

    test("Fibonacci static levels match independent arithmetic on every bar", () => {
        for (const [seedName, data] of seeds) {
            const indicator = new indicators.Fibonacci();
            for (let i = 0; i < data.close.length; i++) {
                const actual = indicator.update(data.high[i], data.low[i]);
                const expected = reference("Fibonacci")(data.high[i], data.low[i]).levels;
                expect(indicator.ready).toBe(true);
                expect(actual).toHaveLength(expected.length);
                for (let j = 0; j < expected.length; j++) {
                    expect(actual[j].level).toBe(expected[j].level);
                    expect(actual[j].price).toBeCloseTo(expected[j].price, 10);
                }
            }
        }
    });
});