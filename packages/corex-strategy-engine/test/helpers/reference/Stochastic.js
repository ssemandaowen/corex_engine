"use strict";

// Reference: Stochastic Oscillator
// Source family: George Lane, Stochastic Oscillator.
// Convention (selected): fast stochastic.
//   %K = (close - lowestLow) / (highestHigh - lowestLow) * 100 over kPeriod.
//   If range is zero, %K = 50. %D = SMA(%K, dPeriod).
//   Reported scalar value = %K; %D is returned separately.
// Warm-up: %K after kPeriod bars; %D after dPeriod valid %K values.
// Independent implementation: plain loops over input arrays.
function stochastic(highs, lows, closes, kPeriod, dPeriod) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("stochastic: highs/lows/closes must be arrays");
    }
    if (!Number.isInteger(kPeriod) || kPeriod < 1) throw new Error("stochastic: kPeriod must be a positive integer");
    if (!Number.isInteger(dPeriod) || dPeriod < 1) throw new Error("stochastic: dPeriod must be a positive integer");

    const validK = [];
    const series = [];
    let value = null;
    let k = null;
    let d = null;
    let ready = false;

    for (let i = 0; i < highs.length; i++) {
        if (i + 1 >= kPeriod) {
            const start = i - kPeriod + 1;
            let highest = highs[start];
            let lowest = lows[start];
            for (let j = start + 1; j <= i; j++) {
                if (highs[j] > highest) highest = highs[j];
                if (lows[j] < lowest) lowest = lows[j];
            }
            const range = highest - lowest;
            k = range === 0 ? 50 : ((closes[i] - lowest) / range) * 100;
            validK.push(k);
            value = k;
            ready = true;
            if (validK.length >= dPeriod) {
                let sum = 0;
                for (let j = validK.length - dPeriod; j < validK.length; j++) sum += validK[j];
                d = sum / dPeriod;
            }
        }
        series.push({ value, k, d, ready });
    }

    return { value, k, d, ready, series, kPeriod, dPeriod };
}

module.exports = stochastic;
module.exports.Stochastic = stochastic;
