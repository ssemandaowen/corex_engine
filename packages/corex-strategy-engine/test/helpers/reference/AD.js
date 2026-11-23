"use strict";

// Reference: Accumulation / Distribution (AD)
// Source family: Marc Chaikin, Accumulation/Distribution Line.
// Convention (selected):
//   moneyFlowMultiplier = ((close - low) - (high - close)) / (high - low); 0 if range === 0
//   moneyFlowVolume = moneyFlowMultiplier * volume
//   AD = cumulative sum of moneyFlowVolume
// Warm-up: ready after the first bar.
// Independent implementation: plain loops over input arrays.
function ad(highs, lows, closes, volumes) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
        throw new Error("ad: highs/lows/closes/volumes must be arrays");
    }
    const n = highs.length;
    const series = [];
    let value = 0;
    let ready = false;
    for (let i = 0; i < n; i++) {
        const range = highs[i] - lows[i];
        let mfm = 0;
        if (range !== 0) {
            mfm = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
        }
        value += mfm * volumes[i];
        ready = true;
        series.push(value);
    }
    return { value, ready, series };
}
module.exports = ad;
module.exports.AD = ad;
