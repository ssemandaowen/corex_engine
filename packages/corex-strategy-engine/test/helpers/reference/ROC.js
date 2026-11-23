"use strict";

// Reference: Rate of Change (ROC)
// Source family: classical momentum oscillator.
// Formula: ROC_t = ((price_t - price_{t-period}) / price_{t-period}) * 100
// Convention: if the reference price is 0, ROC is undefined (return null).
// Warm-up: ready once `period + 1` prices observed.
// Independent implementation: plain loops over an input array.
function roc(prices, period) {
    if (!Array.isArray(prices)) throw new Error("roc: prices must be an array");
    if (!period || period < 1) throw new Error("roc: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 > period) {
            const refPrice = prices[i - period];
            if (refPrice !== 0) {
                value = ((prices[i] - refPrice) / refPrice) * 100;
            } else {
                value = null;
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = roc;
module.exports.roc = roc;
