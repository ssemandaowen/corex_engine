"use strict";

const { TIME } = require("./constants");

const UNITS = {
    s: TIME.MS.SECOND,
    m: TIME.MS.MINUTE,
    h: TIME.MS.HOUR,
    d: TIME.MS.DAY
};

/**
 * Parse a timeframe string into milliseconds.
 * Reproduces StrategyRuntimeUtils._getTFMs behaviour exactly:
 *   - lowercase input
 *   - replace "min" with "m"
 *   - match /^(\d+)([smhd])$/
 *   - no match  -> TIME.MS.MINUTE (60000)
 *   - match     -> number * unit ms
 */
function parseTf(tfInput) {
    const tf = String(tfInput || "").toLowerCase().replace("min", "m");
    const match = tf.match(TIME.TF_PATTERN);
    if (!match) return TIME.MS.MINUTE;
    return (parseInt(match[1], 10) || 1) * (UNITS[match[2]] || TIME.MS.MINUTE);
}

/**
 * Bucket start (floor-aligned candle boundary) for a given time and tfMs.
 * Reproduces StrategyDataManager.updateTick: Math.floor(time / tfMs) * tfMs.
 */
function bucketStart(time, tfMs) {
    return Math.floor(time / tfMs) * tfMs;
}

module.exports = {
    parseTf,
    bucketStart,
    UNITS
};
