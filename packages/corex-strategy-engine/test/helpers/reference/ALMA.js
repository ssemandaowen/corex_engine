"use strict";

// Arnaud Legoux Moving Average. Gaussian weights over the oldest-to-newest
// window: m=offset*(period-1), s=period/sigma, w[i]=exp(-(i-m)^2/(2s²)).
function alma(prices, period = 9, offset = 0.85, sigma = 6) {
    if (!Array.isArray(prices)) throw new Error("alma: prices must be an array");
    if (!Number.isInteger(period) || period < 1 || !(sigma > 0) || offset < 0 || offset > 1) {
        throw new Error("alma: invalid parameters");
    }
    const m = offset * (period - 1), s = period / sigma;
    const weights = [];
    let total = 0;
    for (let i = 0; i < period; i++) {
        const w = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
        weights.push(w); total += w;
    }
    for (let i = 0; i < period; i++) weights[i] /= total;
    const series = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        let value = 0;
        for (let j = 0; j < period; j++) value += prices[i - period + 1 + j] * weights[j];
        series[i] = value;
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, period, offset, sigma, weights };
}
module.exports = alma;
module.exports.ALMA = alma;
