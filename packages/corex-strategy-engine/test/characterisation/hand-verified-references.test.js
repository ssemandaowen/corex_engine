"use strict";

const Frame = require("../../src/kernel/Frame");
const SMA = require("../../src/indicators/sma");
const EMA = require("../../src/indicators/ema");
const WMA = require("../../src/indicators/wma");
const ATR = require("../../src/indicators/atr");
const RSI = require("../../src/indicators/rsi");
const smaRef = require("../helpers/reference/SMA");
const emaRef = require("../helpers/reference/EMA");
const wmaRef = require("../helpers/reference/WMA");
const atrRef = require("../helpers/reference/ATR");
const rsiRef = require("../helpers/reference/RSI");

function frames(closes, highs = closes, lows = closes) {
    return closes.map((close, i) => {
        const frame = new Frame();
        const open = close;
        if (!frame.load({
            symbol: "HAND",
            time: i,
            price: close,
            open,
            high: highs[i],
            low: lows[i],
            close,
            volume: 1
        })) throw new Error("Invalid hand-verification frame");
        return frame;
    });
}

function expectReferenceSeries(actual, expected) {
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
        if (expected[i] === null) expect(actual[i]).toBeNull();
        else expect(actual[i]).toBeCloseTo(expected[i], 10);
    }
}

function expectProductionSeries(actual, expected, preReadyNaN = true) {
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
        if (expected[i] === null) {
            if (preReadyNaN) expect(Number.isNaN(actual[i])).toBe(true);
        } else {
            expect(actual[i]).toBeCloseTo(expected[i], 10);
        }
    }
}

describe("five hand-verified matching references", () => {
    test("SMA(3): windows [10,12,11], [12,11,13], [11,13,12], [13,12,15]", () => {
        // Manual arithmetic: 33/3=11; 36/3=12; 36/3=12; 40/3=13.3333333333.
        const prices = [10, 12, 11, 13, 12, 15];
        const expected = [null, null, 11, 12, 12, 40 / 3];
        const reference = smaRef(prices, 3);
        const indicator = new SMA(3);
        const actual = frames(prices).map(frame => indicator.update(frame));
        expectReferenceSeries(reference.series, expected);
        expectProductionSeries(actual, expected);
    });

    test("EMA(3): SMA seed 11, then alpha=1/2 gives 12, 12, 13.5", () => {
        // Manual arithmetic: seed=(10+12+11)/3=11; next=13*.5+11*.5=12;
        // next=12*.5+12*.5=12; next=15*.5+12*.5=13.5.
        const prices = [10, 12, 11, 13, 12, 15];
        const expected = [null, null, 11, 12, 12, 13.5];
        const reference = emaRef(prices, 3);
        const indicator = new EMA(3);
        const actual = frames(prices).map(frame => indicator.update(frame));
        expectReferenceSeries(reference.series, expected);
        expectProductionSeries(actual, expected);
    });

    test("WMA(3): newest sample receives weight 3", () => {
        // Manual arithmetic: (10+24+33)/6=67/6; (12+22+39)/6=73/6;
        // (11+26+36)/6=73/6; (13+24+45)/6=82/6.
        const prices = [10, 12, 11, 13, 12, 15];
        const expected = [null, null, 67 / 6, 73 / 6, 73 / 6, 82 / 6];
        const reference = wmaRef(prices, 3);
        const indicator = new WMA(3);
        const actual = frames(prices).map(frame => indicator.update(frame));
        expectReferenceSeries(reference.series, expected);
        expectProductionSeries(actual, expected);
    });

    test("ATR(2): TR sequence 4,4,4,4,5 gives Wilder seed 4 then 4.5", () => {
        // Manual arithmetic: first bar only seeds previous close. TRs are 4,4,4,4,5.
        // First ATR=(4+4)/2=4; next ATR=(4+5)/2=4.5.
        const highs = [12, 14, 13, 15, 14, 17];
        const lows = [8, 10, 9, 11, 10, 13];
        const closes = [10, 12, 11, 13, 12, 15];
        const expected = [null, null, 4, 4, 4, 4.5];
        const reference = atrRef(highs, lows, closes, 2);
        const indicator = new ATR(2);
        const actual = frames(closes, highs, lows).map(frame => indicator.update(frame));
        expectReferenceSeries(reference.series, expected);
        expectProductionSeries(actual, expected);
    });

    test("RSI(3): seed averages 4/3 gain and 1/3 loss; Wilder updates to 61.538 and 81.132", () => {
        // Manual arithmetic: seed avgGain=4/3, avgLoss=1/3 => RSI=80.
        // Next avgGain=8/9, avgLoss=5/9 => RSI=61.5384615385.
        // Next avgGain=43/27, avgLoss=10/27 => RSI=81.1320754717.
        const prices = [10, 12, 11, 13, 12, 15];
        const expected = [null, null, null, 80, 61.53846153846154, 81.13207547169812];
        const reference = rsiRef(prices, 3);
        const indicator = new RSI(3);
        const actual = prices.map(price => indicator.update(price));
        expectReferenceSeries(reference.series, expected);
        expectProductionSeries(actual, expected, false);
    });
});