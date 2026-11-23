"use strict";

// Reference: Volume-Weighted Average Price (VWAP)
// Source family: classic VWAP.
// Formula: VWAP = sum(price * positiveVolume) / sum(positiveVolume).
// Convention: zero or negative volume contributes nothing; no positive volume => value is null.
// Warm-up: ready after the first bar with positive volume.
// Independent implementation: plain loops over input arrays.
function vwap(prices, volumes) {
    if (!Array.isArray(prices) || !Array.isArray(volumes)) {
        throw new Error("vwap: prices and volumes must be arrays");
    }
    const n = prices.length;
    const series = [];
    let totalVolume = 0;
    let weightedPrice = 0;
    let value = null;
    let ready = false;
    for (let i = 0; i < n; i++) {
        const vol = volumes[i] > 0 ? volumes[i] : 0;
        if (vol > 0) {
            weightedPrice += prices[i] * vol;
            totalVolume += vol;
        }
        if (totalVolume > 0) {
            value = weightedPrice / totalVolume;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series };
}

module.exports = vwap;
module.exports.VWAP = vwap;
