"use strict";

// Reference: Linear Regression (least-squares fit over a lookback window)
// Source family: classical linear regression / least squares.
// Formula: fit y = a + b*x over x = 1..period and the last `period` prices;
//          b = (n*sumXY - sumX*sumY) / (n*sumXX - sumX*sumX);
//          a = (sumY - b*sumX) / n;
//          reported value = fitted value at the last point, a + b*n.
// Convention: if denominator is ~0 (constant window), value = last price.
// Warm-up: ready once `period` prices observed.
// Independent implementation: plain loops over an input array.
function linearRegression(prices, period) {
    if (!Array.isArray(prices)) throw new Error("linearRegression: prices must be an array");
    if (!period || period < 2) throw new Error("linearRegression: period must be >= 2");
    const n = period;
    const series = [];
    let value = null;
    let ready = false;
    let slope = 0;
    let intercept = 0;
    for (let i = 0; i < prices.length; i++) {
        if (i + 1 >= n) {
            const start = i - n + 1;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (let k = 0; k < n; k++) {
                const x = k + 1;
                const y = prices[start + k];
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumXX += x * x;
            }
            const denominator = n * sumXX - sumX * sumX;
            if (Math.abs(denominator) < 1e-12) {
                value = prices[i];
                slope = 0;
                intercept = prices[i];
            } else {
                slope = (n * sumXY - sumX * sumY) / denominator;
                intercept = (sumY - slope * sumX) / n;
                value = intercept + slope * n;
            }
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }
    return { value, ready, series, period, slope, intercept };
}
module.exports = linearRegression;
module.exports.linearRegression = linearRegression;
