"use strict";

// Reference: Fibonacci Retracement
// Source family: Fibonacci retracement levels (classical technical analysis).
// Convention (selected): retracement of an upswing from swing low to swing high, measured down from the high.
//   diff = high - low
//   levels: 0 -> high, 23.6 -> high - 0.236*diff, 38.2, 50, 61.8, 78.6, 100 -> low
//   deterministic input: explicit high and low prices.
// Warm-up: none; ready immediately after calculate().
// Independent implementation: plain arithmetic; does not copy the registry algorithm.
const FIB_LEVELS = [0, 23.6, 38.2, 50, 61.8, 78.6, 100];
function fibonacciCalculate(high, low) {
    const diff = high - low;
    const levels = [];
    for (const level of FIB_LEVELS) {
        levels.push({ level, price: high - diff * (level / 100) });
    }
    return levels;
}
function fibonacci(pricesOrHigh, lowOrUndefined) {
    // Supports two call styles:
    //   fibonacci(high, low)        -> { levels, ready }
    //   fibonacci(candles)          -> { levels, ready } using highestHigh/lowestLow
    let high, low;
    if (Array.isArray(pricesOrHigh)) {
        const candles = pricesOrHigh;
        if (candles.length === 0) return { levels: [], ready: false };
        let highestHigh = -Infinity;
        let lowestLow = Infinity;
        for (const c of candles) {
            if (c.high > highestHigh) highestHigh = c.high;
            if (c.low < lowestLow) lowestLow = c.low;
        }
        high = highestHigh;
        low = lowestLow;
    } else {
        high = pricesOrHigh;
        low = lowOrUndefined;
    }
    const levels = fibonacciCalculate(high, low);
    return { levels, ready: true };
}
module.exports = fibonacci;
module.exports.Fibonacci = fibonacci;
module.exports.calculate = fibonacciCalculate;
