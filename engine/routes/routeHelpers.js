"use strict";

/**
 * Shared route helpers and normalization utilities
 * PHASE 2: Extracted from redundant implementations across controllers
 */

const { MODES } = require("@config/constants");

/**
 * Normalize and validate mode parameter
 * @param {string} mode - Raw mode string (paper, live, backtest, etc.)
 * @param {string} defaultMode - Fallback if mode is invalid
 * @returns {string} Uppercased, validated mode
 */
function normalizeMode(mode, defaultMode = MODES.PAPER) {
    const normalized = String(mode || defaultMode).trim().toUpperCase();
    const validModes = Object.values(MODES);
    return validModes.includes(normalized) ? normalized : String(defaultMode).toUpperCase();
}

/**
 * Safely extract userId from request
 * @param {Object} req - Express request
 * @returns {string} User ID or empty string if not authenticated
 */
function getUserId(req) {
    return String(req.user?.sub || "").trim();
}

/**
 * Safely extract and validate strategy ID
 * @param {string} strategyId - Raw strategy ID
 * @returns {string} Trimmed ID or empty string if invalid
 */
function getStrategyId(strategyId) {
    return String(strategyId || "").trim();
}

/**
 * Coerce string to boolean
 * @param {*} value - Value to coerce
 * @returns {boolean}
 */
function toBoolean(value) {
    return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

/**
 * Coerce string to integer with bounds
 * @param {*} value - Value to coerce
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @param {number} defaultVal - Default if invalid
 * @returns {number}
 */
function toIntBounded(value, min = 0, max = Infinity, defaultVal = min) {
    const num = Number(value);
    if (!Number.isFinite(num)) return Number.isFinite(defaultVal) ? defaultVal : min;
    return Math.max(min, Math.min(max, num));
}

module.exports = {
    normalizeMode,
    getUserId,
    getStrategyId,
    toBoolean,
    toIntBounded
};
