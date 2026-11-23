"use strict";

// Reference: Momentum (rate of change in price units)
// Source family: classical momentum oscillator.
// Formula: Momentum_t = price_t - price_{t-(period-1)}
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function momentum(prices, period) {
    if (!Array.isArray(prices)) throw new Error("momentum: prices must be an array");
    if (!period || period < 1) throw new Error("momentum: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 >= period) {
            value = prices[i] - prices[i - (period - 1)];
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = momentum;
module.exports.momentum = momentum;
