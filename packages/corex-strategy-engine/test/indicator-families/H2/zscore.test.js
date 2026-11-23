"use strict";

const Frame = require("../../../src/kernel/Frame");
const ZScore = require("../../../src/indicators/zscore");
const ref = require("../../helpers/reference/ZScore");
const { buildFixture, framesFrom, storeFrom } = require("./fixture");

function assertParity(indicator, frames, expected) {
    for (let i = 0; i < frames.length; i++) {
        indicator.update(frames[i]);
        if (expected.series[i] === null) {
            expect(indicator.ready).toBe(false);
            expect(Number.isNaN(indicator.value)).toBe(true);
        } else {
            expect(indicator.ready).toBe(true);
            expect(indicator.value).toBeCloseTo(expected.series[i], 9);
        }
    }
}

describe("ZScore (Frame-based, population standard deviation)", () => {
    const period = 5;
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 9, 11];

    test("hand-worked example: reference parity on each bar", () => {
        const frames = framesFrom(closes, closes, closes, closes);
        const expected = ref(closes, period);
        assertParity(new ZScore(period), frames, expected);
    });

    test("64-bar deterministic fixture parity", () => {
        const data = buildFixture(64);
        const frames = framesFrom(data.closes, data.closes, data.closes, data.closes);
        const expected = ref(data.closes, period);
        assertParity(new ZScore(period), frames, expected);
    });

    test("constant window has z-score zero", () => {
        const c = Array(8).fill(7);
        const frames = framesFrom(c, c, c, c);
        const expected = ref(c, period);
        const indicator = new ZScore(period);
        assertParity(indicator, frames, expected);
        expect(indicator.value).toBe(0);
    });

    test("configured source is respected", () => {
        const data = buildFixture(10);
        const frames = framesFrom(data.highs, data.lows, data.closes, data.opens);
        const expected = ref(data.highs, period);
        const indicator = new ZScore(period, { source: "high" });
        assertParity(indicator, frames, expected);
    });

    test("reset and reseed reproduce the same output", () => {
        const frames = framesFrom(closes, closes, closes, closes);
        const indicator = new ZScore(period);
        for (const frame of frames) indicator.update(frame);
        const before = indicator.value;
        indicator.reset();
        expect(indicator.ready).toBe(false);
        indicator.reseed(storeFrom(frames), new Frame());
        expect(indicator.value).toBeCloseTo(before, 9);
    });

    test("invalid period rejected", () => {
        expect(() => new ZScore(0)).toThrow();
        expect(() => new ZScore(2.5)).toThrow();
    });
});
