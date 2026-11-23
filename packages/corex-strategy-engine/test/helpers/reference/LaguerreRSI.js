"use strict";

// Reference: Laguerre RSI
// Source family: John Ehlers, Laguerre RSI.
// Convention (selected): four Laguerre stages with gamma in [0,1].
//   L0 = (1-gamma)*price + gamma*previousL0
//   L1 = -gamma*L0 + previousL0 + gamma*previousL1
//   L2 = -gamma*L1 + previousL1 + gamma*previousL2
//   L3 = -gamma*L2 + previousL2 + gamma*previousL3
//   CU = sum(max(Lj-Lj+1,0)); CD = sum(max(Lj+1-Lj,0))
//   RSI = 100*CU/(CU+CD); zero denominator => neutral 50.
// Warm-up: first price seeds all four stages; output starts on the second price.
// Independent implementation: plain scalar recurrences.
function laguerreRSI(prices, gamma = 0.5) {
    if (!Array.isArray(prices)) throw new Error("laguerreRSI: prices must be an array");
    if (gamma < 0 || gamma > 1) throw new Error("laguerreRSI: gamma must be between 0 and 1");

    const series = [];
    let value = null;
    let ready = false;
    if (prices.length === 0) return { value, ready, series, gamma };

    let l0 = prices[0];
    let l1 = prices[0];
    let l2 = prices[0];
    let l3 = prices[0];
    series.push(null);

    for (let i = 1; i < prices.length; i++) {
        const previousL0 = l0;
        const previousL1 = l1;
        const previousL2 = l2;
        const previousL3 = l3;

        l0 = (1 - gamma) * prices[i] + gamma * previousL0;
        l1 = -gamma * l0 + previousL0 + gamma * previousL1;
        l2 = -gamma * l1 + previousL1 + gamma * previousL2;
        l3 = -gamma * l2 + previousL2 + gamma * previousL3;

        const cu = Math.max(l0 - l1, 0) + Math.max(l1 - l2, 0) + Math.max(l2 - l3, 0);
        const cd = Math.max(l1 - l0, 0) + Math.max(l2 - l1, 0) + Math.max(l3 - l2, 0);
        value = cu + cd === 0 ? 50 : 100 * cu / (cu + cd);
        ready = true;
        series.push(value);
    }

    return { value, ready, series, gamma };
}

module.exports = laguerreRSI;
module.exports.LaguerreRSI = laguerreRSI;
