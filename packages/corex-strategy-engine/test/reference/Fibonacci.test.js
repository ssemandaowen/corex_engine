"use strict";

const reference = require("../helpers/reference/Fibonacci");

describe("Fibonacci reference (independent, published definition)", () => {
    const candles = [
        { high: 100, low: 95 },
        { high: 105, low: 98 },
        { high: 110, low: 102 },
        { high: 108, low: 99 },
        { high: 115, low: 104 },
        { high: 120, low: 80 }
    ];

    test("hand-computed worked example: six-bar upswing retracement from low=80 to high=120", () => {
        // Across six candles, highestHigh=120 and lowestLow=80; diff=40.
        // The retracement is measured down from the swing high:
        //   0%    -> 120 - 0.000*40 = 120
        //   23.6% -> 120 - 0.236*40 = 110.56
        //   38.2% -> 120 - 0.382*40 = 104.72
        //   50%   -> 120 - 0.500*40 = 100
        //   61.8% -> 120 - 0.618*40 = 95.28
        //   78.6% -> 120 - 0.786*40 = 88.56
        //   100%  -> 120 - 1.000*40 = 80
        const result = reference(candles);
        expect(result.ready).toBe(true);
        expect(result.levels.length).toBe(7);
        expect(result.levels[0]).toEqual({ level: 0, price: 120 });
        expect(result.levels[6]).toEqual({ level: 100, price: 80 });
        expect(reference.calculate(120, 80)[4]).toEqual({ level: 61.8, price: 95.28 });
    });

    test("61.8% retracement is 95.28", () => {
        const fib = reference(candles);
        const found = fib.levels.find(level => level.level === 61.8);
        expect(found.price).toBeCloseTo(80 + (120 - 80) * 0.382, 10);
    });

    test("empty candles: not ready, empty levels", () => {
        const result = reference([]);
        expect(result.ready).toBe(false);
        expect(result.levels).toEqual([]);
    });
});
