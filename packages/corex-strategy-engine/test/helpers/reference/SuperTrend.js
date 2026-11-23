"use strict";

const atrRef = require("./ATR");

// Reference: SuperTrend
// Source family: SuperTrend indicator (Olivier Seban) built on Wilder ATR.
// Convention (selected):
//   basicUpper/Lower = HL2 +/- multiplier * ATR
//   On the first ATR-ready bar, initialize final bands to basic bands and choose
//   bullish direction unless close is below the lower band.
//   Later finalUpper = basicUpper if basicUpper < priorFinalUpper or priorClose > priorFinalUpper,
//   else priorFinalUpper. finalLower is symmetric.
//   Direction flips only when close crosses the active opposite band.
//   SuperTrend = finalLower in bullish direction, finalUpper in bearish direction.
// Warm-up: ATR must be ready; first SuperTrend value appears on that bar.
// Independent implementation: transparent loops; ATR comes from the separate ATR reference.
function supertrend(highs, lows, closes, period, multiplier = 3) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("supertrend: highs/lows/closes must be arrays");
    }
    if (!Number.isInteger(period) || period < 1) throw new Error("supertrend: period must be a positive integer");

    const series = [];
    let value = null;
    let ready = false;
    let prevClose = null;
    let prevFinalUpper = null;
    let prevFinalLower = null;
    let direction = 1;

    for (let i = 0; i < highs.length; i++) {
        const atr = atrRef(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), period);
        if (!atr.ready) {
            series.push(null);
            prevClose = closes[i];
            continue;
        }

        const midpoint = (highs[i] + lows[i]) / 2;
        const basicUpper = midpoint + multiplier * atr.value;
        const basicLower = midpoint - multiplier * atr.value;

        if (prevFinalUpper === null) {
            prevFinalUpper = basicUpper;
            prevFinalLower = basicLower;
            direction = closes[i] < basicLower ? -1 : 1;
        } else {
            const finalUpper = basicUpper < prevFinalUpper || prevClose > prevFinalUpper
                ? basicUpper
                : prevFinalUpper;
            const finalLower = basicLower > prevFinalLower || prevClose < prevFinalLower
                ? basicLower
                : prevFinalLower;

            if (direction === 1 && closes[i] < finalLower) direction = -1;
            else if (direction === -1 && closes[i] > finalUpper) direction = 1;

            prevFinalUpper = finalUpper;
            prevFinalLower = finalLower;
        }

        value = direction === 1 ? prevFinalLower : prevFinalUpper;
        ready = true;
        series.push(value);
        prevClose = closes[i];
    }

    return { value, ready, series, period, multiplier };
}

module.exports = supertrend;
module.exports.SuperTrend = supertrend;
