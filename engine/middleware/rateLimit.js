"use strict";

function envNum(key, fallback) {
  const raw = process.env[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function rateLimit(options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || envNum("COREX_RATE_LIMIT_WINDOW_MS", 60_000)));
  const max = Math.max(1, Number(options.max || envNum("COREX_RATE_LIMIT_MAX", 600)));
  const keyFn = typeof options.keyFn === "function"
    ? options.keyFn
    : (req) => String(req.user?.sub || req.ip || "anon");

  const hits = new Map(); // key -> { count, resetAt }

  // Simple periodic cleanup to avoid unbounded growth.
  const cleanupEvery = Math.max(windowMs, 60_000);
  let lastCleanup = Date.now();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    if (now - lastCleanup > cleanupEvery) {
      lastCleanup = now;
      for (const [k, v] of hits.entries()) {
        if (!v || v.resetAt <= now) hits.delete(k);
      }
    }

    const key = String(keyFn(req) || "anon");
    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ success: false, error: "RATE_LIMITED" });
    }

    return next();
  };
}

module.exports = rateLimit;

