"use strict";

// Reference: On-Balance Volume (OBV)
// Source family: Joseph Granville, OBV.
// Convention (selected): start at zero; for each bar after the first,
//   close up -> OBV += current volume; close down -> OBV -= current volume;
//   unchanged close -> OBV unchanged. Non-positive volume contributes zero.
// Warm-up: ready after the first close establishes the comparison baseline.
// Independent implementation: plain loops over input arrays.
function obv(closes, volumes) {
    if (!Array.isArray(closes) || !Array.isArray(volumes)) {
        throw new Error("obv: closes and volumes must be arrays");
    }
    const series = [];
    let value = 0;
    let ready = false;
    let prevClose = null;
    for (let i = 0; i < closes.length; i++) {
        const vol = volumes[i] > 0 ? volumes[i] : 0;
        if (prevClose === null) {
            prevClose = closes[i];
            ready = true;
        } else {
            if (closes[i] > prevClose) value += vol;
            else if (closes[i] < prevClose) value -= vol;
            prevClose = closes[i];
        }
        series.push(value);
    }
    return { value, ready, series };
}

module.exports = obv;
module.exports.OBV = obv;
