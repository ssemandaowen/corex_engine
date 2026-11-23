"use strict";

// Reference: Weighted Moving Average (WMA)
// Source family: classical linearly weighted moving average.
// Formula: WMA_t = (sum_{i=0}^{period-1} (i+1) * price_{t-i}) / (sum_{i=1}^{period} i)
//          oldest price in window has weight 1, newest has weight `period`.
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function wma(prices, period) {
    if (!Array.isArray(prices)) throw new Error("wma: prices must be an array");
    if (!period || period < 1) throw new Error("wma: period must be >= 1");
    const weightSum = (period * (period + 1)) / 2;
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let sum = 0;
            for (let j = 0; j < period; j++) sum += prices[start + j] * (j + 1);
            value = sum / weightSum;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period, weightSum };
}
module.exports = wma;
module.exports.wma = wma;
