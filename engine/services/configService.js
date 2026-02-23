"use strict";

const { bus, EVENTS } = require("@events/bus");
const pgStore = require("@core/services/pgStore");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");

const TTL = 60 * 1000; // 60s cache TTL

const log = logger.createModuleLogger("CONFIG", {
  category: "system"
});

let cache = {
  data: {},
  loadedAt: 0
};

let health = {
  status: "idle", // idle | healthy | stale | error
  lastError: null
};

let initialized = false;
let loadingPromise = null;

/* ----------------------------- Utilities ----------------------------- */

function deepFreeze(obj) {
  if (!obj || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function sanitizeNumber(value, fallback = undefined) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeBrokerConfig(base = {}, override = {}, raw = {}) {
  return {
    ...base,
    ...override,
    cash: sanitizeNumber(raw?.cash),
    initialCash: sanitizeNumber(raw?.initialCash)
  };
}

/* ----------------------------- Core Loader ----------------------------- */

async function load() {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const start = Date.now();
    health.status = "stale";

    try {
      if (!db.hasDbConfig()) {
        cache = { data: {}, loadedAt: Date.now() };
        health = { status: "error", lastError: "DB not configured" };
        log.warn("DB not configured. Config cleared.");
        return cache.data;
      }

      const [system, live, paper] = await Promise.all([
        pgStore.getSystemSettings(),
        pgStore.getBrokerSettings("live"),
        pgStore.getBrokerSettings("paper")
      ]);

      const systemPayload = system?.payload || {};
      const liveConfig = live?.config || {};
      const paperConfig = paper?.config || {};

      const merged = {
        ...systemPayload,
        broker: {
          ...(systemPayload.broker || {}),
          live: sanitizeBrokerConfig(
            systemPayload.broker?.live,
            liveConfig,
            live
          ),
          paper: sanitizeBrokerConfig(
            systemPayload.broker?.paper,
            paperConfig,
            paper
          )
        }
      };

      cache = {
        data: deepFreeze(merged),
        loadedAt: Date.now()
      };

      health = { status: "healthy", lastError: null };

      log.info("Config loaded", {
        durationMs: Date.now() - start,
        keys: Object.keys(merged).length
      });

      return cache.data;
    } catch (err) {
      health = { status: "error", lastError: err.message };
      log.error(`Config load failed: ${err.message}`);
      throw err;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/* ----------------------------- Public API ----------------------------- */

async function ensureFresh() {
  const isExpired = Date.now() - cache.loadedAt > TTL;
  if (!cache.loadedAt || isExpired) {
    await load();
  }
}

async function get(path, fallback = undefined) {
  await ensureFresh();

  if (!path) return fallback;

  const parts = String(path).split(".").filter(Boolean);
  let cur = cache.data;

  for (const key of parts) {
    if (!cur || typeof cur !== "object" || !(key in cur)) {
      return fallback;
    }
    cur = cur[key];
  }

  return cur === undefined ? fallback : cur;
}

function getSync(path, fallback = undefined) {
  if (!path) return fallback;
  const parts = String(path).split(".").filter(Boolean);
  let cur = cache.data;
  for (const key of parts) {
    if (!cur || typeof cur !== "object" || !(key in cur)) {
      return fallback;
    }
    cur = cur[key];
  }
  return cur === undefined ? fallback : cur;
}

async function refresh() {
  return load();
}

function getHealth() {
  return { ...health };
}

async function init() {
  if (initialized) return;
  initialized = true;

  await load();

  bus.on(EVENTS.SYSTEM.CONFIG_REFRESH, async () => {
    try {
      await refresh();
    } catch (err) {
      log.error(`Refresh failed: ${err.message}`);
    }
  });

  log.info("Config service initialized");
}

module.exports = {
  init,
  load,
  refresh,
  get,
  getSync,
  getHealth
};
