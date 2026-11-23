"use strict";

const smaRef = require("./SMA");
const atrRef = require("./ATR");

// Reference: Keltner Channels
// Source family: Chester Keltner (classic), using SMA for the center line and ATR for the width.
// Convention (selected):
//   middle = SMA(close, period)
//   upper  = middle + multiplier * ATR(high, low, close, period)
//   lower  = middle - multiplier * ATR(high, low, close, period)
//   ATR uses Wilder seeding and smoothing.
// Warm-up: ready once ATR is ready (`period` true ranges) and SMA has `period` closes.
// Independent implementation: plain loops; ATR via the independent ATR reference.
function keltnerChannels(highs, lows, closes, period, multiplier) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("keltnerChannels: highs/lows/closes must be arrays");
    }
    if (!period || period < 1) throw new Error("keltnerChannels: period must be >= 1");
    if (multiplier === undefined) multiplier = 2;
    const n = highs.length;
    const series = [];
    let value = 0;
    let upper = 0;
    let lower = 0;
    let ready = false;
    for (let i = 0; i < n; i++) {
        if (i + 1 >= period) {
            const atrState = atrRef(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), period);
            const smaState = smaRef(closes.slice(0, i + 1), period);
            if (atrState.ready && smaState.ready) {
                const middle = smaState.value;
                value = middle;
                upper = middle + multiplier * atrState.value;
                lower = middle - multiplier * atrState.value;
                ready = true;
            } else {
                value = 0; upper = 0; lower = 0;
            }
        } else {
            value = 0; upper = 0; lower = 0;
        }
        series.push({ value, upper, lower, ready });
    }
    return { value, upper, lower, ready, series, period, multiplier };
}
module.exports = keltnerChannels;
module.exports.KeltnerChannels = keltnerChannels;
