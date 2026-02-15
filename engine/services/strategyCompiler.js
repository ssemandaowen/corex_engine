"use strict";

const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const MODULE = "STRATEGY_COMPILER";
const log = {
    info: (message, meta) => logger.info(`[${MODULE}][INFO] ${message}`, meta),
    warn: (message, meta) => logger.warn(`[${MODULE}][WARN] ${message}`, meta),
    error: (message, meta) => logger.error(`[${MODULE}][ERROR] ${message}`, meta)
};

const REQUIRED_FIELDS = ["symbols"];
const METHOD_CANDIDATES = ["next", "onBar", "onTick", "_processData"];

function _emitError(id, code, message, meta = {}) {
    bus.emit(EVENTS.SYSTEM.ERROR, {
        source: "strategy_compiler",
        strategyId: id || null,
        code,
        message,
        meta,
        at: new Date().toISOString()
    });
}

function compile(instance) {
    if (!instance || typeof instance !== "object") {
        const msg = "Strategy instance is invalid";
        log.error(msg);
        _emitError(null, "INVALID_INSTANCE", msg);
        return { ok: false, reason: msg };
    }

    const id = instance.id || instance.name || "unknown";

    // Allow legacy strategies that define `symbol` (string) instead of `symbols` (array)
    if ((!instance.symbols || !Array.isArray(instance.symbols) || instance.symbols.length === 0) && typeof instance.symbol === "string") {
        instance.symbols = [instance.symbol];
    }

    for (const field of REQUIRED_FIELDS) {
        if (instance[field] == null || instance[field] === "") {
            const msg = `Missing required field: ${field}`;
            log.error(`[${id}] ${msg}`);
            _emitError(id, "MISSING_FIELD", msg);
            return { ok: false, reason: msg };
        }
    }

    if (!Array.isArray(instance.symbols) || instance.symbols.length === 0) {
        const msg = "symbols must be a non-empty array";
        log.error(`[${id}] ${msg}`);
        _emitError(id, "INVALID_SYMBOLS", msg);
        return { ok: false, reason: msg };
    }

    const hasAnyMethod = METHOD_CANDIDATES.some((m) => typeof instance[m] === "function");
    if (!hasAnyMethod) {
        const msg = `Missing required method: one of ${METHOD_CANDIDATES.map(m => `${m}()`).join(", ")}`;
        log.error(`[${id}] ${msg}`);
        _emitError(id, "MISSING_METHOD", msg);
        return { ok: false, reason: msg };
    }

    if (typeof instance._processData !== "function") {
        log.warn(`[${id}] _processData not found; BaseStrategy wrapper expected.`);
    }

    if (!instance.timeframe || typeof instance.timeframe !== "string") {
        instance.timeframe = "1m";
    }

    log.info(`[${id}] Strategy compiled`);
    return { ok: true };
}

module.exports = {
    compile
};
