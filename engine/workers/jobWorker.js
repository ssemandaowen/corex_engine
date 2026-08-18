"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const os = require("os");
const logger = require("@utils/logger");
const dbMigrator = require("@root/db/migrate");
const db = require("@core/services/postgres");
const jobQueue = require("@core/services/jobQueue");
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { handlers: JOB_HANDLERS } = require("./jobs");

const log = logger.createModuleLogger("JOB_WORKER", { 
    category: "worker", 
    ui: true 
});

// Constants
const WORKER_ID = String(process.env.COREX_WORKER_ID || `${os.hostname()}:${process.pid}`);
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.COREX_JOB_WORKER_INTERVAL_MS || 750));
const IDLE_SLEEP_MS = Math.max(250, Number(process.env.COREX_JOB_WORKER_IDLE_MS || 1000));
const HEARTBEAT_MS = Math.max(1000, Number(process.env.COREX_JOB_WORKER_HEARTBEAT_MS || 5000));
const CANCEL_POLL_MS = Math.max(1000, Number(process.env.COREX_JOB_WORKER_CANCEL_POLL_MS || 5000));
const STALE_REQUEUE_INTERVAL_MS = Math.max(5000, Number(process.env.COREX_JOB_STALE_REQUEUE_INTERVAL_MS || 30_000));

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
 * @param {number} ms - milliseconds to sleep
 * @param {boolean} unref - if true, call .unref() on timer so Node can exit
 */
async function sleep(ms, unref = false) {
    return new Promise((r) => {
        const timer = setTimeout(r, ms);
        // FIX 1: Allow Node to exit cleanly without waiting for idle timers
        if (unref && typeof timer.unref === "function") {
            timer.unref();
        }
    });
}

function backoffDelayMs(attempt, { baseMs = 5000, maxMs = 60_000, jitterRatio = 0.2 } = {}) {
    const a = Math.max(1, Number(attempt || 1));
    const base = Math.max(250, Number(baseMs || 5000));
    const cap = Math.max(base, Number(maxMs || 60_000));
    const exp = Math.min(cap, base * (2 ** Math.max(0, a - 1)));
    const jitter = Math.floor(exp * Math.max(0, Math.min(0.9, Number(jitterRatio || 0.2))) * (Math.random() - 0.5) * 2);
    return Math.max(0, Math.min(cap, exp + jitter));
}

/**
 * Job Dispatcher
 */
