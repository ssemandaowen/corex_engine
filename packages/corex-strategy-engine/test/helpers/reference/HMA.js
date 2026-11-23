"use strict";

// Reference: Hull Moving Average (HMA)
// Source family: Alan Hull's Hull Moving Average.
// Convention (selected): integer flooring for derived periods, mirroring the common
//   textbook construction:
//     halfPeriod = floor(period / 2)
//     sqrtPeriod = floor(sqrt(period))
//     diff = 2 * WMA(halfPeriod, price) - WMA(period, price)
//     HMA = WMA(sqrtPeriod, diff)
// Weights: oldest value in a WMA window has weight 1, newest has weight `p`.
// Warm-up: ready once both WMAs can fill a sqrtPeriod diff window.
// Independent implementation: plain loops over an input array.
function wmaOf(arr, endInclusive, p) {
    if (endInclusive + 1 < p) return null;
    const start = endInclusive - p + 1;
    let sum = 0;
    let wsum = 0;
    for (let k = 0; k < p; k++) {
        const w = k + 1;
        sum += arr[start + k] * w;
        wsum += w;
    }
    return sum / wsum;
}
function hma(prices, period) {
    if (!Array.isArray(prices)) throw new Error("hma: prices must be an array");
    if (!period || period < 1) throw new Error("hma: period must be >= 1");
    const half = Math.floor(period / 2);
    const sqrtP = Math.floor(Math.sqrt(period));
    if (half < 1) throw new Error("hma: period must be >= 2 for half period");
    const series = [];
    const diffs = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        const wmaFull = wmaOf(prices, i, period);
        const wmaHalf = wmaOf(prices, i, half);
        let diff = null;
        if (wmaFull !== null && wmaHalf !== null) {
            diff = 2 * wmaHalf - wmaFull;
        }
        diffs.push(diff);
        if (diffs.length >= sqrtP) {
            const win = diffs.slice(diffs.length - sqrtP);
            let allReady = true;
            for (let k = 0; k < sqrtP; k++) {
                if (win[k] === null) { allReady = false; break; }
            }
            if (allReady) {
                let sum = 0;
                let wsum = 0;
                for (let k = 0; k < sqrtP; k++) {
                    const w = k + 1;
                    sum += win[k] * w;
                    wsum += w;
                }
                value = sum / wsum;
                ready = true;
            } else {
                value = null;
            }
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period, half, sqrtP };
}
module.exports = hma;
module.exports.hma = hma;
