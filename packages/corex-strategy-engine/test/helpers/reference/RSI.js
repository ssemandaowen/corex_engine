"use strict";

// Reference: Relative Strength Index (RSI)
// Source family: J. Welles Wilder Jr., RSI (Wilder smoothing).
// Convention (selected):
//   change = price_t - price_{t-1}; gain = max(change,0); loss = max(-change,0)
//   seed: avgGain = sum(gains)/period, avgLoss = sum(losses)/period over first `period` changes
//   RSI = 100 - 100/(1 + RS); RS = avgGain/avgLoss
//   avgLoss === 0 -> RSI = 100; avgGain === 0 -> RSI = 0
//   subsequent: avgGain = (avgGain*(period-1) + gain)/period; same for avgLoss
// Warm-up: ready once `period` changes observed (period+1 prices).
// Independent implementation: plain loops over an input array of prices.
function rsi(prices, period) {
    if (!Array.isArray(prices)) throw new Error("rsi: prices must be an array");
    if (!period || period < 1) throw new Error("rsi: period must be >= 1");
    const n = prices.length;
    const series = [];
    let value = 0;
    let ready = false;
    let prevClose = null;
    const gains = [];
    const losses = [];
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < n; i++) {
        if (prevClose === null) {
            prevClose = prices[i];
            series.push(null);
            continue;
        }
        const change = prices[i] - prevClose;
        prevClose = prices[i];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        if (!ready) {
            gains.push(gain);
            losses.push(loss);
            if (gains.length === period) {
                let sumGain = 0;
                let sumLoss = 0;
                for (let j = 0; j < period; j++) {
                    sumGain += gains[j];
                    sumLoss += losses[j];
                }
                avgGain = sumGain / period;
                avgLoss = sumLoss / period;
                if (avgLoss === 0) value = 100;
                else {
                    const rs = avgGain / avgLoss;
                    value = 100 - 100 / (1 + rs);
                }
                ready = true;
            } else {
                value = null;
            }
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            if (avgLoss === 0) value = 100;
            else if (avgGain === 0) value = 0;
            else {
                const rs = avgGain / avgLoss;
                value = 100 - 100 / (1 + rs);
            }
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = rsi;
module.exports.RSI = rsi;
