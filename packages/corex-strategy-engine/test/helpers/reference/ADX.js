"use strict";

// Wilder Average Directional Index. True range includes the previous close;
// +DM/-DM use mutually exclusive directional high/low moves. Initial smoothed
// sums are sums of the first period transitions; later sums use Wilder's
// S[t]=S[t-1]-S[t-1]/n+x[t]. ADX seeds with the mean of period DX values,
// then uses (priorADX*(n-1)+DX)/n.
function adx(highs, lows, closes, period = 14) {
    if (![highs, lows, closes].every(Array.isArray) || highs.length !== lows.length || highs.length !== closes.length) {
        throw new Error("adx: equal-length high/low/close arrays required");
    }
    if (!Number.isInteger(period) || period < 1) throw new Error("adx: period must be positive");
    const n = highs.length, series = new Array(n).fill(null);
    const plusSeries = new Array(n).fill(null), minusSeries = new Array(n).fill(null), dxSeries = new Array(n).fill(null);
    if (n < period * 2) return { value: null, ready: false, series, plusSeries, minusSeries, dxSeries, period };
    const tr = [], plus = [], minus = [];
    for (let i = 1; i < n; i++) {
        const up = highs[i] - highs[i - 1], down = lows[i - 1] - lows[i];
        plus.push(up > down && up > 0 ? up : 0);
        minus.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    let sTR = 0, sP = 0, sM = 0;
    for (let j = 0; j < period; j++) { sTR += tr[j]; sP += plus[j]; sM += minus[j]; }
    const dx = [];
    for (let i = period; i < n; i++) {
        if (i > period) {
            const j = i - 1;
            sTR = sTR - sTR / period + tr[j];
            sP = sP - sP / period + plus[j];
            sM = sM - sM / period + minus[j];
        }
        const pdi = sTR === 0 ? 0 : 100 * sP / sTR;
        const mdi = sTR === 0 ? 0 : 100 * sM / sTR;
        plusSeries[i] = pdi; minusSeries[i] = mdi;
        const d = pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);
        dxSeries[i] = d; dx.push(d);
        if (dx.length === period) {
            let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
            series[i] = value;
            for (let k = period; k < dx.length; k++) {
                value = (value * (period - 1) + dx[k]) / period;
                series[period + k] = value;
            }
        } else if (dx.length > period) {
            const prev = series[i - 1];
            series[i] = (prev * (period - 1) + d) / period;
        }
    }
    const value = series[n - 1];
    return { value, ready: value !== null, series, plusSeries, minusSeries, dxSeries, period };
}
module.exports = adx;
module.exports.ADX = adx;
