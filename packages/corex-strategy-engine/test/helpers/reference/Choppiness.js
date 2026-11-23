"use strict";

// Reference: Choppiness Index (CI)
// Source family: E. W. Dreiss, Choppiness Index.
// Convention (selected):
//   For each bar in the rolling window, TR = max(high-low, |high-prevClose|, |low-prevClose|).
//   The first available bar uses high-low because no previous close exists.
//   CI = 100 * log10(sum(TR, period) / (highestHigh-lowestLow)) / log10(period).
//   If range or summed TR is zero, CI = 0.
// Warm-up: ready after period bars.
// Independent implementation: straightforward window loops.
function choppiness(highs, lows, closes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("choppiness: highs/lows/closes must be arrays");
    }
    if (!Number.isInteger(period) || period < 2) throw new Error("choppiness: period must be an integer >= 2");
    const n = highs.length;
    const series = [];
    let value = null;
    let ready = false;

    for (let i = 0; i < n; i++) {
        if (i + 1 < period) {
            series.push(null);
            continue;
        }
        const start = i - period + 1;
        let sumTR = 0;
        let highest = -Infinity;
        let lowest = Infinity;
        for (let j = start; j <= i; j++) {
            const prevClose = j === 0 ? null : closes[j - 1];
            const tr = prevClose === null
                ? highs[j] - lows[j]
                : Math.max(
                    highs[j] - lows[j],
                    Math.abs(highs[j] - prevClose),
                    Math.abs(lows[j] - prevClose)
                );
            sumTR += tr;
            if (highs[j] > highest) highest = highs[j];
            if (lows[j] < lowest) lowest = lows[j];
        }
        const range = highest - lowest;
        value = range === 0 || sumTR === 0
            ? 0
            : 100 * Math.log(sumTR / range) / Math.log(period);
        ready = true;
        series.push(value);
    }
    return { value, ready, series, period };
}

module.exports = choppiness;
module.exports.Choppiness = choppiness;
