"use strict";

// Schaff Trend Cycle (selected standard construction): MACD(fast,slow),
// stochastic-normalize MACD over cyclePeriod, EMA-smooth; stochastic-normalize
// that first smoothed line over cyclePeriod again; EMA-smooth again.
// EMA seed is the first input value; zero stochastic range returns 0.
function emaSeries(values, period) {
    const alpha = 2 / (period + 1), out = [];
    let value = null;
    for (const x of values) {
        value = value === null ? x : alpha * x + (1 - alpha) * value;
        out.push(value);
    }
    return out;
}
function stc(prices, fastPeriod = 23, slowPeriod = 50, cyclePeriod = 10, smoothPeriod = 3) {
    if (!Array.isArray(prices)) throw new Error("stc: prices must be an array");
    if (![fastPeriod, slowPeriod, cyclePeriod, smoothPeriod].every(p => Number.isInteger(p) && p > 0) || fastPeriod >= slowPeriod) {
        throw new Error("stc: invalid periods");
    }
    const fast = emaSeries(prices, fastPeriod), slow = emaSeries(prices, slowPeriod);
    const macd = fast.map((v, i) => v - slow[i]);
    const stochastic = values => values.map((v, i) => {
        if (i + 1 < cyclePeriod) return null;
        const w = values.slice(i - cyclePeriod + 1, i + 1);
        if (w.some(x => x === null || !Number.isFinite(x))) return null;
        const lo = Math.min(...w), hi = Math.max(...w);
        return hi === lo ? 0 : 100 * (v - lo) / (hi - lo);
    });
    const k1 = stochastic(macd);
    const compact1 = k1.map((v, i) => v === null ? null : v);
    const smooth1 = new Array(prices.length).fill(null);
    let e1 = null;
    for (let i = 0; i < compact1.length; i++) {
        if (compact1[i] === null) continue;
        e1 = e1 === null ? compact1[i] : (2 / (smoothPeriod + 1)) * compact1[i] + (1 - 2 / (smoothPeriod + 1)) * e1;
        smooth1[i] = e1;
    }
    const k2 = stochastic(smooth1);
    const series = new Array(prices.length).fill(null);
    let e2 = null;
    for (let i = 0; i < prices.length; i++) {
        if (smooth1[i] === null || k2[i] === null) continue;
        e2 = e2 === null ? k2[i] : (2 / (smoothPeriod + 1)) * k2[i] + (1 - 2 / (smoothPeriod + 1)) * e2;
        series[i] = e2;
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, macd, k1, smooth1, k2, fastPeriod, slowPeriod, cyclePeriod, smoothPeriod };
}
module.exports = stc;
module.exports.STC = stc;
