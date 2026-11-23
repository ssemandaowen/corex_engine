"use strict";

const Frame = require("../../../src/kernel/Frame");
const DonchianChannels = require("../../../src/indicators/donchian_channels");
const ref = require("../../helpers/reference/DonchianChannels");
const { buildFixture, framesFrom, storeFrom } = require("./fixture");

function assertParity(indicator, frames, expected) {
    for (let i = 0; i < frames.length; i++) {
        indicator.update(frames[i]);
        const row = expected.series[i];
        expect(indicator.ready).toBe(row.ready);
        if (row.ready) expect(indicator.value).toBeCloseTo(row.value, 9);
        else expect(Number.isNaN(indicator.value)).toBe(true);
        expect(indicator.upper).toBeCloseTo(row.upper, 9);
        expect(indicator.lower).toBeCloseTo(row.lower, 9);
    }
}

describe("DonchianChannels (Frame-based, monotonic deque)", () => {
    const period = 5;
    const highs = [13, 14, 12, 11, 10, 9, 11, 12, 13, 14];
    const lows = [11, 12, 10, 9, 8, 7, 9, 10, 11, 12];
    const closes = [12, 13, 11, 10, 9, 8, 10, 11, 12, 13];

    test("hand-worked example: reference parity on each bar", () => {
        const frames = framesFrom(highs, lows, closes, closes);
        const expected = ref(highs, lows, closes, period);
        assertParity(new DonchianChannels(period), frames, expected);
    });

    test("64-bar deterministic fixture parity", () => {
        const data = buildFixture(64);
        const frames = framesFrom(data.highs, data.lows, data.closes, data.opens);
        const expected = ref(data.highs, data.lows, data.closes, period);
        assertParity(new DonchianChannels(period), frames, expected);
    });

    test("reset and reseed reproduce the same output", () => {
        const frames = framesFrom(highs, lows, closes, closes);
        const indicator = new DonchianChannels(period);
        for (const frame of frames) indicator.update(frame);
        const before = indicator.value;
        indicator.reset();
        expect(indicator.ready).toBe(false);
        indicator.reseed(storeFrom(frames), new Frame());
        expect(indicator.value).toBeCloseTo(before, 9);
    });

    test("invalid period rejected", () => {
        expect(() => new DonchianChannels(0)).toThrow();
        expect(() => new DonchianChannels(2.5)).toThrow();
    });
});
