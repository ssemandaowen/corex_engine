"use strict";

// Reference: Exponential Moving Average (EMA)
// Source family: classical exponential smoothing (Wilder/EMA).
// Formula: seed = SMA of first `period` prices; multiplier = 2/(period+1);
//          EMA_t = price_t * multiplier + EMA_{t-1} * (1 - multiplier)
// Warm-up: seed computed at the `period`-th price; ready from then on.
// Independent implementation: plain loops over an input array.
function ema(prices, period) {
    if (!Array.isArray(prices)) throw new Error("ema: prices must be an array");
    if (!period || period < 1) throw new Error("ema: period must be >= 1");
    const multiplier = 2 / (period + 1);
    const series = [];
    let value = null;
    let ready = false;
    let prev = 0;
    for (let i = 0; i < prices.length; i++) {
        const p = prices[i];
        if (!ready) {
            if (i + 1 === period) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += prices[j];
                value = sum / period;
                prev = value;
                ready = true;
            } else {
                value = null;
            }
        } else {
            value = p * multiplier + prev * (1 - multiplier);
            prev = value;
        }
        series.push(value);
    }
    return { value, ready, series, period, multiplier };
}
module.exports = ema;
module.exports.ema = ema;
