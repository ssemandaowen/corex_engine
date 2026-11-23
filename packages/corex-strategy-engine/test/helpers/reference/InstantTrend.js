"use strict";

// Ehlers Instantaneous Trendline (ITrend), recursive second-order form.
// I[t] = (a-a²/4)P[t] + (a²/2)P[t-1] - (a-3a²/4)P[t-2]
//       + 2(1-a)I[t-1] - (1-a)²I[t-2].
// Initialization: first two trend values equal their corresponding prices.
// This is the recursive ITrend filter, not the SMA-plus-smoothed-slope
// trendline variant also published under the same name.
function instantTrend(prices, alpha = 0.07) {
    if (!Array.isArray(prices)) throw new Error("instantTrend: prices must be an array");
    if (!(alpha > 0 && alpha <= 1)) throw new Error("instantTrend: alpha must be in (0,1]");
    const series = [];
    let value = null;
    for (let i = 0; i < prices.length; i++) {
        if (i < 2) value = prices[i];
        else {
            const a = alpha, a2 = a * a;
            value = (a - a2 / 4) * prices[i] + (a2 / 2) * prices[i - 1]
                - (a - 3 * a2 / 4) * prices[i - 2]
                + 2 * (1 - a) * series[i - 1] - Math.pow(1 - a, 2) * series[i - 2];
        }
        series.push(value);
    }
    return { value, ready: prices.length >= 3, series, alpha };
}
module.exports = instantTrend;
module.exports.InstantTrend = instantTrend;
