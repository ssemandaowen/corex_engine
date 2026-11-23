"use strict";

const smaRef = require("./SMA");
const stddevRef = require("./StandardDeviation");

// Reference: Bollinger Bands
// Source family: John Bollinger, Bollinger Bands.
// Convention (selected):
//   middle = SMA(close, period)
//   upper  = middle + multiplier * populationStdDev(close, period)
//   lower  = middle - multiplier * populationStdDev(close, period)
// Warm-up: ready once `period` closes observed.
// Independent implementation: plain loops over an input array.
function bollingerBands(prices, period, multiplier) {
    if (!Array.isArray(prices)) throw new Error("bollingerBands: prices must be an array");
    if (!period || period < 1) throw new Error("bollingerBands: period must be >= 1");
    if (multiplier === undefined) multiplier = 2;
    const n = prices.length;
    const series = [];
    let value = 0;
    let upper = 0;
    let lower = 0;
    let ready = false;
    for (let i = 0; i < n; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let sum = 0;
            for (let j = start; j <= i; j++) sum += prices[j];
            const mean = sum / period;
            let sumSq = 0;
            for (let j = start; j <= i; j++) {
                const d = prices[j] - mean;
                sumSq += d * d;
            }
            const sigma = Math.sqrt(sumSq / period);
            value = mean;
            upper = mean + multiplier * sigma;
            lower = mean - multiplier * sigma;
            ready = true;
        } else {
            value = 0; upper = 0; lower = 0;
        }
        series.push({ value, upper, lower, ready });
    }
    return { value, upper, lower, ready, series, period, multiplier };
}
module.exports = bollingerBands;
module.exports.BollingerBands = bollingerBands;
