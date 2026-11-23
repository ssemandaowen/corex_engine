"use strict";

// Reference: Z-Score over a lookback window
// Source family: standard score (x - mean) / standard deviation.
// Formula: Z_t = (price_t - SMA_t(price)) / sigma_t(price), population stddev.
// Convention: if stddev is 0 (constant window), Z = 0.
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function zscore(prices, period) {
    if (!Array.isArray(prices)) throw new Error("zscore: prices must be an array");
    if (!period || period < 1) throw new Error("zscore: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
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
            if (sigma === 0) {
                value = 0;
            } else {
                value = (prices[i] - mean) / sigma;
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = zscore;
module.exports.zscore = zscore;
