"use strict";

// Reference: Fisher Transform
// Source family: John Ehlers, Fisher Transform.
// Convention (selected):
//   normalize the current price within the rolling high/low window:
//     x = 0.33 * 2 * ((price-lowest)/(highest-lowest)-0.5) + 0.67*previousX
//   clamp x to [-0.999, 0.999]
//   Fisher = 0.5*ln((1+x)/(1-x)) + 0.5*previousFisher
//   A zero price range contributes x=0 before recursive smoothing.
// Warm-up: ready once period prices observed.
// Independent implementation: plain loops over an input array.
function fisher(prices, period) {
    if (!Array.isArray(prices)) throw new Error("fisher: prices must be an array");
    if (!Number.isInteger(period) || period < 1) throw new Error("fisher: period must be a positive integer");

    const series = [];
    let value = 0;
    let ready = false;
    let previousX = 0;
    let previousFisher = 0;

    for (let i = 0; i < prices.length; i++) {
        if (i + 1 < period) {
            series.push(null);
            continue;
        }
        const start = i - period + 1;
        let highest = prices[start];
        let lowest = prices[start];
        for (let j = start + 1; j <= i; j++) {
            if (prices[j] > highest) highest = prices[j];
            if (prices[j] < lowest) lowest = prices[j];
        }
        const range = highest - lowest;
        const raw = range === 0 ? 0 : 2 * ((prices[i] - lowest) / range - 0.5);
        let x = 0.33 * raw + 0.67 * previousX;
        if (x > 0.999) x = 0.999;
        if (x < -0.999) x = -0.999;
        value = 0.5 * Math.log((1 + x) / (1 - x)) + 0.5 * previousFisher;
        previousX = x;
        previousFisher = value;
        ready = true;
        series.push(value);
    }

    return { value, ready, series, period };
}

module.exports = fisher;
module.exports.Fisher = fisher;
