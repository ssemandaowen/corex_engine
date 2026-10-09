"use strict";

/**
 * J9 — Reproducing test for the "stuck in queued" backtest bug (issue #8).
 *
 * Reproduces cause #3 from plans/Audit/j9-queued-trace.md:
 * a job that is re-queued by scheduleRetry (or requeueStaleRunningJobs) and then
 * never re-claimed by a worker ends up permanently stuck in 'queued' once its
 * attempts reach max_attempts, because:
 *   - claimNext filters `attempts < max_attempts` (jobQueue.js:184), so it will
 *     never be picked up again; and
 *   - requeueStaleRunningJobs only recovers `status = 'running'` rows
 *     (jobQueue.js:302), so a stranded `queued` row is never touched.
 *
 * Uses an in-memory fake for @core/services/postgres — no real DB required.
 */

const fakeDb = require("../engine/services/postgres");

// In-memory corex_jobs table keyed by id.
const rows = new Map();

function clone(o) {
    return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}

// Minimal fake that implements the surface jobQueue uses: hasDbConfig, query,
// withTransaction. SQL is matched by substring so the test stays decoupled from
// exact SQL text.
const fakePool = {
    query: async (text, params = []) => {
        const sql = String(text).replace(/\s+/g, " ").trim();

        // INSERT ... RETURNING *
        if (sql.startsWith("INSERT INTO corex_jobs")) {
            const job = {
                id: params[0],
                type: params[1],
                status: "queued",
                user_id: params[2],
                payload: params[3] ? JSON.parse(params[3]) : {},
                progress: {},
                result: null,
                error: null,
                attempts: 0,
                max_attempts: params[4],
                run_at: params[5] || null,
                locked_at: null,
                locked_by: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            rows.set(job.id, job);
            return { rows: [clone(job)], rowCount: 1 };
        }

        // claimNext: WITH cte ... UPDATE ... RETURNING j.*
        if (sql.includes("FOR UPDATE SKIP LOCKED") && sql.includes("status = 'running'")) {
            const wid = params[0];
            // find first queued job with run_at <= now and attempts < max_attempts
            const now = Date.now();
            const candidate = [...rows.values()]
                .filter((j) =>
                    j.status === "queued" &&
                    j.attempts < j.max_attempts &&
                    (!j.run_at || new Date(j.run_at).getTime() <= now)
                )
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
            if (!candidate) return { rows: [], rowCount: 0 };
            candidate.status = "running";
            candidate.locked_at = new Date().toISOString();
            candidate.locked_by = wid;
            candidate.attempts += 1;
            candidate.updated_at = new Date().toISOString();
            return { rows: [clone(candidate)], rowCount: 1 };
        }

        // updateProgress: UPDATE corex_jobs SET status = CASE ...
        if (sql.startsWith("UPDATE corex_jobs") && sql.includes("COALESCE($3::jsonb")) {
            const jid = params[0];
            const statusVal = params[1];
            const job = rows.get(jid);
            if (!job) return { rows: [], rowCount: 0 };
            // honor expectedStatuses ($8) and lockedBy ($9/$8)
            const expected = params[7];
            const locked = params[8] !== undefined && expected ? params[8] : (expected ? undefined : params[7]);
            if (expected && Array.isArray(expected) && !expected.includes(job.status)) {
                return { rows: [], rowCount: 0 };
            }
            if (locked && job.locked_by !== locked) {
                return { rows: [], rowCount: 0 };
            }
            if (statusVal) {
                // mirror the CASE guard: succeeded/failed only from running
                if (["succeeded", "failed"].includes(statusVal) && job.status !== "running") {
                    return { rows: [], rowCount: 0 };
                }
                job.status = statusVal;
            }
            if (params[2]) job.progress = JSON.parse(params[2]);
            if (params[3]) job.result = JSON.parse(params[5]);
            if (params[4]) job.error = params[6];
            if (["succeeded", "failed", "cancelled"].includes(statusVal)) {
                job.locked_at = null;
                job.locked_by = null;
            }
            job.updated_at = new Date().toISOString();
            return { rows: [clone(job)], rowCount: 1 };
        }

        // scheduleRetry: UPDATE ... SET status='queued', run_at = NOW() + delay WHERE status='failed' AND attempts < max_attempts
        if (sql.startsWith("UPDATE corex_jobs") && sql.includes("status = 'failed'")) {
            const jid = params[0];
            const job = rows.get(jid);
            if (!job || job.status !== "failed" || job.attempts >= job.max_attempts) {
                return { rows: [], rowCount: 0 };
            }
            job.status = "queued";
            job.run_at = new Date(Date.now() + Number(params[1])).toISOString();
            job.locked_at = null;
            job.locked_by = null;
            job.updated_at = new Date().toISOString();
            return { rows: [clone(job)], rowCount: 1 };
        }

        // requeueStaleRunningJobs: WITH cte ... WHERE status='running' ...
        if (sql.includes("status = 'running'") && sql.includes("FOR UPDATE SKIP LOCKED") && sql.includes("CASE WHEN attempts >= max_attempts")) {
            const staleMs = Number(params[0]);
            const limit = Number(params[1]);
            const now = Date.now();
            const stale = [...rows.values()]
                .filter((j) =>
                    j.status === "running" &&
                    (!j.locked_at || now - new Date(j.locked_at).getTime() > staleMs)
                )
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                .slice(0, limit);
            const out = [];
            for (const j of stale) {
                if (j.attempts >= j.max_attempts) {
                    j.status = "failed";
                    j.error = j.error || "WORKER_STALE";
                } else {
                    j.status = "queued";
                    j.run_at = new Date(now + 2000).toISOString();
                }
                j.locked_at = null;
                j.locked_by = null;
                j.updated_at = new Date().toISOString();
                out.push({ id: j.id, status: j.status });
            }
            return { rows: out, rowCount: out.length };
        }

        throw new Error(`fakeDb: unhandled SQL: ${sql.slice(0, 120)}`);
    },
    connect: async () => ({
        query: async () => ({}),
        release: () => {},
    }),
};

jest.mock("../engine/services/postgres", () => ({
    hasDbConfig: () => true,
    getPool: () => fakePool,
    query: (text, params) => fakePool.query(text, params),
    withTransaction: async (fn) => {
        const client = { query: (text, params) => fakePool.query(text, params), release: () => {} };
        return fn(client);
    },
    close: async () => {},
    getStats: () => ({ enabled: true }),
}));

// Require AFTER the mock is installed.
const jobQueue = require("../engine/services/jobQueue");

describe("J9 — stuck-in-queued reproduction (issue #8)", () => {
    beforeEach(() => {
        rows.clear();
    });

    test("a job re-queued by scheduleRetry that exhausts its attempts is never claimed again and never recovered", async () => {
        // 1. Enqueue a backtest job with maxAttempts=2 (as backtestController does).
        const job = await jobQueue.enqueue({
            type: "backtest.run",
            userId: "u1",
            payload: { strategyId: "s1" },
            maxAttempts: 2,
        });
        expect(job.status).toBe("queued");
        expect(job.attempts).toBe(0);

        // 2. Worker claims it -> running, attempts=1.
        const claimed = await jobQueue.claimNext({ workerId: "w1" });
        expect(claimed.id).toBe(job.id);
        expect(claimed.status).toBe("running");
        expect(claimed.attempts).toBe(1);

        // 3. Worker fails it -> failed (attempts=1 < maxAttempts=2).
        const failed = await jobQueue.updateProgress({
            id: job.id,
            status: "failed",
            error: "boom",
            expectedStatuses: ["running"],
            lockedBy: "w1",
        });
        expect(failed).toBe(true);
        expect(rows.get(job.id).status).toBe("failed");

        // 4. Worker schedules a retry -> back to queued with a future run_at.
        const retried = await jobQueue.scheduleRetry({ id: job.id, delayMs: 5000 });
        expect(retried).toBe(true);
        const afterRetry = rows.get(job.id);
        expect(afterRetry.status).toBe("queued");
        expect(afterRetry.attempts).toBe(1); // attempts NOT incremented by scheduleRetry

        // 5. Simulate the worker dying before re-claiming: the retry's run_at
        //    passes, but no worker ever calls claimNext again. The job sits in
        //    'queued'. Now force attempts to max_attempts (as would happen if the
        //    job were claimed once more and failed again, then scheduleRetry was
        //    called but the worker died before the final claim).
        afterRetry.attempts = 2; // == max_attempts
        afterRetry.status = "queued";

        // 6. claimNext must NOT return it (attempts < max_attempts filter).
        const reclaimed = await jobQueue.claimNext({ workerId: "w2" });
        expect(reclaimed).toBeNull();

        // 7. requeueStaleRunningJobs must NOT touch it (only recovers 'running').
        const recovered = await jobQueue.requeueStaleRunningJobs({ staleMs: 1000 });
        expect(recovered.requeued).toBe(0);
        expect(recovered.failed).toBe(0);

        // 8. The job is permanently stuck in 'queued' with a terminal attempt
        //    count and no path forward — this is the bug.
        const stranded = rows.get(job.id);
        expect(stranded.status).toBe("queued");
        expect(stranded.attempts).toBe(stranded.max_attempts);
    });

    test("a normal job completes: queued -> running -> succeeded", async () => {
        const job = await jobQueue.enqueue({
            type: "backtest.run",
            userId: "u1",
            payload: { strategyId: "s1" },
            maxAttempts: 2,
        });
        const claimed = await jobQueue.claimNext({ workerId: "w1" });
        expect(claimed.status).toBe("running");
        const ok = await jobQueue.updateProgress({
            id: job.id,
            status: "succeeded",
            result: { report: { meta: { id: "r1" } } },
            expectedStatuses: ["running"],
            lockedBy: "w1",
        });
        expect(ok).toBe(true);
        expect(rows.get(job.id).status).toBe("succeeded");
    });
});
