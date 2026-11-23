"use strict";

// Reference: Anchored VWAP
// Source family: anchored VWAP (VWAP reset at a chosen anchor bar).
// Convention (selected): anchor is an explicit zero-based index into the input arrays.
//   Accumulate only positive volume at bars from anchorIndex onward.
//   Before the anchor, and while no positive volume has accumulated, value is null.
// Warm-up: ready after the first positive-volume bar at/after the anchor.
// Independent implementation: plain loops over input arrays.
function anchoredVWAP(prices, volumes, anchorIndex) {
    if (!Array.isArray(prices) || !Array.isArray(volumes)) {
        throw new Error("anchoredVWAP: prices and volumes must be arrays");
    }
    const n = prices.length;
    const start = anchorIndex === undefined ? 0 : anchorIndex;
    if (!Number.isInteger(start) || start < 0 || start >= n) {
        throw new Error("anchoredVWAP: anchorIndex out of range");
    }
    const series = [];
    let totalVolume = 0;
    let weightedPrice = 0;
    let value = null;
    let ready = false;
    for (let i = 0; i < n; i++) {
        if (i >= start) {
            const vol = volumes[i] > 0 ? volumes[i] : 0;
            if (vol > 0) {
                weightedPrice += prices[i] * vol;
                totalVolume += vol;
            }
        }
        if (totalVolume > 0) {
            value = weightedPrice / totalVolume;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, anchorIndex: start };
}

module.exports = anchoredVWAP;
module.exports.AnchoredVWAP = anchoredVWAP;
