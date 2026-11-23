"use strict";

// Sevcik waveform Fractal Dimension Index. Each period-close window is mapped
// to a unit square (time 0..1; price scaled min..max). Sum Euclidean segment
// lengths L, then FDI = 1 + (ln(L)+ln(2))/ln(2*(period-1)).
// This is the Sevcik estimator; Katz, Higuchi and Ehlers/FRAMA-style estimates
// are distinct variants and will produce different readings.
function fdi(prices, period = 30) {
    if (!Array.isArray(prices)) throw new Error("fdi: prices must be an array");
    if (!Number.isInteger(period) || period < 2) throw new Error("fdi: period must be >= 2");
    const series = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        const window = prices.slice(i - period + 1, i + 1);
        const min = Math.min(...window), max = Math.max(...window), range = max - min;
        let length = 0;
        for (let j = 1; j < period; j++) {
            const dx = 1 / (period - 1);
            const dy = range === 0 ? 0 : (window[j] - window[j - 1]) / range;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        const dimension = range === 0 ? 1 + Math.log(2) / Math.log(2 * (period - 1))
            : 1 + (Math.log(length) + Math.log(2)) / Math.log(2 * (period - 1));
        series[i] = Math.max(1, Math.min(2, dimension));
    }
    const value = series.length ? series[series.length - 1] : null;
    return { value, ready: value !== null, series, period };
}
module.exports = fdi;
module.exports.FDI = fdi;
