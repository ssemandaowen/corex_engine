"use strict";

const Frame = require("../../../src/kernel/Frame");
const StandardDeviation = require("../../../src/indicators/stddev");
const stddevRef = require("../../helpers/reference/StandardDeviation");
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

function assertBarByBar(ind, frames, ref) {
    for (let i = 0; i < frames.length; i++) {
        ind.update(frames[i]);
        const refReady = ref.series[i] !== null;
        expect(ind.ready).toBe(refReady);
        if (refReady) {
            expect(Math.abs(ind.value - ref.series[i])).toBeLessThanOrEqual(1e-9);
        } else {
            expect(Number.isNaN(ind.value)).toBe(true);
        }
    }
    expect(ind.ready).toBe(ref.ready);
    expect(Math.abs(ind.value - ref.value)).toBeLessThanOrEqual(1e-9);
}

describe("StandardDeviation (Frame-based, population)", () => {
    const period = 5;
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("worked example: absolute parity with independent reference <= 1e-9", () => {
        const ref = stddevRef(closes, period);
        const frames = makeFrames(closes, closes);
        const sd = new StandardDeviation(period);
        assertBarByBar(sd, frames, ref);
    });

    test("deterministic 64-bar fixture: absolute parity <= 1e-9", () => {
        const { closes } = buildFixture(64);
        const ref = stddevRef(closes, period);
        const frames = framesFrom(closes, closes, closes, closes);
        const sd = new StandardDeviation(period);
        assertBarByBar(sd, frames, ref);
    });

    test("not ready before period prices", () => {
        const sd = new StandardDeviation(period);
        const frames = makeFrames(closes.slice(0, 3), closes.slice(0, 3));
        for (const f of frames) sd.update(f);
        expect(sd.ready).toBe(false);
        expect(Number.isNaN(sd.value)).toBe(true);
    });

    test("constant prices: stddev is 0", () => {
        const n = period + 2;
        const c = Array(n).fill(7);
        const ref = stddevRef(c, period);
        const frames = makeFrames(c, c);
        const sd = new StandardDeviation(period);
        assertBarByBar(sd, frames, ref);
    });

    test("period 1 yields 0 and is immediately ready", () => {
        const sd = new StandardDeviation(1);
        const frames = makeFrames([5, 6, 7], [5, 6, 7]);
        for (const f of frames) sd.update(f);
        expect(sd.ready).toBe(true);
        expect(sd.value).toBe(0);
    });

    test("reset rebuilds state", () => {
        const sd = new StandardDeviation(period);
        const frames = makeFrames(closes, closes);
        for (let i = 0; i < 4; i++) sd.update(frames[i]);
        sd.reset();
        expect(sd.ready).toBe(false);
        expect(Number.isNaN(sd.value)).toBe(true);
        expect(sd.count).toBe(0);
    });

    test("setPeriod rebuilds and reseed matches", () => {
        const sd = new StandardDeviation(period);
        const frames = makeFrames(closes, closes);
        for (const f of frames) sd.update(f);
        const first = sd.value;
        sd.setPeriod(period);
        sd.reseed(storeFrom(frames), new Frame());
        expect(Math.abs(sd.value - first)).toBeLessThanOrEqual(1e-9);
    });

    test("invalid period throws", () => {
        expect(() => new StandardDeviation(0)).toThrow();
        expect(() => new StandardDeviation(-1)).toThrow();
    });

    test("technicalindicators SD cross-check (population divisor)", () => {
        const result = ti.SD.calculate({ period, values: closes });
        const tiLast = result.filter(v => Number.isFinite(v)).pop();
        expect(Number.isFinite(tiLast)).toBe(true);
        const sd = new StandardDeviation(period);
        const frames = makeFrames(closes, closes);
        let mine = 0;
        for (const f of frames) { mine = sd.update(f); }
        expect(Math.abs(mine - tiLast)).toBeLessThanOrEqual(1e-6);
    });
});
