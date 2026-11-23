"use strict";

// McGinley Dynamic: MD[t] = MD[t-1] + (P[t]-MD[t-1]) /
// (k * period * (P[t]/MD[t-1])^4). Seed with SMA(period).
function mcGinley(prices, period = 14, k = 0.6) {
    if (!Array.isArray(prices)) throw new Error("mcGinley: prices must be an array");
    if (!Number.isInteger(period) || period < 1 || !(k > 0)) throw new Error("mcGinley: invalid parameters");
    const series = new Array(prices.length).fill(null);
    if (prices.length < period) return { value: null, ready: false, series, period, k };
    let value = 0;
    for (let i = 0; i < period; i++) value += prices[i];
    value /= period;
    series[period - 1] = value;
    for (let i = period; i < prices.length; i++) {
        if (value === 0) throw new Error("mcGinley: previous dynamic value cannot be zero");
        const ratio = prices[i] / value;
        value += (prices[i] - value) / (k * period * Math.pow(ratio, 4));
        series[i] = value;
    }
    return { value, ready: true, series, period, k };
}
module.exports = mcGinley;
module.exports.McGinley = mcGinley;
