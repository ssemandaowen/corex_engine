"use strict";

// Reference: Chande Momentum Oscillator (CMO)
// Source family: Tushar Chande, CMO.
// Formula: over the last `period` price changes:
//   sumHigh = sum of positive changes; sumLow = sum of absolute negative changes
//   CMO = 100 * (sumHigh - sumLow) / (sumHigh + sumLow)
// Convention: if sumHigh + sumLow === 0, CMO = 0.
// Warm-up: ready once `period` changes observed (i.e. period+1 prices).
// Independent implementation: plain loops over an input array of prices.
function cmo(prices, period) {
    if (!Array.isArray(prices)) throw new Error("cmo: prices must be an array");
    if (!period || period < 1) throw new Error("cmo: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 1; i < prices.length; i++) {
        if (i >= period) {
            let sumHigh = 0;
            let sumLow = 0;
            for (let j = i - period + 1; j <= i; j++) {
                const change = prices[j] - prices[j - 1];
                if (change > 0) sumHigh += change;
                else sumLow += Math.abs(change);
            }
            const sum = sumHigh + sumLow;
            if (sum === 0) {
                value = 0;
            } else {
                value = 100 * ((sumHigh - sumLow) / sum);
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = cmo;
module.exports.CMO = cmo;
