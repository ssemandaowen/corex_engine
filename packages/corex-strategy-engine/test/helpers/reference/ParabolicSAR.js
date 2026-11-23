"use strict";

// Reference: Parabolic SAR (Wilder)
// Source family: J. Welles Wilder Jr., Parabolic Time/Price System.
// Convention (selected): infer initial direction from the first two closes
// (up when close[1] >= close[0]); seed SAR at first low/high and EP at first
// high/low. Each new SAR is clamped to the prior two lows (uptrend) or highs
// (downtrend); reversals reset SAR to the prior EP and AF to step.
// Warm-up: direction is known after two bars; first output is at bar 1.
// Independent implementation: direct scalar recurrence.
function parabolicSAR(highs, lows, closes, step = 0.02, maxStep = 0.2) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("parabolicSAR: highs/lows/closes must be arrays");
    }
    if (highs.length !== lows.length || highs.length !== closes.length) {
        throw new Error("parabolicSAR: input arrays must have equal length");
    }
    if (!(step > 0) || !(maxStep >= step)) throw new Error("parabolicSAR: invalid acceleration factors");

    const series = [];
    let value = null;
    let ready = false;
    if (highs.length === 0) return { value, ready, series };

    series.push(null);
    if (highs.length < 2) return { value, ready, series };

    let long = closes[1] >= closes[0];
    let af = step;
    let ep = long ? highs[0] : lows[0];
    value = long ? lows[0] : highs[0];
    ready = true;

    for (let i = 1; i < highs.length; i++) {
        let sar = value + af * (ep - value);
        if (long) {
            sar = Math.min(sar, lows[i - 1]);
            if (i >= 2) sar = Math.min(sar, lows[i - 2]);
            if (lows[i] < sar) {
                long = false;
                sar = ep;
                ep = lows[i];
                af = step;
            } else if (highs[i] > ep) {
                ep = highs[i];
                af = Math.min(af + step, maxStep);
            }
        } else {
            sar = Math.max(sar, highs[i - 1]);
            if (i >= 2) sar = Math.max(sar, highs[i - 2]);
            if (highs[i] > sar) {
                long = true;
                sar = ep;
                ep = highs[i];
                af = step;
            } else if (lows[i] < ep) {
                ep = lows[i];
                af = Math.min(af + step, maxStep);
            }
        }
        value = sar;
        series.push(value);
    }

    return { value, ready, series, step, maxStep };
}

module.exports = parabolicSAR;
module.exports.ParabolicSAR = parabolicSAR;
