"use strict";

// Reference: Donchian Channels
// Source family: Richard Donchian, Donchian Channels.
// Formula: over the last `period` bars:
//   upper = highest high; lower = lowest low; middle = (upper + lower) / 2
// Warm-up: ready once `period` bars observed.
// Independent implementation: plain loops over input arrays.
function donchianChannels(highs, lows, closes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("donchianChannels: highs/lows/closes must be arrays");
    }
    if (!period || period < 1) throw new Error("donchianChannels: period must be >= 1");
    const n = highs.length;
    const series = [];
    let value = 0;
    let upper = 0;
    let lower = 0;
    let ready = false;
    for (let i = 0; i < n; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let highest = highs[start];
            let lowest = lows[start];
            for (let j = start; j <= i; j++) {
                if (highs[j] > highest) highest = highs[j];
                if (lows[j] < lowest) lowest = lows[j];
            }
            upper = highest;
            lower = lowest;
            value = (highest + lowest) / 2;
            ready = true;
        } else {
            value = 0; upper = 0; lower = 0;
        }
        series.push({ value, upper, lower, ready });
    }
    return { value, upper, lower, ready, series, period };
}
module.exports = donchianChannels;
module.exports.DonchianChannels = donchianChannels;
