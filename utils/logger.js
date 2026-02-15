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

module.exports = logger;
