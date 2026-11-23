"use strict";

// Reference: Vortex Indicator
// Source family: Etienne Botes and Douglas Siepman, Vortex Indicator.
// Convention (selected): classical Vortex.
//   VMplus = |high_t - low_(t-1)|; VMminus = |low_t - high_(t-1)|
//   TR = max(high_t-low_t, |high_t-prevClose|, |low_t-prevClose|)
//   VI+ = sum(VMplus, period) / sum(TR, period)
//   VI- = sum(VMminus, period) / sum(TR, period)
//   If summed TR is zero, both indices are 0.
//   Reported scalar value is VI+; both VI+ and VI- are returned.
// Warm-up: period transitions, requiring period+1 bars.
// Independent implementation: straightforward window loops.
function vortex(highs, lows, closes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("vortex: highs/lows/closes must be arrays");
    }
    if (!Number.isInteger(period) || period < 1) throw new Error("vortex: period must be a positive integer");

    const series = [];
    let value = null;
    let viPlus = null;
    let viMinus = null;
    let ready = false;

    for (let i = 0; i < highs.length; i++) {
        if (i === 0) {
            series.push(null);
            continue;
        }
        const start = Math.max(1, i - period + 1);
        let sumPlus = 0;
        let sumMinus = 0;
        let sumTR = 0;
        let count = 0;
        for (let j = start; j <= i; j++) {
            const vmPlus = Math.abs(highs[j] - lows[j - 1]);
            const vmMinus = Math.abs(lows[j] - highs[j - 1]);
            const prevClose = closes[j - 1];
            const tr = Math.max(
                highs[j] - lows[j],
                Math.abs(highs[j] - prevClose),
                Math.abs(lows[j] - prevClose)
            );
            sumPlus += vmPlus;
            sumMinus += vmMinus;
            sumTR += tr;
            count += 1;
        }

        if (count === period) {
            viPlus = sumTR === 0 ? 0 : sumPlus / sumTR;
            viMinus = sumTR === 0 ? 0 : sumMinus / sumTR;
            value = viPlus;
            ready = true;
            series.push({ value, viPlus, viMinus, ready });
        } else {
            series.push(null);
        }
    }

    return { value, viPlus, viMinus, ready, series, period };
}

module.exports = vortex;
module.exports.Vortex = vortex;
