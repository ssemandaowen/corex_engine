"use strict";

// Reference: Money Flow Index (MFI)
// Source family: Gene Quong and Avrum Soudack, MFI.
// Convention (selected):
//   typicalPrice = (high + low + close) / 3
//   rawMoneyFlow_t = typicalPrice_t * positiveVolume_t, signed by the change in typicalPrice
//   MFI = 100 - 100 / (1 + sum(positiveFlow, period) / sum(abs(negativeFlow, period))
//   If summed negative flow is zero, MFI = 100; if summed positive flow is zero and negative flow exists, MFI = 0.
// Warm-up: period typical-price changes, requiring period+1 bars.
// Independent implementation: plain loops over the input OHLCV arrays.
function mfi(highs, lows, closes, volumes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
        throw new Error("mfi: highs/lows/closes/volumes must be arrays");
    }
    if (!Number.isInteger(period) || period < 1) throw new Error("mfi: period must be a positive integer");

    const typical = highs.map((high, i) => (high + lows[i] + closes[i]) / 3);
    const rawFlows = new Array(typical.length).fill(null);
    for (let i = 1; i < typical.length; i++) {
        const volume = volumes[i] > 0 ? volumes[i] : 0;
        const flow = typical[i] * volume;
        if (typical[i] > typical[i - 1]) rawFlows[i] = flow;
        else if (typical[i] < typical[i - 1]) rawFlows[i] = -flow;
        else rawFlows[i] = 0;
    }

    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < typical.length; i++) {
        if (i < period) {
            series.push(null);
            continue;
        }
        const start = i - period + 1;
        let positive = 0;
        let negative = 0;
        for (let j = start; j <= i; j++) {
            const flow = rawFlows[j];
            if (flow > 0) positive += flow;
            else if (flow < 0) negative -= flow;
        }
        if (negative === 0) value = 100;
        else if (positive === 0) value = 0;
        else value = 100 - 100 / (1 + positive / negative);
        ready = true;
        series.push(value);
    }
    return { value, ready, series, period };
}

module.exports = mfi;
module.exports.MFI = mfi;
