"use strict";

// Reference: Kaufman's Adaptive Moving Average (KAMA)
// Source family: Perry Kaufman, Adaptive Moving Average.
// Formula:
//   ER_t = |price_t - price_{t-period}| / sum_{i=1}^{period} |price_{t-i+1} - price_{t-i}|   (efficiency ratio, over period+1 prices)
//   fastestSC = 2/(nFast+1); slowestSC = 2/(nSlow+1)
//   SC_t = (ER_t * (fastestSC - slowestSC) + slowestSC)^2   (smoothing constant, squared)
//   seed = SMA of first `period` prices
//   KAMA_t = KAMA_{t-1} + SC_t * (price_t - KAMA_{t-1})
// Convention: if volatility (denominator of ER) is 0, ER = 1.
// Warm-up: ready once `period + 1` prices observed (seed at period, first adaptive at period+1).
// Independent implementation: plain loops over an input array.
function kama(prices, period, nFast, nSlow) {
    if (!Array.isArray(prices)) throw new Error("kama: prices must be an array");
    if (!period || period < 1) throw new Error("kama: period must be >= 1");
    if (!nFast || nFast < 1) throw new Error("kama: nFast must be >= 1");
    if (!nSlow || nSlow < 1) throw new Error("kama: nSlow must be >= 1");
    const fastestSC = 2 / (nFast + 1);
    const slowestSC = 2 / (nSlow + 1);
    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < prices.length; i++) {
        if (!ready) {
            if (i + 1 === period) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += prices[j];
                value = sum / period;
                ready = true;
            } else {
                value = null;
            }
        } else {
            const start = i - period;
            const direction = Math.abs(prices[i] - prices[start]);
            let volatility = 0;
            for (let j = start + 1; j <= i; j++) {
                volatility += Math.abs(prices[j] - prices[j - 1]);
            }
            const er = volatility === 0 ? 1 : direction / volatility;
            const sc = Math.pow(er * (fastestSC - slowestSC) + slowestSC, 2);
            value = value + sc * (prices[i] - value);
        }
        series.push(value);
    }
    return { value, ready, series, period, nFast, nSlow };
}
module.exports = kama;
module.exports.kama = kama;
