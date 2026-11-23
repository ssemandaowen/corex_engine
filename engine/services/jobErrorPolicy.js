"use strict";

/**
 * Job retry policy.
 *
 * A retry only helps for transient failures. Anything caused by the job's
 * inputs (unknown symbol, missing API key, invalid interval, bad params,
 * compile failure) fails identically on every attempt, so it is terminal on
 * the first failure. Typed errors carry `retryable`; plain errors are matched
 * by code, message prefix or the historical upload cases.
 */

const NON_RETRYABLE_CODES = new Set([
    "SYMBOL_NOT_FOUND",
    "SYMBOL_UNSUPPORTED",
    "PROVIDER_KEY_MISSING",
    "MAX_CANDLES_EXCEEDED",
    "INVALID_INTERVAL",
    "SYMBOL_NOT_SUPPORTED_BY_STRATEGY",
    "PARAM_UNKNOWN",
    "PARAM_INVALID",
    "PARAM_REQUIRED",
    "STRATEGY_NOT_FOUND",
    "COMPILE_FAILED",
    "STRATEGY_COMPILE_FAILED",
]);

// Historical upload failures: these never become retryable.
const NON_RETRYABLE_MESSAGE_MARKERS = [
    "UPLOAD_FILE_MISSING",
    "INVALID_FILE_TYPE",
    "ENOENT: no such file or directory",
];

function _collectCodes(err, message) {
    const codes = new Set();

    let current = err;
    for (let depth = 0; current && depth < 5; depth++) {
        if (typeof current.code === "string") codes.add(current.code);
        if (Array.isArray(current.errors)) {
            for (const entry of current.errors) {
                if (entry && typeof entry.code === "string") codes.add(entry.code);
            }
        }
        current = current.cause;
    }

    // Errors thrown as `new Error("CODE: detail")` have no code property.
    const idx = message.indexOf(":");
    if (idx > 0) {
        const head = message.slice(0, idx).trim();
        if (/^[A-Z][A-Z0-9_]*$/.test(head)) codes.add(head);
    }

    return codes;
}

function isNonRetryableError(err, message) {
    const msg = String(message ?? err?.message ?? err ?? "");

    for (const code of _collectCodes(err, msg)) {
        if (NON_RETRYABLE_CODES.has(code)) return true;
    }
    for (const marker of NON_RETRYABLE_MESSAGE_MARKERS) {
        if (msg.includes(marker)) return true;
    }

    // Typed errors decide explicitly. Untyped errors keep the old behaviour
    // (retry), so this policy only removes retries, never adds them.
    if (err && typeof err.retryable === "boolean") return !err.retryable;
    return false;
}

/**
 * @param {{ err?: Error, message?: string, failed?: boolean, attempts?: number, maxAttempts?: number }} input
 * @returns {boolean} true when the job should be requeued via jobQueue.scheduleRetry
 */
function shouldScheduleRetry({ err, message, failed, attempts, maxAttempts } = {}) {
    if (!failed) return false;

    const attempt = Number(attempts || 0);
    const max = Number(maxAttempts || 0);
    if (!(attempt < max)) return false;

    return !isNonRetryableError(err, message);
}

module.exports = {
    NON_RETRYABLE_CODES,
    isNonRetryableError,
    shouldScheduleRetry,
};
