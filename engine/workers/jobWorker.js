"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const os = require("os");
const logger = require("@utils/logger");
const dbMigrator = require("@root/db/migrate");
const db = require("@core/services/postgres");
const jobQueue = require("@core/services/jobQueue");
const { StrategyCompiler } = require("@core/services/strategyCompiler");

const log = logger.createModuleLogger("JOB_WORKER", { 
  category: "worker", 
  ui: true 
});

// Constants
const WORKER_ID = String(process.env.COREX_WORKER_ID || `${os.hostname()}:${process.pid}`);
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.COREX_JOB_WORKER_INTERVAL_MS || 750));
const IDLE_SLEEP_MS = Math.max(250, Number(process.env.COREX_JOB_WORKER_IDLE_MS || 1000));

let stopping = false;
const compiler = new StrategyCompiler();

function sanitizeText(value) {
  return String(value || "")
    .replace(/\u2192/g, "->")
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function emitParent(type, payload = {}) {
  if (typeof process.send !== "function") return;
  try {
    process.send({
      type: String(type || ""),
      payload: payload && typeof payload === "object" ? payload : {}
    });
  } catch {
    // best effort only
  }
}

/**
 * Utility: Standardized sleep
 */
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Core Logic: Backtest Execution
 * Fetches code, compiles instance, and runs via BacktestManager
 */
async function runBacktestJob(job) {
  // Lazy imports to keep worker memory footprint lean until needed
  const backtestManager = require("@core/backtestManager");
  const pgStore = require("@core/services/pgStore");

  const payload = job.payload || {};
  const userId = String(job.userId || payload.userId || "").trim();
  const strategyId = String(payload.strategyId || "").trim();

  if (!userId) throw new Error("USER_ID_REQUIRED");
  if (!strategyId) throw new Error("STRATEGY_ID_REQUIRED");

  // Server Control: Fetch specific strategy version from the database
  let strategy = await pgStore.getStrategyByName?.(strategyId).catch(() => null);
  
  if (!strategy) {
    const { rows } = await db.query(
      "SELECT name, script_body, updated_at, runtime_mode, runtime_params FROM strategies WHERE name = $1 LIMIT 1",
      [strategyId]
    );
    strategy = rows?.[0];
  }

  if (!strategy) throw new Error(`STRATEGY_NOT_FOUND: ${strategyId}`);

  // Compile within worker process
  const compiled = await compiler.compile(String(strategy.script_body || ""), strategyId);
  if (!compiled?.success || !compiled.instance) {
    throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled?.error || "unknown"}`);
  }

  const instance = compiled.instance;
  instance.id = strategyId;
  instance.name = strategyId;

  // Apply runtime overrides if provided in job payload
  if (payload.params && typeof payload.params === "object" && typeof instance.updateParams === "function") {
    instance.updateParams(payload.params);
  }

  const options = payload.options && typeof payload.options === "object" ? payload.options : {};
  
  const onProgress = async (evt) => {
    const progress = {
      stage: evt?.stage || "RUNNING",
      message: sanitizeText(evt?.message || ""),
      pct: Number.isFinite(Number(evt?.pct)) ? Number(evt.pct) : null,
      ts: Date.now(),
      runtimeId: evt?.runtimeId || null
    };

    await jobQueue.updateProgress({
      id: job.id,
      status: progress.stage === "FAILED" ? "failed" : "running",
      progress
    }).catch(() => {});

    emitParent("BACKTEST_PROGRESS", {
      jobId: String(job.id || ""),
      userId,
      status: progress.stage === "FAILED" ? "failed" : "running",
      progress,
      runtimeId: progress.runtimeId || null,
      type: String(job.type || "")
    });
  };

  const report = await backtestManager.run(instance, {
    ...options,
    userId,
    onProgress
  });

  return { report };
}

/**
 * Job Dispatcher
 */
async function handleJob(job) {
  if (!job || job.status === "cancelled") return null;

  await jobQueue.updateProgress({
    id: job.id,
    status: "running",
    progress: { stage: "STARTED", message: "Job picked up by worker", pct: 0, ts: Date.now() }
  }).catch(() => {});
  emitParent("BACKTEST_PROGRESS", {
    jobId: String(job.id || ""),
    userId: String(job.userId || ""),
    status: "running",
    progress: { stage: "STARTED", message: "Job picked up by worker", pct: 0, ts: Date.now() },
    type: String(job.type || "")
  });

  if (job.type === "backtest.run") {
    const result = await runBacktestJob(job);
    await jobQueue.updateProgress({
      id: job.id,
      status: "succeeded",
      progress: { stage: "DONE", message: "Backtest complete", pct: 100, ts: Date.now() },
      result
    });
    emitParent("BACKTEST_PROGRESS", {
      jobId: String(job.id || ""),
      userId: String(job.userId || ""),
      status: "succeeded",
      progress: { stage: "DONE", message: "Backtest complete", pct: 100, ts: Date.now() },
      resultMeta: { id: result?.report?.id || null },
      type: String(job.type || "")
    });
    return true;
  }

  throw new Error(`UNKNOWN_JOB_TYPE: ${job.type}`);
}

/**
 * Main Worker Loop
 */
async function loop() {
  while (!stopping) {
    let job = null;
    try {
      job = await jobQueue.claimNext({ workerId: WORKER_ID });
    } catch (err) {
      log.warn(`[JOB_WORKER] Claim failed: ${err.message}`);
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    if (!job) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    try {
      await handleJob(job);
    } catch (err) {
      const msg = String(err?.message || err);
      log.error(`[JOB_WORKER] Job ${job.id} failed: ${msg}`);
      
      await jobQueue.updateProgress({
        id: job.id,
        status: "failed",
        progress: { stage: "FAILED", message: msg, pct: 100, ts: Date.now() },
        error: msg
      }).catch(() => {});
      emitParent("BACKTEST_PROGRESS", {
        jobId: String(job.id || ""),
        userId: String(job.userId || ""),
        status: "failed",
        progress: { stage: "FAILED", message: msg, pct: 100, ts: Date.now() },
        error: msg,
        type: String(job.type || "")
      });

      // Retry Logic: Server decides based on attempts remaining
      if (Number(job.attempts || 0) < Number(job.maxAttempts || 0)) {
        await db.query(
          "UPDATE corex_jobs SET status='queued', run_at=NOW() + INTERVAL '5 seconds', updated_at=NOW() WHERE id=$1 AND status='failed'",
          [job.id]
        ).catch(() => {});
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Entry Point
 */
async function main() {
  if (!db.hasDbConfig()) {
    throw new Error("POSTGRES_NOT_CONFIGURED: Set DATABASE_URL or equivalent env vars.");
  }

  // Ensure DB schema is ready before worker starts polling
  await dbMigrator.run();

  log.info(`[JOB_WORKER] Started | ID: ${WORKER_ID} | Poll: ${POLL_INTERVAL_MS}ms`);
  await loop();
}

/**
 * Graceful Shutdown
 */
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`[JOB_WORKER] Received ${signal}. Closing connections...`);
  
  try {
    await db.close();
  } catch (e) {
    log.error(`Error during DB close: ${e.message}`);
  }
  
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  log.error(`[JOB_WORKER] Fatal Error: ${err.message}`);
  process.exit(1);
});
