"use strict";

// Reference: Hurst Exponent
// Source family: Hurst exponent via Rescaled Range (R/S) analysis (Hurst, 1951).
// Convention (selected): single-window R/S estimator over `period` prices.
//   mean = average of window
//   deviations = price - mean
//   cumulative = running sum of deviations
//   range = max(cumulative) - min(cumulative)
//   stdDev = population standard deviation of window
//   H = log10(range / stdDev) / log10(period)
//   if stdDev === 0, H = 0.5
// NOTE: this is one named estimator (R/S with the full window as one segment); other
//   estimators (rescaled range with multiple lags, DFA, periodogram) can give different values.
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function hurst(prices, period) {
    if (!Array.isArray(prices)) throw new Error("hurst: prices must be an array");
    if (!period || period < 1) throw new Error("hurst: period must be >= 1");
    if (period < 2) throw new Error("hurst: period must be >= 2");
    const logPeriod = Math.log10(period);
    const series = [];
    let value = 0;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let sum = 0;
            for (let j = start; j <= i; j++) sum += prices[j];
            const mean = sum / period;
            const cumulative = [];
            let cum = 0;
            let maxCum = -Infinity;
            let minCum = Infinity;
            for (let j = start; j <= i; j++) {
                cum += prices[j] - mean;
                cumulative.push(cum);
                if (cum > maxCum) maxCum = cum;
                if (cum < minCum) minCum = cum;
            }
            const range = maxCum - minCum;
            let sumSq = 0;
            for (let j = start; j <= i; j++) {
                const d = prices[j] - mean;
                sumSq += d * d;
            }
            const stdDev = Math.sqrt(sumSq / period);
            if (stdDev === 0) {
                value = 0.5;
            } else {
                value = Math.log10(range / stdDev) / logPeriod;
            }
            ready = true;
        } else {
            value = 0;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = hurst;
module.exports.Hurst = hurst;
