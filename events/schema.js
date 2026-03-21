"use strict";

const crypto = require("crypto");

function normalizeId(value) {
  if (value == null) return "";
  const v = String(value).trim();
  return v;
}

function normalizeMeta(meta = {}) {
  const src = meta && typeof meta === "object" ? meta : {};
  const next = { ...src };

  if (!Number.isFinite(Number(next.ts))) next.ts = Date.now();

  if (next.userId != null) next.userId = normalizeId(next.userId);
  if (next.strategyId != null) next.strategyId = normalizeId(next.strategyId);
  if (next.symbol != null) next.symbol = String(next.symbol || "").trim();

  if (next.correlationId != null) next.correlationId = normalizeId(next.correlationId);

  // Strip empty strings to reduce noise.
  if (next.userId === "") delete next.userId;
  if (next.strategyId === "") delete next.strategyId;
  if (next.symbol === "") delete next.symbol;
  if (next.correlationId === "") delete next.correlationId;

  return next;
}

function newCorrelationId() {
  return crypto.randomUUID();
}

module.exports = {
  normalizeMeta,
  newCorrelationId
};

