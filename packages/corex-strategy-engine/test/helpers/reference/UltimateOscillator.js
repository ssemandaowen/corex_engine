"use strict";

// Reference: Ultimate Oscillator (UO)
// Source family: Larry Williams, Ultimate Oscillator.
// Convention (selected):
//   BP = close - min(low, previousClose)
//   TR = max(high, previousClose) - min(low, previousClose)
//   avgK = sum(BP over K transitions) / sum(TR over K transitions)
//   UO = 100 * (4*avg(period1) + 2*avg(period2) + avg(period3)) / 7
//   A zero TR denominator contributes neutral 0.5 for that average.
// Warm-up: period3 transitions, requiring period3+1 bars.
// Independent implementation: plain loops over OHLC arrays.
function ultimateOscillator(highs, lows, closes, period1, period2, period3) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("ultimateOscillator: highs/lows/closes must be arrays");
    }
    for (const [name, period] of Object.entries({ period1, period2, period3 })) {
        if (!Number.isInteger(period) || period < 1) {
            throw new Error("ultimateOscillator: " + name + " must be a positive integer");
        }
    }
    if (!(period1 <= period2 && period2 <= period3)) {
        throw new Error("ultimateOscillator: periods must be nondecreasing");
    }

    const bp = new Array(highs.length).fill(0);
    const tr = new Array(highs.length).fill(0);
    for (let i = 1; i < highs.length; i++) {
        const previousClose = closes[i - 1];
        bp[i] = closes[i] - Math.min(lows[i], previousClose);
        tr[i] = Math.max(highs[i], previousClose) - Math.min(lows[i], previousClose);
    }

    const series = [];
    let value = 50;
    let ready = false;
    for (let i = 0; i < highs.length; i++) {
        if (i < period3) {
            series.push(50);
            continue;
        }

        const averages = [];
        for (const period of [period1, period2, period3]) {
            const start = i - period + 1;
            let sumBP = 0;
            let sumTR = 0;
            for (let j = start; j <= i; j++) {
                sumBP += bp[j];
                sumTR += tr[j];
            }
            averages.push(sumTR === 0 ? 0.5 : sumBP / sumTR);
        }
        value = 100 * (4 * averages[0] + 2 * averages[1] + averages[2]) / 7;
        ready = true;
        series.push(value);
    }

    return { value, ready, series, period1, period2, period3 };
}

module.exports = ultimateOscillator;
module.exports.UltimateOscillator = ultimateOscillator;
