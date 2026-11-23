"use strict";

// Reference: Chaikin Money Flow (CMF)
// Source family: Marc Chaikin, CMF.
// Convention (selected):
//   moneyFlowMultiplier = ((close - low) - (high - close)) / (high - low); 0 if range === 0
//   moneyFlowVolume = moneyFlowMultiplier * volume
//   CMF = sum(moneyFlowVolume over period) / sum(volume over period)
//   if sum(volume) === 0, CMF = 0
// Warm-up: ready once `period` bars observed.
// Independent implementation: plain loops over input arrays.
function cmf(highs, lows, closes, volumes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
        throw new Error("cmf: highs/lows/closes/volumes must be arrays");
    }
    if (!period || period < 1) throw new Error("cmf: period must be >= 1");
    const n = highs.length;
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < n; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let sumMFV = 0;
            let sumVol = 0;
            for (let j = start; j <= i; j++) {
                const range = highs[j] - lows[j];
                let mfm = 0;
                if (range !== 0) {
                    mfm = ((closes[j] - lows[j]) - (highs[j] - closes[j])) / range;
                }
                const mfv = mfm * volumes[j];
                sumMFV += mfv;
                sumVol += volumes[j];
            }
            if (sumVol === 0) {
                value = 0;
            } else {
                value = sumMFV / sumVol;
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = cmf;
module.exports.CMF = cmf;
