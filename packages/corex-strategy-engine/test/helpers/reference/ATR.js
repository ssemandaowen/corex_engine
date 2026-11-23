"use strict";

// Reference: Average True Range (ATR)
// Source family: J. Welles Wilder Jr., ATR (Wilder smoothing).
// Convention (selected):
//   TR   = max(high - low, |high - prevClose|, |low - prevClose|)
//   seed = SMA of the first `period` true ranges
//   subsequent ATR = (prevATR * (period - 1) + TR) / period   (Wilder smoothing)
// Warm-up: ready once `period` true ranges observed (period+1 bars; first bar seeds prevClose).
// Independent implementation: plain loops over input arrays.
function atr(highs, lows, closes, period) {
    if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
        throw new Error("atr: highs/lows/closes must be arrays");
    }
    if (!period || period < 1) throw new Error("atr: period must be >= 1");
    const n = highs.length;
    const series = [];
    let value = 0;
    let ready = false;
    let prevClose = null;
    const trs = [];
    for (let i = 0; i < n; i++) {
        if (prevClose === null) {
            prevClose = closes[i];
            series.push(null);
            continue;
        }
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - prevClose);
        const lc = Math.abs(lows[i] - prevClose);
        const tr = Math.max(hl, hc, lc);
        prevClose = closes[i];
        trs.push(tr);
        if (!ready) {
            if (trs.length === period) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += trs[j];
                value = sum / period;
                ready = true;
            } else {
                value = null;
            }
        } else {
            value = (value * (period - 1) + tr) / period;
        }
        series.push(value);
    }
    return { value, ready, series, period };
}
module.exports = atr;
module.exports.ATR = atr;
