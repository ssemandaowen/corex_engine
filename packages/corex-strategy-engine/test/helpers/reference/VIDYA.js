"use strict";

// Chande CMO-driven VIDYA: alpha = 2/(period+1) * abs(CMO(period))/100.
// Seed with the SMA of the first period closes. CMO uses the last period
// close-to-close changes. This is the CMO variant; standard-deviation-ratio
// VIDYA is a separate published variant and is not silently conflated here.
function vidya(prices, period = 14) {
    if (!Array.isArray(prices)) throw new Error("vidya: prices must be an array");
    if (!Number.isInteger(period) || period < 1) throw new Error("vidya: period must be positive");
    const series = new Array(prices.length).fill(null);
    if (prices.length < period) return { value: null, ready: false, series, period };
    let value = 0;
    for (let i = 0; i < period; i++) value += prices[i];
    value /= period;
    series[period - 1] = value;
    const baseAlpha = 2 / (period + 1);
    for (let i = period; i < prices.length; i++) {
        let gains = 0, losses = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const change = prices[j] - prices[j - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        const total = gains + losses;
        const cmo = total === 0 ? 0 : (gains - losses) / total;
        const alpha = baseAlpha * Math.abs(cmo);
        value += alpha * (prices[i] - value);
        series[i] = value;
    }
    return { value, ready: true, series, period };
}
module.exports = vidya;
module.exports.VIDYA = vidya;
