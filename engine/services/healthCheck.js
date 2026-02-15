"use strict";

const crypto = require("crypto");
const db = require("@core/services/postgres");
const mt5Bridge = require("@core/services/mt5Bridge");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const MODULE = "HEALTH";
const CHECK_INTERVAL = 15000; // 15s
const TIMEOUT_MS = 4000;
const MT5_MAX_HEARTBEAT_AGE = 20000; // 20s

const log = {
  info: (m, meta) => logger.info(`[${MODULE}][INFO] ${m}`, meta),
  warn: (m, meta) => logger.warn(`[${MODULE}][WARN] ${m}`, meta),
  error: (m, meta) => logger.error(`[${MODULE}][ERROR] ${m}`, meta)
};

let state = {
  status: "unknown", // healthy | degraded | critical
  lastRun: 0,
  durationMs: 0,
  gates: {},
  history: []
};

let monitorTimer = null;

/* ---------------- Utilities ---------------- */

function envTrue(v) {
  return ["1", "true", "yes", "on"].includes(
    String(v || "").trim().toLowerCase()
  );
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    )
  ]);
}

function severityFrom(ok, levelIfFail = "critical") {
  if (ok) return "ok";
  return levelIfFail;
}

function updateHistory(snapshot) {
  state.history.unshift(snapshot);
  if (state.history.length > 20) state.history.pop();
}

/* ---------------- Gate Checks ---------------- */

async function checkDb() {
  if (!db.hasDbConfig()) {
    return { ok: false, severity: "critical", reason: "NO_DB_CONFIG" };
  }

  try {
    await withTimeout(db.query("SELECT 1"), TIMEOUT_MS);
    return { ok: true, severity: "ok" };
  } catch (err) {
    return {
      ok: false,
      severity: "critical",
      reason: err.message || "DB_UNREACHABLE"
    };
  }
}

async function checkQuotas() {
  try {
    const { rows } = await withTimeout(
      db.query("SELECT COUNT(*)::int AS n FROM quota_profiles"),
      TIMEOUT_MS
    );

    const count = rows[0]?.n || 0;
    return {
      ok: count > 0,
      severity: count > 0 ? "ok" : "critical",
      count
    };
  } catch (err) {
    return {
      ok: false,
      severity: "critical",
      reason: err.message || "QUOTA_CHECK_FAILED"
    };
  }
}

async function checkStrategyHashes(enforceHash) {
  if (!enforceHash) {
    return { ok: true, severity: "warning", skipped: true };
  }

  try {
    const { rows } = await withTimeout(
      db.query(
        "SELECT name, script_body, script_hash FROM strategies ORDER BY name ASC"
      ),
      TIMEOUT_MS
    );

    const mismatches = [];

    for (const row of rows) {
      const expected = String(row.script_hash || "").trim().toLowerCase();
      const code = String(row.script_body || "");
      const actual = crypto.createHash("sha256").update(code).digest("hex");

      if (!expected || expected !== actual) {
        mismatches.push(row.name);
      }
    }

    return {
      ok: mismatches.length === 0,
      severity: mismatches.length === 0 ? "ok" : "critical",
      mismatches
    };
  } catch (err) {
    return {
      ok: false,
      severity: "critical",
      reason: err.message || "HASH_CHECK_FAILED"
    };
  }
}

function checkMt5() {
  const bridgeStatus = mt5Bridge.getStatus();
  const tokenConfigured = !!String(
    process.env.MT5_BRIDGE_TOKEN || process.env.ADMIN_SECRET || ""
  ).trim();

  const heartbeatAge = Date.now() - (bridgeStatus.lastHeartbeat || 0);
  const alive = bridgeStatus.authorized && heartbeatAge < MT5_MAX_HEARTBEAT_AGE;

  return {
    ok: alive || !tokenConfigured,
    severity: alive ? "ok" : "critical",
    tokenConfigured,
    heartbeatAge,
    authorized: bridgeStatus.authorized
  };
}

/* ---------------- Core Engine ---------------- */

async function runHealthCheck() {
  const startedAt = Date.now();
  const enforceHash = envTrue(process.env.COREX_STRATEGY_HASH_ENFORCE);

  const dbStatus = await checkDb();

  // Short-circuit if DB critical
  if (!dbStatus.ok) {
    const snapshot = finalizeState(startedAt, {
      connectivity: dbStatus
    });
    triggerSafeMode(snapshot);
    return snapshot;
  }

  const [quotaStatus, hashStatus] = await Promise.all([
    checkQuotas(),
    checkStrategyHashes(enforceHash)
  ]);

  const mt5Status = checkMt5();

  const gates = {
    connectivity: {
      db: dbStatus,
      mt5: mt5Status
    },
    safety: quotaStatus,
    integrity: hashStatus
  };

  const snapshot = finalizeState(startedAt, gates);

  if (snapshot.status !== "healthy") {
    triggerSafeMode(snapshot);
  }

  return snapshot;
}

function finalizeState(startedAt, gates) {
  const durationMs = Date.now() - startedAt;

  let status = "healthy";

  for (const section of Object.values(gates)) {
    if (!section) continue;

    const items = section.ok !== undefined ? [section] : Object.values(section);

    for (const g of items) {
      if (g.severity === "critical") status = "critical";
      else if (g.severity === "warning" && status !== "critical")
        status = "degraded";
    }
  }

  const snapshot = {
    status,
    lastRun: Date.now(),
    durationMs,
    gates
  };

  state = { ...state, ...snapshot };
  updateHistory(snapshot);

  log.info(`Health check complete`, {
    status,
    durationMs
  });

  return snapshot;
}

function triggerSafeMode(snapshot) {
  log.error("System entering SAFE MODE", { status: snapshot.status });

  bus.emit(EVENTS.SYSTEM.SAFE_MODE, {
    status: snapshot.status,
    gates: snapshot.gates
  });
}

/* ---------------- Monitor Loop ---------------- */

function startMonitor() {
  if (monitorTimer) return;

  monitorTimer = setInterval(() => {
    runHealthCheck().catch((err) => {
      log.error(`Health loop error: ${err.message}`);
    });
  }, CHECK_INTERVAL);

  log.info("Health monitor started");
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

function getHealthSnapshot() {
  return { ...state };
}

module.exports = {
  runHealthCheck,
  startMonitor,
  stopMonitor,
  getHealthSnapshot
};