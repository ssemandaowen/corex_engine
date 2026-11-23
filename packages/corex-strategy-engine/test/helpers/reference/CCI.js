"use strict";

// Reference: Commodity Channel Index (CCI)
// Source family: Donald Lambert, CCI.
// Formula: typicalPrice = input (already typical price); SMA = mean of last `period` typical prices;
//          meanDev = mean of |typicalPrice - SMA| over window;
//          CCI = (typicalPrice - SMA) / (0.015 * meanDev)
// Convention: if meanDev is 0, CCI = 0.
// Warm-up: ready once `period` typical prices observed.
// Independent implementation: plain loops over an input array of typical prices.
function cci(typicalPrices, period) {
    if (!Array.isArray(typicalPrices)) throw new Error("cci: typicalPrices must be an array");
    if (!period || period < 1) throw new Error("cci: period must be >= 1");
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < typicalPrices.length; i++) {
        if (i + 1 >= period) {
            const start = i - period + 1;
            let sum = 0;
            for (let j = start; j <= i; j++) sum += typicalPrices[j];
            const sma = sum / period;
            let sumDev = 0;
            for (let j = start; j <= i; j++) sumDev += Math.abs(typicalPrices[j] - sma);
            const meanDev = sumDev / period;
            if (meanDev === 0) {
                value = 0;
            } else {
                value = (typicalPrices[i] - sma) / (0.015 * meanDev);
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = cci;
module.exports.CCI = cci;
