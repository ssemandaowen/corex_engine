"use strict";

// Reference: Ease of Movement (EoM / EMV)
// Source family: Richard Arms, Ease of Movement.
// Convention (selected):
//   midpointMove = ((high_t + low_t) - (high_prev + low_prev)) / 2
//   boxRatio = volume / (high-low) / scale
//   EMV = midpointMove / boxRatio = midpointMove * (high-low) * scale / volume
//   EoM = simple mean of the last period valid EMV values.
//   Zero range with zero midpoint movement contributes 0; non-positive volume is undefined.
// Warm-up: period valid EMV values, requiring period+1 bars.
// Independent implementation: plain loops over input arrays.
function eom(highs, lows, volumes, period, scale = 10000) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(volumes)) {
        throw new Error("eom: highs/lows/volumes must be arrays");
    }
    if (!Number.isInteger(period) || period < 1) throw new Error("eom: period must be a positive integer");
    if (!(scale > 0)) throw new Error("eom: scale must be positive");

    const emvValues = [];
    const series = [];
    let value = null;
    let ready = false;

    for (let i = 0; i < highs.length; i++) {
        if (i === 0) {
            emvValues.push(null);
            series.push(null);
            continue;
        }

        const midpointMove = ((highs[i] + lows[i]) - (highs[i - 1] + lows[i - 1])) / 2;
        const range = highs[i] - lows[i];
        const volume = volumes[i];
        let emv = null;
        if (range === 0 && midpointMove === 0) emv = 0;
        else if (range > 0 && volume > 0) emv = midpointMove * range * scale / volume;

        emvValues.push(emv);
        const start = Math.max(1, emvValues.length - period);
        let sum = 0;
        let count = 0;
        for (let j = start; j < emvValues.length; j++) {
            if (emvValues[j] !== null) {
                sum += emvValues[j];
                count += 1;
            }
        }
        if (count === period) {
            value = sum / period;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }

    return { value, ready, series, period, scale };
}

module.exports = eom;
module.exports.EoM = eom;