async function handleJob(job) {
    if (!job) return null;

    const jobId = String(job.id || "").trim();
    const jobType = String(job.type || "").trim();
    const userId = String(job.userId || "").trim();
    const handler = JOB_HANDLERS[jobType];
    if (!handler) throw new Error(`UNKNOWN_JOB_TYPE: ${jobType || "n/a"}`);

    let abortRequested = false;
    const isAbortRequested = () => abortRequested;

    const steps = [];
    const emitProgress = async ({ stage, message, pct, ts, runtimeId } = {}) => {
        const s = String(stage || "RUNNING");
        const m = sanitizeText(message || "");
        const p = Number.isFinite(Number(pct)) ? Number(pct) : null;
        const t = Number.isFinite(Number(ts)) ? Number(ts) : Date.now();

        // Maintain a history of distinct steps for the UI logs
        const lastStep = steps[steps.length - 1];
        if (!lastStep || lastStep.stage !== s || (s !== "SIMULATING" && lastStep.message !== m)) {
            steps.push({ stage: s, message: m, pct: p, ts: t });
        }

        const progress = {
            stage: s,
            message: m,
            pct: p,
            ts: t,
            steps,
            ...(runtimeId ? { runtimeId: String(runtimeId) } : {})
        };

        // Emit to UI immediately
        emitParent("BACKTEST_PROGRESS", {
            jobId,
            progressJobId: jobId,
            userId,
            status: "RUNNING",
            progress,
            runtimeId: progress.runtimeId || null,
            type: jobType
        });

        // Then persist to DB
        await jobQueue.updateProgress({
            id: jobId,
            progress,
            lockedBy: WORKER_ID
        }).catch(() => {});
    };

    await emitProgress({ stage: "STARTED", message: `Job picked up by worker (${WORKER_ID})`, pct: 0 });

    let hbTimer = null;
    let cancelTimer = null;
    try {
        hbTimer = setInterval(() => {
            jobQueue.heartbeat({ id: jobId, workerId: WORKER_ID }).catch(() => {});
        }, HEARTBEAT_MS);
        hbTimer.unref?.();

        cancelTimer = setInterval(async () => {
            if (abortRequested) return;
            const fresh = await jobQueue.getJob({ id: jobId }).catch(() => null);
            if (fresh?.status === "cancelled") {
                abortRequested = true;
                await emitProgress({ 
                    stage: "CANCEL_REQUESTED", 
                    message: "Cancellation acknowledged. Stopping worker...", 
                    pct: null 
                });
            }
        }, CANCEL_POLL_MS);
        cancelTimer.unref?.();

        let result;
        try {
            result = await handler(job, {
                compiler,
                emitProgress,
                isAbortRequested
            });
        } catch (err) {
            const msg = err.message || String(err);
            const isCancel = msg === "JOB_CANCELLED" || err?.code === "JOB_CANCELLED";
            await emitProgress({ 
                stage: isCancel ? "CANCELLED" : "ERROR", 
                message: isCancel ? "Job cancelled by user" : `Execution failed: ${msg}`,
                pct: 100 
            });
            throw err;
        }

        const succeeded = await jobQueue.updateProgress({
            id: jobId,
            status: "succeeded",
            progress: { stage: "DONE", message: "Job complete", pct: 100, ts: Date.now(), steps },
            result,
            expectedStatuses: ["running"],
            lockedBy: WORKER_ID
        }).catch(() => false);

        if (succeeded) {
            const rawReportId = result?.report?.meta?.id ? String(result.report.meta.id) : "";
            const prefix = userId ? `${userId}__` : "";
            const publicReportId = rawReportId && prefix && rawReportId.startsWith(prefix)
                ? rawReportId.slice(prefix.length)
                : rawReportId;
            emitParent("BACKTEST_PROGRESS", {
                jobId,
                progressJobId: jobId,
                userId,
                status: "DONE",
                progress: { stage: "DONE", message: "Job complete", pct: 100, ts: Date.now(), steps },
                resultMeta: { id: publicReportId || null },
                type: jobType
            });
        } else {
            emitParent("BACKTEST_PROGRESS", {
                jobId,
                progressJobId: jobId,
                userId,
                status: "CANCELLED",
                progress: { stage: "CANCELLED", message: "Job was cancelled", pct: 100, ts: Date.now() },
                type: jobType
            });
        }

        return true;
    } finally {
        if (hbTimer) clearInterval(hbTimer);
        if (cancelTimer) clearInterval(cancelTimer);
    }
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
            // FIX 1: Allow Node to exit gracefully — pass unref=true for idle sleep
            await sleep(IDLE_SLEEP_MS, true);
            continue;
        }

        if (!job) {
            // FIX 1: Allow Node to exit gracefully — pass unref=true for idle sleep
            await sleep(IDLE_SLEEP_MS, true);
            continue;
        }

        log.info(`[JOB_WORKER] Claimed job ${job.id} type=${job.type} attempt=${Number(job.attempts || 0)}/${Number(job.maxAttempts || 0)}`);

        try {
            await handleJob(job);
        } catch (err) {
            const msg = String(err?.message || err);
            const isCancel = msg === "JOB_CANCELLED" || err?.code === "JOB_CANCELLED";
            log[isCancel ? "info" : "error"](`[JOB_WORKER] Job ${job.id} ${isCancel ? "cancelled" : "failed"}: ${msg}`);
      
            // Emit error to UI IMMEDIATELY before DB update
            const jobId = String(job.id || "");
            const userId = String(job.userId || "");
            const type = String(job.type || "");
      
            emitParent("BACKTEST_PROGRESS", {
                jobId,
                progressJobId: jobId,
                userId,
                status: isCancel ? "CANCELLED" : "ERROR",
                progress: { stage: isCancel ? "CANCELLED" : "ERROR", message: isCancel ? "Job cancelled by user" : msg, pct: 100, ts: Date.now() },
                error: isCancel ? null : msg,
                type
            });
      
            const failed = await jobQueue.updateProgress({
                id: job.id,
                status: "failed",
                progress: { stage: "FAILED", message: msg, pct: 100, ts: Date.now() },
                error: msg,
                expectedStatuses: ["running"],
                lockedBy: WORKER_ID
            }).catch(() => false);

            // Emit final status after DB update
            if (failed) {
                emitParent("BACKTEST_PROGRESS", {
                    jobId,
                    progressJobId: jobId,
                    userId,
                    status: "ERROR",
                    progress: { stage: "FAILED", message: msg, pct: 100, ts: Date.now() },
                    error: msg,
                    type
                });
            } else {
                emitParent("BACKTEST_PROGRESS", {
                    jobId,
                    progressJobId: jobId,
                    userId,
                    status: "CANCELLED",
                    progress: { stage: "CANCELLED", message: "Job was cancelled", pct: 100, ts: Date.now() },
                    type
                });

                // Persist terminal stage to DB so polling eventually clears the spinner
                await jobQueue.updateProgress({
                    id: job.id,
                    progress: { stage: "CANCELLED", message: "Job was cancelled", pct: 100, ts: Date.now() },
                    lockedBy: WORKER_ID
                }).catch(() => {});
            }

            // Retry Logic: Server decides based on attempts remaining
            const attempts = Number(job.attempts || 0);
            const maxAttempts = Number(job.maxAttempts || 0);
            const retryBaseMs = Math.max(250, Number(process.env.COREX_JOB_RETRY_BASE_MS || 5000));
            const retryMaxMs = Math.max(retryBaseMs, Number(process.env.COREX_JOB_RETRY_MAX_MS || 60_000));

            const nonRetryable =
        msg.startsWith("UPLOAD_FILE_MISSING")
        || msg.includes("ENOENT: no such file or directory")
        || msg.includes("INVALID_FILE_TYPE");

            if (failed && !nonRetryable && attempts < maxAttempts) {
                const delayMs = backoffDelayMs(attempts, { baseMs: retryBaseMs, maxMs: retryMaxMs });
                log.warn(`[JOB_WORKER] Scheduling retry job=${job.id} in ${delayMs}ms (attempt ${attempts}/${maxAttempts})`);
                await jobQueue.scheduleRetry({ id: job.id, delayMs }).catch(() => {});
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

    // Best-effort recovery for jobs left "running" by a dead worker.
    try {
        const recovered = await jobQueue.requeueStaleRunningJobs();
        if ((recovered?.requeued || 0) > 0 || (recovered?.failed || 0) > 0) {
            log.warn(`[JOB_WORKER] Recovered stale running jobs: requeued=${recovered.requeued || 0} failed=${recovered.failed || 0}`);
        }
    } catch (e) {
        log.warn(`[JOB_WORKER] Stale job recovery failed: ${e?.message || e}`);
    }

    const staleTimer = setInterval(() => {
        jobQueue.requeueStaleRunningJobs().catch(() => {});
    }, STALE_REQUEUE_INTERVAL_MS);
    staleTimer.unref?.();

    log.info(`[JOB_WORKER] Started | ID: ${WORKER_ID} | Poll: ${POLL_INTERVAL_MS}ms`);
    try {
        await loop();
    } finally {
        clearInterval(staleTimer);
    }
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