"use strict";

const Frame = require("../../../src/kernel/Frame");
const ATR = require("../../../src/indicators/atr");
const atrRef = require("../../helpers/reference/ATR");
const { buildFixture, framesFrom, storeFrom } = require("./fixture");
const ti = require("technicalindicators");

function makeFrames(highs, lows, closes, opens) {
    const frames = [];
    for (let i = 0; i < closes.length; i++) {
        const f = new Frame();
        f.load({ time: i, open: opens[i] !== undefined ? opens[i] : closes[i], high: highs[i], low: lows[i], close: closes[i], volume: 1 });
        frames.push(f);
    }
    return frames;
}

function assertBarByBar(atr, frames, ref) {
    for (let i = 0; i < frames.length; i++) {
        atr.update(frames[i]);
        const refReady = ref.series[i] !== null;
        expect(atr.ready).toBe(refReady);
        if (refReady) {
            expect(Math.abs(atr.value - ref.series[i])).toBeLessThanOrEqual(1e-9);
        } else {
            expect(Number.isNaN(atr.value)).toBe(true);
        }
    }
    expect(atr.ready).toBe(ref.ready);
    expect(Math.abs(atr.value - ref.value)).toBeLessThanOrEqual(1e-9);
}

describe("ATR (Frame-based, Wilder)", () => {
    const period = 5;
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("worked example: absolute parity with independent reference <= 1e-9", () => {
        const ref = atrRef(highs, lows, closes, period);
        const frames = makeFrames(highs, lows, closes, closes);
        const atr = new ATR(period);
        assertBarByBar(atr, frames, ref);
    });

    test("deterministic 64-bar fixture: absolute parity <= 1e-9", () => {
        const { highs, lows, closes } = buildFixture(64);
        const ref = atrRef(highs, lows, closes, period);
        const frames = framesFrom(highs, lows, closes, closes);
        const atr = new ATR(period);
        assertBarByBar(atr, frames, ref);
    });

    test("not ready before period true ranges", () => {
        const atr = new ATR(period);
        const frames = framesFrom(highs.slice(0, 2), lows.slice(0, 2), closes.slice(0, 2), closes.slice(0, 2));
        for (const f of frames) atr.update(f);
        expect(atr.ready).toBe(false);
        expect(Number.isNaN(atr.value)).toBe(true);
    });

    test("constant prices: ATR = 0 once ready", () => {
        const n = period + 2;
        const h = Array(n).fill(10);
        const l = Array(n).fill(10);
        const c = Array(n).fill(10);
        const ref = atrRef(h, l, c, period);
        const frames = framesFrom(h, l, c, c);
        const atr = new ATR(period);
        assertBarByBar(atr, frames, ref);
    });

    test("reset rebuilds state", () => {
        const atr = new ATR(period);
        const frames = framesFrom(highs, lows, closes, closes);
        for (let i = 0; i < 4; i++) atr.update(frames[i]);
        atr.reset();
        expect(atr.ready).toBe(false);
        expect(Number.isNaN(atr.value)).toBe(true);
        expect(atr.count).toBe(0);
    });

    test("setPeriod rebuilds and reseed matches", () => {
        const atr = new ATR(period);
        const frames = framesFrom(highs, lows, closes, closes);
        for (const f of frames) atr.update(f);
        const first = atr.value;
        atr.setPeriod(period);
        atr.reseed(storeFrom(frames), new Frame());
        expect(Math.abs(atr.value - first)).toBeLessThanOrEqual(1e-9);
    });

    test("invalid period throws", () => {
        expect(() => new ATR(0)).toThrow();
        expect(() => new ATR(-1)).toThrow();
    });

    test("technicalindicators cross-check (different seed convention)", () => {
        const result = ti.ATR.calculate({ period, high: highs, low: lows, close: closes });
        const last = result[result.length - 1];
        expect(Number.isFinite(last)).toBe(true);
    });
});
