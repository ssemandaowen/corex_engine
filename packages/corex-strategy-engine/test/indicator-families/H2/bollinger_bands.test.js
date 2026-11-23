"use strict";

const Frame = require("../../../src/kernel/Frame");
const BollingerBands = require("../../../src/indicators/bollinger_bands");
const bbRef = require("../../helpers/reference/BollingerBands");
const { buildFixture, framesFrom, storeFrom } = require("./fixture");
const ti = require("technicalindicators");

function makeFrames(closes, opens) {
    const frames = [];
    for (let i = 0; i < closes.length; i++) {
        const f = new Frame();
        f.load({ time: i, open: opens[i] !== undefined ? opens[i] : closes[i], high: closes[i], low: closes[i], close: closes[i], volume: 1 });
        frames.push(f);
    }
    return frames;
}

function assertBarByBar(bb, frames, ref) {
    for (let i = 0; i < frames.length; i++) {
        bb.update(frames[i]);
        const entry = ref.series[i];
        expect(bb.ready).toBe(entry.ready);
        if (entry.ready) {
            expect(Math.abs(bb.value - entry.value)).toBeLessThanOrEqual(1e-9);
            expect(Math.abs(bb.upper - entry.upper)).toBeLessThanOrEqual(1e-9);
            expect(Math.abs(bb.lower - entry.lower)).toBeLessThanOrEqual(1e-9);
        } else {
            expect(Number.isNaN(bb.value)).toBe(true);
            expect(bb.upper).toBe(0);
            expect(bb.lower).toBe(0);
        }
    }
    const last = ref.series[ref.series.length - 1];
    expect(bb.ready).toBe(last.ready);
    expect(Math.abs(bb.value - last.value)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(bb.upper - last.upper)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(bb.lower - last.lower)).toBeLessThanOrEqual(1e-9);
}

describe("BollingerBands (Frame-based)", () => {
    const period = 5;
    const multiplier = 2;
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("worked example: absolute parity with independent reference <= 1e-9", () => {
        const ref = bbRef(closes, period, multiplier);
        const frames = makeFrames(closes, closes);
        const bb = new BollingerBands(period, multiplier);
        assertBarByBar(bb, frames, ref);
    });

    test("deterministic 64-bar fixture: absolute parity <= 1e-9", () => {
        const { closes } = buildFixture(64);
        const ref = bbRef(closes, period, multiplier);
        const frames = framesFrom(closes, closes, closes, closes);
        const bb = new BollingerBands(period, multiplier);
        assertBarByBar(bb, frames, ref);
    });

    test("not ready before period closes", () => {
        const bb = new BollingerBands(period, multiplier);
        const frames = makeFrames(closes.slice(0, 3), closes.slice(0, 3));
        for (const f of frames) bb.update(f);
        expect(bb.ready).toBe(false);
        expect(Number.isNaN(bb.value)).toBe(true);
        expect(bb.upper).toBe(0);
        expect(bb.lower).toBe(0);
    });

    test("constant prices: upper=lower=middle=constant", () => {
        const n = period + 2;
        const c = Array(n).fill(7);
        const ref = bbRef(c, period, multiplier);
        const frames = makeFrames(c, c);
        const bb = new BollingerBands(period, multiplier);
        assertBarByBar(bb, frames, ref);
    });

    test("configured source is precomputed and shared with nested StandardDeviation", () => {
        const bb = new BollingerBands(5, 2, { source: "high" });
        const highs = [10, 11, 12, 13, 14];
        const frames = highs.map((high, i) => {
            const frame = new Frame();
            expect(frame.load({
                symbol: "TEST", time: i, open: 10, high, low: 10, close: 10, volume: 1
            })).toBe(true);
            return frame;
        });
        for (const frame of frames) bb.update(frame);
        expect(bb.sourceField).toBe("h");
        expect(bb._stddev.sourceField).toBe("h");
        expect(bb.value).toBe(12);
        expect(bb.upper).toBeCloseTo(12 + 2 * Math.sqrt(2), 10);
    });

    test("reset rebuilds state", () => {
        const bb = new BollingerBands(period, multiplier);
        const frames = makeFrames(closes, closes);
        for (let i = 0; i < 4; i++) bb.update(frames[i]);
        bb.reset();
        expect(bb.ready).toBe(false);
        expect(Number.isNaN(bb.value)).toBe(true);
        expect(bb.count).toBe(0);
    });

    test("setPeriod rebuilds and reseed matches", () => {
        const bb = new BollingerBands(period, multiplier);
        const frames = makeFrames(closes, closes);
        for (const f of frames) bb.update(f);
        const first = bb.value;
        bb.setPeriod(period);
        bb.reseed(storeFrom(frames), new Frame());
        expect(Math.abs(bb.value - first)).toBeLessThanOrEqual(1e-9);
    });

    test("invalid period throws", () => {
        expect(() => new BollingerBands(0, multiplier)).toThrow();
    });

    test("technicalindicators BBANDS cross-check (population SD)", () => {
        const result = ti.BollingerBands.calculate({ period, values: closes, stdDev: multiplier });
        const tiLast = result.filter(r => r && Number.isFinite(r.middle)).pop();
        expect(Number.isFinite(tiLast.middle)).toBe(true);
        const bb = new BollingerBands(period, multiplier);
        const frames = makeFrames(closes, closes);
        let mine = {};
        for (const f of frames) { bb.update(f); mine = { value: bb.value, upper: bb.upper, lower: bb.lower }; }
        expect(Math.abs(mine.value - tiLast.middle)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(mine.upper - tiLast.upper)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(mine.lower - tiLast.lower)).toBeLessThanOrEqual(1e-6);
    });
});
