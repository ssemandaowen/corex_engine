"use strict";

// Reference: Simple Moving Average (SMA)
// Source family: classical technical analysis (arithmetic mean over a lookback window).
// Formula: SMA_t = (1/period) * sum_{i=0}^{period-1} price_{t-i}
// Warm-up: not ready until `period` prices observed; value null before that.
// Independent implementation: plain loops over an input array. No incremental state.
function sma(prices, period) {
    if (!Array.isArray(prices)) throw new Error("sma: prices must be an array");
    if (!period || period < 1) throw new Error("sma: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 >= period) {
            let sum = 0;
            const start = i - period + 1;
            for (let j = start; j <= i; j++) sum += prices[j];
            value = sum / period;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = sma;
module.exports.sma = sma;
