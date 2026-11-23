"use strict";

// Reference: Williams %R
// Source family: Larry Williams, Williams %R.
// Formula: %R = (highestHigh - close) / (highestHigh - lowestLow) * -100  over `period` bars
// Convention: if range === 0, %R = 0.
// Warm-up: ready once `period` bars observed.
// Independent implementation: plain loops over input arrays.
function williamsR(highs, lows, closes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("williamsR: highs/lows/closes must be arrays");
    }
    if (!period || period < 1) throw new Error("williamsR: period must be >= 1");
    const n = highs.length;
    const series = [];
    let value = 0;
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
            const range = highest - lowest;
            if (range === 0) {
                value = 0;
            } else {
                value = ((highest - closes[i]) / range) * -100;
            }
            ready = true;
        } else {
            value = 0;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = williamsR;
module.exports.WilliamsR = williamsR;
