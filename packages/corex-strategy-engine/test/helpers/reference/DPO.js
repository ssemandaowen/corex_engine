"use strict";

// Detrended Price Oscillator: close shifted back by floor(period/2)+1 bars,
// minus the current period SMA. Values are emitted only once both inputs exist.
function dpo(prices, period = 20) {
    if (!Array.isArray(prices)) throw new Error("dpo: prices must be an array");
    if (!Number.isInteger(period) || period < 1) throw new Error("dpo: period must be positive");
    const shift = Math.floor(period / 2) + 1;
    const series = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        const sourceIndex = i - shift;
        if (sourceIndex < 0) continue;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += prices[j];
        series[i] = prices[sourceIndex] - sum / period;
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, period, shift };
}
module.exports = dpo;
module.exports.DPO = dpo;
