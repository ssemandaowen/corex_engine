"use strict";

// Reference: True Strength Index (TSI)
// Source family: William Blau, TSI.
// Convention (selected):
//   diff = price_t - price_(t-1); absDiff = |diff|
//   double-smooth both streams with EMA(longPeriod), then EMA(shortPeriod).
//   Each EMA is seeded with its first input value (not an SMA seed).
//   TSI = 100 * smoothedDiff / smoothedAbsDiff; zero denominator => 0.
// Warm-up: ready after the first price change because both first-value-seeded EMA stages
// have a defined value immediately. This is a documented early-output convention.
// Independent implementation: plain loops over price differences.
function tsi(prices, shortPeriod, longPeriod) {
    if (!Array.isArray(prices)) throw new Error("tsi: prices must be an array");
    if (!Number.isInteger(shortPeriod) || shortPeriod < 1) throw new Error("tsi: shortPeriod must be a positive integer");
    if (!Number.isInteger(longPeriod) || longPeriod < 1) throw new Error("tsi: longPeriod must be a positive integer");

    const diffs = [];
    const absDiffs = [];
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        diffs.push(change);
        absDiffs.push(Math.abs(change));
    }

    function doubleEma(values) {
        const longMultiplier = 2 / (longPeriod + 1);
        const shortMultiplier = 2 / (shortPeriod + 1);
        const longValues = [];
        let longValue = null;
        for (let i = 0; i < values.length; i++) {
            longValue = longValue === null
                ? values[i]
                : values[i] * longMultiplier + longValue * (1 - longMultiplier);
            longValues.push(longValue);
        }
        const shortValues = [];
        let shortValue = null;
        for (let i = 0; i < longValues.length; i++) {
            shortValue = shortValue === null
                ? longValues[i]
                : longValues[i] * shortMultiplier + shortValue * (1 - shortMultiplier);
            shortValues.push(shortValue);
        }
        return shortValues;
    }

    const smoothedDiff = doubleEma(diffs);
    const smoothedAbsDiff = doubleEma(absDiffs);
    const series = [];
    let value = null;
    let ready = false;

    for (let i = 0; i < diffs.length; i++) {
        if (smoothedAbsDiff[i] === 0) {
            value = 0;
        } else {
            value = 100 * smoothedDiff[i] / smoothedAbsDiff[i];
        }
        ready = true;
        series.push(value);
    }

    return { value, ready, series, shortPeriod, longPeriod };
}

module.exports = tsi;
module.exports.TSI = tsi;
