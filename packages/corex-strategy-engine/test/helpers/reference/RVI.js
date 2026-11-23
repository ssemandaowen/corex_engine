"use strict";

// Relative Vigor Index (classic four-bar weighted form). For each bar, smooth
// (close-open) and (high-low) with weights [1,2,2,1]/6, then divide.
// Signal is the same [1,2,2,1]/6 weighted average of the RVI line.
// The period argument is retained as an explicit generalized window; period=4
// is the published classic form. A zero smoothed range gives neutral 0.
function rvi(opens, highs, lows, closes, period = 4) {
    if (![opens, highs, lows, closes].every(Array.isArray) ||
        ![opens, highs, lows, closes].every(a => a.length === opens.length)) {
        throw new Error("rvi: equal-length OHLC arrays required");
    }
    if (!Number.isInteger(period) || period < 2) throw new Error("rvi: period must be >= 2");
    const weights = Array.from({ length: period }, (_, i) => Math.min(i + 1, period - i));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const raw = new Array(opens.length).fill(null), series = new Array(opens.length).fill(null), signal = new Array(opens.length).fill(null);
    for (let i = period - 1; i < opens.length; i++) {
        let num = 0, den = 0;
        for (let j = 0; j < period; j++) {
            const k = i - period + 1 + j;
            num += weights[j] * (closes[k] - opens[k]);
            den += weights[j] * (highs[k] - lows[k]);
        }
        raw[i] = den === 0 ? 0 : num / den;
        series[i] = raw[i];
        if (i >= 2 * period - 2) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += weights[j] * raw[i - period + 1 + j];
            signal[i] = sum / wsum;
        }
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, signal, period };
}
module.exports = rvi;
module.exports.RVI = rvi;
