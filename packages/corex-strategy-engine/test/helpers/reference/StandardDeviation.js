"use strict";

// Reference: Standard Deviation (population) over a lookback window
// Source family: classical dispersion measure.
// Formula: sigma_t = sqrt( (1/period) * sum_{i=0}^{period-1} (price_{t-i} - mean)^2 )
//          population divisor (divides by period, not period-1).
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function stddev(prices, period) {
    if (!Array.isArray(prices)) throw new Error("stddev: prices must be an array");
    if (!period || period < 1) throw new Error("stddev: period must be >= 1");
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
            value = Math.sqrt(sumSq / period);
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = stddev;
module.exports.stddev = stddev;
