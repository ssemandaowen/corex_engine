"use strict";

// Reference: Ichimoku Cloud
// Source family: Goichi Hosoda, Ichimoku Kinko Hyo.
// Convention (selected):
//   Tenkan = midpoint of the highest high / lowest low over conversionPeriod.
//   Kijun = midpoint over basePeriod; Senkou B = midpoint over laggingPeriod.
//   Senkou A = (Tenkan + Kijun) / 2.
//   Returned Senkou A/B are calculated at the current bar; charting shifts them
//   forward by cloudDisplacement. Chikou is current close shifted backward by that amount.
//   Scalar value = Tenkan; cloud upper/lower = max/min of current Senkou A/B.
// Warm-up: ready when all three lookback periods have enough bars.
// Independent implementation: plain rolling arrays and loops.
function ichimoku(highs, lows, closes, conversionPeriod, basePeriod, laggingPeriod, cloudDisplacement) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("ichimoku: highs/lows/closes must be arrays");
    }
    for (const [name, period] of Object.entries({ conversionPeriod, basePeriod, laggingPeriod, cloudDisplacement })) {
        if (!Number.isInteger(period) || period < 1) throw new Error("ichimoku: " + name + " must be a positive integer");
    }

    const maxLookback = Math.max(conversionPeriod, basePeriod, laggingPeriod);
    const buffer = [];
    const closesForChikou = [];
    const series = [];
    let tenkan = null;
    let kijun = null;
    let senkouA = null;
    let senkouB = null;
    let chikou = null;
    let cloudUpper = null;
    let cloudLower = null;
    let value = null;
    let ready = false;

    function midpoint(window) {
        let highest = -Infinity;
        let lowest = Infinity;
        for (const candle of window) {
            if (candle.high > highest) highest = candle.high;
            if (candle.low < lowest) lowest = candle.low;
        }
        return (highest + lowest) / 2;
    }

    for (let i = 0; i < highs.length; i++) {
        buffer.push({ high: highs[i], low: lows[i] });
        if (buffer.length > maxLookback) buffer.shift();
        closesForChikou.push(closes[i]);
        if (closesForChikou.length > cloudDisplacement + 1) closesForChikou.shift();

        if (buffer.length >= conversionPeriod) tenkan = midpoint(buffer.slice(-conversionPeriod));
        if (buffer.length >= basePeriod) kijun = midpoint(buffer.slice(-basePeriod));
        if (buffer.length >= laggingPeriod) senkouB = midpoint(buffer.slice(-laggingPeriod));

        if (tenkan !== null && kijun !== null) senkouA = (tenkan + kijun) / 2;
        if (senkouA !== null && senkouB !== null) {
            cloudUpper = Math.max(senkouA, senkouB);
            cloudLower = Math.min(senkouA, senkouB);
        }
        if (closesForChikou.length > cloudDisplacement) {
            chikou = closesForChikou[0];
        }

        ready = tenkan !== null && kijun !== null && senkouB !== null;
        value = tenkan;
        series.push({ tenkan, kijun, senkouA, senkouB, chikou, cloudUpper, cloudLower, ready });
    }

    return { value, tenkan, kijun, senkouA, senkouB, chikou, cloudUpper, cloudLower, ready, series };
}

module.exports = ichimoku;
module.exports.Ichimoku = ichimoku;
