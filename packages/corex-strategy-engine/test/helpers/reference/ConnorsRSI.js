"use strict";

const rsiRef = require("./RSI");

// Reference: Connors RSI (CRSI)
// Source family: Connors Research, Connors RSI.
// Convention (selected): arithmetic mean of three components:
//   1) RSI(close, rsiPeriod)
//   2) RSI(signed consecutive up/down streak, streakPeriod)
//   3) PercentRank of one-bar percentage ROC over rocPeriod observations.
// PercentRank = 100 * count(prior ROC values strictly below current ROC)/(rocPeriod-1).
// Warm-up: all three components must be available; zero prior close makes that ROC unavailable.
// Independent implementation: plain loops over prices and ROC windows.
function connorsRSI(closes, rsiPeriod, streakPeriod, rocPeriod) {
    if (!Array.isArray(closes)) throw new Error("connorsRSI: closes must be an array");
    for (const [name, period] of Object.entries({ rsiPeriod, streakPeriod, rocPeriod })) {
        if (!Number.isInteger(period) || period < 1) {
            throw new Error("connorsRSI: " + name + " must be a positive integer");
        }
    }
    if (rocPeriod < 2) throw new Error("connorsRSI: rocPeriod must be >= 2 for PercentRank");

    const priceRsi = rsiRef(closes, rsiPeriod).series;
    const streaks = new Array(closes.length).fill(0);
    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) streaks[i] = (streaks[i - 1] > 0 ? streaks[i - 1] : 0) + 1;
        else if (change < 0) streaks[i] = (streaks[i - 1] < 0 ? streaks[i - 1] : 0) - 1;
        else streaks[i] = 0;
    }
    const streakRsi = rsiRef(streaks, streakPeriod).series;

    const oneBarRoc = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] !== 0) {
            oneBarRoc[i] = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
        }
    }

    const series = [];
    let value = null;
    let ready = false;
    for (let i = 0; i < closes.length; i++) {
        const priceValue = priceRsi[i];
        const streakValue = streakRsi[i];
        const start = i - rocPeriod + 1;
        let percentRank = null;
        if (start >= 1) {
            const window = oneBarRoc.slice(start, i + 1);
            if (window.length === rocPeriod && window.every(Number.isFinite)) {
                const current = window[window.length - 1];
                let less = 0;
                for (let j = 0; j < window.length - 1; j++) {
                    if (window[j] < current) less += 1;
                }
                percentRank = 100 * less / (rocPeriod - 1);
            }
        }

        if (priceValue !== null && streakValue !== null && percentRank !== null) {
            value = (priceValue + streakValue + percentRank) / 3;
            ready = true;
        } else {
            value = null;
        }
        series.push(value);
    }

    return { value, ready, series, rsiPeriod, streakPeriod, rocPeriod };
}

module.exports = connorsRSI;
module.exports.ConnorsRSI = connorsRSI;
