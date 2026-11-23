"use strict";

const emaRef = require("./EMA");

// Reference: MACD (Moving Average Convergence Divergence)
// Source family: Gerald Appel, MACD.
// Convention (selected): textbook MACD.
//   MACD line = EMA(fast, price) - EMA(slow, price)   (EMA seeded with SMA of first period)
//   Signal = EMA(signalPeriod, MACD line)
//   Histogram = MACD line - Signal
//   EMA warm-up: each EMA ready after its period; MACD line ready when fast & slow ready;
//   Signal ready when its EMA ready; histogram ready one bar after signal ready.
// Independent implementation: plain loops over an input array.
function macd(prices, fastPeriod, slowPeriod, signalPeriod) {
    if (!Array.isArray(prices)) throw new Error("macd: prices must be an array");
    if (!fastPeriod || fastPeriod < 1) throw new Error("macd: fastPeriod must be >= 1");
    if (!slowPeriod || slowPeriod < 1) throw new Error("macd: slowPeriod must be >= 1");
    if (!signalPeriod || signalPeriod < 1) throw new Error("macd: signalPeriod must be >= 1");
    const n = prices.length;
    const macdLine = [];
    const signalLine = [];
    const histogram = [];
    let value = 0;
    let signal = 0;
    let histo = 0;
    let ready = false;
    let histoReady = false;
    const fast = emaRef(prices, fastPeriod);
    const slow = emaRef(prices, slowPeriod);
    // recompute EMAs incrementally is not supported by the pure reference; recompute per prefix
    for (let i = 0; i < n; i++) {
        const f = emaRef(prices.slice(0, i + 1), fastPeriod);
        const s = emaRef(prices.slice(0, i + 1), slowPeriod);
        let m = null;
        if (f.ready && s.ready) {
            m = f.value - s.value;
        }
        macdLine.push(m);
        let sig = null;
        if (m !== null) {
            const sigState = emaRef(macdLine.filter(v => v !== null), signalPeriod);
            if (sigState.ready) {
                sig = sigState.value;
                histo = m - sig;
                histoReady = true;
            }
        }
        signalLine.push(sig);
        histogram.push(histoReady ? histo : null);
        if (m !== null && sig !== null) {
            value = m;
            signal = sig;
            ready = true;
        }
        seriesPush(histogram);
    }
    return { value, signal, histo, ready, histoReady, series: histogram };
    function seriesPush() {}
}
module.exports = macd;
module.exports.MACD = macd;
