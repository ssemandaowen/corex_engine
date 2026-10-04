# J9 — "Stuck in queued" backtest bug: lifecycle trace

> Branch: `jules/j9-queued-bug`. Investigation-first (issue #8).
> Scope: trace the job-queue lifecycle `enqueue → pick up → run → complete/fail`, and enumerate every place a job can be left in `queued`.

## The state machine (OBSERVED)

```
enqueue (jobQueue.js:56)
  └─ INSERT corex_jobs (status='queued', attempts=0, run_at=NOW() or payload.runAt)
       │
       ▼
claimNext (jobQueue.js:164)   ← worker polls this every POLL_INTERVAL_MS (750ms)
  └─ WHERE status='queued' AND run_at <= NOW() AND attempts < max_attempts
  └─ SET status='running', locked_at=NOW(), locked_by=workerId, attempts=attempts+1
       │
       ▼
handleJob (jobWorker.js:76)
  ├─ emitProgress STARTED
  ├─ heartbeat interval (HEARTBEAT_MS=5000) → jobQueue.heartbeat (jobQueue.js:144)
  │     └─ UPDATE locked_at=NOW() WHERE status='running' AND locked_by=workerId
  ├─ cancel-poll interval (CANCEL_POLL_MS=5000) → getJob; if status='cancelled' set abortRequested
  ├─ handler(job)  (backtestRun.js:10)
  │     └─ on success: updateProgress(status='succeeded', expectedStatuses=['running'])  (jobWorker.js:171)
  │     └─ on error:   updateProgress(status='failed',   expectedStatuses=['running'])  (jobWorker.js:258)
  │                       └─ if failed && !nonRetryable && attempts < maxAttempts:
  │                            scheduleRetry(status='queued', run_at=NOW()+delayMs)  (jobWorker.js:310, jobQueue.js:267)
       │
       ▼
terminal: 'succeeded' | 'failed' | 'cancelled'
```

Recovery path (OBSERVED):
```
requeueStaleRunningJobs (jobQueue.js:289)  ← runs at worker startup (jobWorker.js:331)
                                              and every STALE_REQUEUE_INTERVAL_MS (30s) (jobWorker.js:339)
  └─ WHERE status='running' AND (locked_at IS NULL OR locked_at < NOW() - staleMs)
  └─ SET status = (attempts >= max_attempts ? 'failed' : 'queued'),
       run_at = (attempts >= max_attempts ? run_at : NOW() + 2000ms),
       locked_at=NULL, locked_by=NULL
```

## Every place a job can be left in `queued`

### 1. Worker never started / not running — MOST LIKELY (OBSERVED)
`jobWorkerSupervisor.start()` is called only from `index.js:144-146`, and **only when
`db.hasDbConfig()` is true**. The supervisor forks `engine/workers/jobWorker.js`
(`jobWorkerSupervisor.js:36-44`). If the supervisor is not running (autostart disabled via
`COREX_JOB_WORKER_AUTOSTART=0`, fork failed, or the process exited), **nothing ever calls
`claimNext`**, so every enqueued job stays `queued` forever. The enqueue path
(`backtestController.js:847`) returns HTTP 202 immediately and does not verify a worker is
alive. There is no health check that fails enqueue when the worker is down.

- Evidence: `index.js:144-146` (start gated on `db.hasDbConfig()`), `jobWorkerSupervisor.js:22-30`
  (`_enabled()` reads `COREX_JOB_WORKER_AUTOSTART`), `backtestController.js:847-877` (enqueue → 202, no worker liveness check).

### 2. `run_at` in the future — by design, but can look "stuck" (OBSERVED)
`enqueue` accepts `runAt` (`jobQueue.js:62`); `claimNext` requires `run_at <= NOW()`
(`jobQueue.js:183`). A job enqueued with a future `run_at` (or re-queued by
`scheduleRetry`/`requeueStaleRunningJobs` with `run_at = NOW() + delayMs`) will not be
claimed until that time. `scheduleRetry` uses `backoffDelayMs` (base 5s, max 60s)
(`jobWorker.js:64-71, 308`), so a retrying job is intentionally `queued` for up to ~60s
per attempt. With `maxAttempts=2` (`backtestController.js:857`), a job that fails once can
sit in `queued` for the backoff window before its second attempt.

- Evidence: `jobQueue.js:62,183`, `jobQueue.js:267-287` (scheduleRetry), `jobWorker.js:307-311`.

### 3. `attempts` exhausted while `queued` — terminal-stuck (OBSERVED)
`claimNext` filters `attempts < max_attempts` (`jobQueue.js:184`). If a job is claimed
(`attempts` incremented to `max_attempts`) but the worker dies **before** writing a terminal
status, `requeueStaleRunningJobs` sets `status='failed'` (because `attempts >= max_attempts`)
— that is correct. **But** if the job was re-queued by `scheduleRetry` and then the worker
dies before claiming it again, the row stays `queued` with `attempts == max_attempts`, and
`claimNext` will **never** pick it up (the `attempts < max_attempts` filter excludes it).
The job is permanently stuck in `queued` with no terminal status and no recovery path —
`requeueStaleRunningJobs` only recovers `status='running'` rows, not `queued` rows that have
exhausted their attempts.

- Evidence: `jobQueue.js:184` (claim filter), `jobQueue.js:275-282` (scheduleRetry only fires when `attempts < max_attempts`), `jobQueue.js:289-324` (requeueStaleRunningJobs only touches `status='running'`).

### 4. Swallowed error in `handleJob` success path (OBSERVED)
In `handleJob`, the terminal `updateProgress(status='succeeded', expectedStatuses=['running'])`
is wrapped in `.catch(() => false)` (`jobWorker.js:171-178`). If the DB write fails, `succeeded`
is `false`, and the worker emits a `CANCELLED` progress event (`jobWorker.js:195-204`) but the
job row remains `running` (not `queued`). It is later recovered by `requeueStaleRunningJobs`
→ back to `queued` (if attempts remain). So a transient DB failure on the success write
manifests as a job that appears to run, then silently returns to `queued` and runs again.

- Evidence: `jobWorker.js:171-204`.

### 5. `expectedStatuses` guard rejects the terminal write (OBSERVED)
`updateProgress` only transitions to `succeeded`/`failed` when the current `status = 'running'`
(`jobQueue.js:235-236`). If the job was concurrently moved out of `running` — e.g.
`requeueStaleRunningJobs` flipped it back to `queued` because the heartbeat lapsed (stale lock)
while the handler was still executing — then the terminal `updateProgress` matches **zero rows**
(`rowCount=0`), `succeeded`/`failed` is `false`, and the job is left in `queued` (by the
recovery path) even though the handler completed. The heartbeat interval (5s) vs. the stale
threshold (`COREX_JOB_LOCK_STALE_MS`, default 15 min) makes this rare but possible for a
long-running backtest whose heartbeat write fails repeatedly.

- Evidence: `jobQueue.js:232-239` (status transition guard), `jobQueue.js:289-324` (recovery flips running→queued), `jobWorker.js:134-137` (heartbeat).

### 6. Missing `await` on `scheduleRetry` is NOT a cause (OBSERVED, ruled out)
`jobWorker.js:310` does `await jobQueue.scheduleRetry(...)` inside the catch, so the retry
re-queue is awaited before the loop continues. Not a missing-await bug.

### 7. Restart without recovery — partially mitigated (OBSERVED)
On worker restart, `main()` calls `requeueStaleRunningJobs()` once (`jobWorker.js:331`) before
the poll loop, so `running` jobs left by a dead worker are recovered. This covers the
crash-mid-run case. It does **not** cover cause #3 (queued + attempts exhausted) or cause #1
(worker never started).

- Evidence: `jobWorker.js:329-337`.

## Most likely cause

**Cause #1 (worker not running) is the most likely root cause of "backtests remain in queued"**
as reported in issue #8, because:
- It is the only cause that produces a *permanent* `queued` state with no recovery path and no
  error.
- The enqueue path returns 202 without verifying a worker is alive.
- The supervisor is gated behind `db.hasDbConfig()` and `COREX_JOB_WORKER_AUTOSTART`, both of
  which can be false in environments where the HTTP API is up but the worker is not.

**Cause #3 (attempts exhausted while queued) is the second most likely** because it is also
permanent and silent: a job that fails its last attempt's *claim* (worker dies between
`scheduleRetry` and re-claim) is stranded in `queued` with `attempts == max_attempts`, and
neither `claimNext` nor `requeueStaleRunningJobs` will ever touch it.

## Reproducing test

A failing test reproducing **cause #3** (the small, one-function, provable cause) is in
`test/jobQueueStuckQueued.test.js`. It uses a fake `db` (no real Postgres) and proves that a
job re-queued by `scheduleRetry` whose worker then dies before re-claiming is never returned by
`claimNext` and never recovered by `requeueStaleRunningJobs` — i.e. it is stuck in `queued`
forever.

## Fix assessment

The fix for cause #3 is **not** a one-function change: it requires either
(a) a recovery sweep that fails `queued` jobs with `attempts >= max_attempts` (analogous to
`requeueStaleRunningJobs` but for the `queued` state), or
(b) `scheduleRetry` refusing to re-queue when `attempts >= max_attempts` (writing `failed`
instead). Both touch the queue's recovery semantics. Per the task rules ("Fix ONLY if the cause
is small (one function) and the test proves it. Otherwise stop after the test and the trace"),
this task stops after the trace and the reproducing test. The fix is recorded as a follow-up for
Owen/Kilo Code.
