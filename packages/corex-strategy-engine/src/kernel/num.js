"use strict";

/**
 * Pure numeric kernel primitives.
 * No per-call allocation, no Date.now, no toFixed.
 */

/**
 * Strictly positive and finite.
 */
function isPos(x) {
    return Number.isFinite(x) && x > 0;
}

/**
 * Clamp x into [min, max]. Returns NaN if any input is NaN.
 */
function clamp(x, min, max) {
    if (Number.isNaN(x) || Number.isNaN(min) || Number.isNaN(max)) return NaN;
    if (x < min) return min;
    if (x > max) return max;
    return x;
}

/**
 * Round to dp decimal places using Math.round (never toFixed).
 */
function roundTo(x, dp) {
    const factor = 10 ** dp;
    return Math.round(x * factor) / factor;
}

/**
 * Snap x down to the nearest step multiple, floored at min.
 * Returns 0 when x <= 0 or step <= 0.
 */
function snapToStep(x, step, min = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(step) || !Number.isFinite(min)) return 0;
    if (x <= 0 || step <= 0) return 0;
    const snapped = Math.floor(x / step) * step;
    return Math.max(min, snapped);
}

module.exports = {
    isPos,
    clamp,
    roundTo,
    snapToStep
};
