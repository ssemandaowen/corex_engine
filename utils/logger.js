"use strict";

const winston = require("winston");

const { combine, timestamp, printf, colorize, align, label } = winston.format;

const LOG_LABEL = "COREX";

// Custom log format (console)
const consoleFormat = printf(({ level, message, timestamp, label }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

// Custom log format (file – clean, no colors)
const fileFormat = printf(({ level, message, timestamp, label }) => {
  return `${timestamp} [${label}] ${level.toUpperCase()} ${message}`;
});

const logger = winston.createLogger({
  level: "info",
  transports: [
    // Console transport (pretty)
    new winston.transports.Console({
      format: combine(
        label({ label: LOG_LABEL }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        colorize({ all: true }),
        align(),
        consoleFormat
      )
    }),

    // File transport (clean & audit-safe)
    new winston.transports.File({
      filename: "logs/corex.log",
      format: combine(
        label({ label: LOG_LABEL }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        align(),
        fileFormat
      )
    })
  ]
});

// Runtime level switcher (clean & safe)
logger.setLevel = (level) => {
  if (!level) return;
  logger.level = level;
  logger.transports.forEach(t => (t.level = level));
};

const _moduleLoggerCache = new Map();
const _UI_LOG_DEFAULT_LEVELS = ["info", "warn", "error"];

function _toLevelSet(levels) {
  if (!levels) return new Set(_UI_LOG_DEFAULT_LEVELS);
  const arr = Array.isArray(levels) ? levels : [levels];
  return new Set(arr.map(v => String(v || "").toLowerCase()).filter(Boolean));
}

function _emitUiLog(level, moduleName, message, meta, options = {}) {
  try {
    const { bus, EVENTS } = require("@events/bus");
    if (!bus || !EVENTS?.SYSTEM?.LOG) return;

    const payload = {
      level,
      module: moduleName,
      message: String(message ?? ""),
      ...(level === "error" ? { error: String(message ?? "") } : {}),
      ...(meta && typeof meta === "object" ? { meta } : {})
    };

    bus.emit(EVENTS.SYSTEM.LOG, payload, {
      category: options.category || "system"
    });
  } catch (_) {
    // no-op: logger must never fail due to optional UI transport path
  }
}

logger.createModuleLogger = (moduleName, options = {}) => {
  const key = `${String(moduleName || "APP")}::${JSON.stringify(options)}`;
  if (_moduleLoggerCache.has(key)) return _moduleLoggerCache.get(key);

  const moduleId = String(moduleName || "APP");
  const category = String(options.category || "system");
  const uiEnabled = !!options.ui;
  const uiLevels = _toLevelSet(options.uiLevels);

  const write = (level, message, meta, callOptions = {}) => {
    const safeMessage = String(message ?? "");
    logger[level](`[${moduleId}][${String(level).toUpperCase()}] ${safeMessage}`, meta);

    const callUiEnabled = callOptions.ui === undefined ? uiEnabled : !!callOptions.ui;
    const shouldEmit = callUiEnabled && uiLevels.has(String(level).toLowerCase());
    if (!shouldEmit) return;

    _emitUiLog(level, moduleId, safeMessage, meta, {
      category: callOptions.category || category
    });
  };

  const scoped = {
    info: (message, meta, callOptions) => write("info", message, meta, callOptions),
    warn: (message, meta, callOptions) => write("warn", message, meta, callOptions),
    error: (message, meta, callOptions) => write("error", message, meta, callOptions),
    debug: (message, meta, callOptions) => write("debug", message, meta, callOptions)
  };

  _moduleLoggerCache.set(key, scoped);
  return scoped;
};

module.exports = logger;
