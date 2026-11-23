"use strict";

// Coppock Curve: WMA(wmaPeriod) of ROC(longPeriod)+ROC(shortPeriod).
// Canonical monthly settings are WMA(10), ROC(14), ROC(11); parameters are
// configurable here so a compact hand-check can use short periods.
function coppock(prices, wmaPeriod = 10, longPeriod = 14, shortPeriod = 11) {
    if (!Array.isArray(prices)) throw new Error("coppock: prices must be an array");
    for (const p of [wmaPeriod, longPeriod, shortPeriod]) {
        if (!Number.isInteger(p) || p < 1) throw new Error("coppock: periods must be positive integers");
    }
    const combined = new Array(prices.length).fill(null);
    const series = new Array(prices.length).fill(null);
    for (let i = 0; i < prices.length; i++) {
        const a = i >= longPeriod && prices[i - longPeriod] !== 0
            ? 100 * (prices[i] / prices[i - longPeriod] - 1) : null;
        const b = i >= shortPeriod && prices[i - shortPeriod] !== 0
            ? 100 * (prices[i] / prices[i - shortPeriod] - 1) : null;
        if (a !== null && b !== null) combined[i] = a + b;
        if (i >= wmaPeriod - 1 && combined.slice(i - wmaPeriod + 1, i + 1).every(Number.isFinite)) {
            let sum = 0, weight = 0;
            for (let j = 0; j < wmaPeriod; j++) {
                const w = j + 1;
                sum += combined[i - wmaPeriod + 1 + j] * w;
                weight += w;
            }
            series[i] = sum / weight;
        }
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, combined, wmaPeriod, longPeriod, shortPeriod };
}
module.exports = coppock;
module.exports.Coppock = coppock;
