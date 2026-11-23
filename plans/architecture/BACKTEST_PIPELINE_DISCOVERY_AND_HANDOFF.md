# Backtest Pipeline Discovery and Handoff Plan

**Document type:** Read-only discovery plan and continuity handoff (not an implementation task)
**Tracking:** Backlog B10 in `plans/ROADMAP.md`
**Related implementation phase:** BT-1/BT-2 — new `corex-backtest` package; P7 requires re-scope to avoid duplicate extraction
**Related prerequisite:** BT-0 baseline review before package implementation; STAGE-4 remains a gate for engine dataset integration/cutover
**Baseline inspected:** `main` at `3c4f11c1de997561a22fa8763f86b3a23fec4ea4` (2026-11-20)
**Approval authority:** Owen Ssemanda
**Current state:** SOURCE SCAN COMPLETE — Owen reports BT-0a ownership map and BT-0b failed-job triage complete; evidence review and BT-0c golden-run harness remain. Package implementation is scheduled but not yet authorized pending BT-0 review and Owen's implementation approval.

---

## 1. Purpose

Build one evidence-backed picture of how CoreX backtesting works from the user's upload action to the final report and its later retrieval/deletion. Use that picture to decide what data should be stored, what should be processed, how jobs should execute, what information should move between components, and which features or duplicated responsibilities are unnecessary.

The outcome must be a small, clear architecture with explicit ownership and predictable resource use—not a forest of files, abstractions or new infrastructure.

This document is the continuity anchor for future agents and sessions. Read it before continuing the audit. Update it with verified findings, exact source references, decisions and open questions. Do not rely on chat history as the source of truth.

## 2. Product and engineering goals

1. **Correctness first:** identical inputs and pinned strategy/config versions must produce reproducible results.
2. **Upload once:** avoid repeated copies and repeated parsing of the same dataset.
3. **Process efficiently:** avoid loading, parsing, sorting, normalizing or serializing the same data repeatedly.
4. **Bound resources:** explicit limits for upload bytes, decompressed bytes, rows/bars, per-job memory, CPU/time, logs, artifacts and concurrent workers.
5. **Fast feedback:** lightweight progress updates without database, IPC or WebSocket traffic for every bar.
6. **Compact reporting:** persist authoritative metrics and report metadata; generate or retrieve large detail artifacts only when needed.
7. **Scalable ownership:** API owns request validation and job creation; workers own execution; dataset services own dataset lifecycle; analytics owns metric calculations; report/artifact services own output lifecycle.
8. **Flexible inputs:** uploaded datasets and supported external market-data sources should enter a defined data contract rather than create separate simulation implementations.
9. **Professional lifecycle:** jobs must support queued, running, cancellation-requested, cancelled, completed and failed states, with retries and cleanup that cannot corrupt active work.
10. **Low operational cost:** prefer the existing PostgreSQL job queue and current storage foundations until measured evidence proves they are insufficient.

## 3. Scope of discovery

Trace the complete path and its callers. Include related frontend code, routes, middleware, database schema/migrations, storage helpers, worker processes, broker contracts, market-data packages, analytics, report readers, downloads, cleanup and tests.

### A. User journey and upload contract

- Trace the actual UI upload form and request through Axios/multipart handling, authentication, authorization, validation and response.
- Identify accepted file types, formats, compression, size/row limits, symbol/timeframe/date metadata and validation rules.
- Determine what is inspected during upload and what is deferred until job execution.
- Trace temporary upload files, final storage, hashing, deduplication, metadata registration and failure cleanup.
- Determine whether one physical dataset can safely serve multiple symbols, timeframes, users or backtests.
- Define the distinction between content hash, dataset registration ID, dataset version and job reference.
- Check atomicity: no visible registered dataset until its file and metadata are valid and committed.
- Check duplicate upload behavior, partial uploads, retry behavior, malicious/invalid files, decompression bombs and path traversal.
- Identify all dataset listing, archive, delete, restore and retention routes and reconcile their behavior.

### B. Dataset representation and preparation

- Inspect CSV parsing, gzip/decompression, DataForge use, row normalization, date parsing, symbol/timeframe handling, sorting and range selection.
- Identify every full-file read, full-array conversion, clone, map/filter/sort pass and serialization.
- Establish whether datasets are already chronologically ordered and how that is verified.
- Compare full in-memory arrays, streaming/batched parsing, indexed files and columnar/typed-array representations using actual workload needs.
- Determine whether upload-time validation/normalization should create a canonical representation or whether preparation belongs to job execution.
- Inspect external-history fetching, caching, warmup and the boundary between uploaded data and downloaded market data.
- Identify duplicate or write-only caches and features without a demonstrated consumer.
- Determine what data needs to be retained for reproducibility and audit.

### C. Job lifecycle and execution

- Trace API request → job record → queue claim → worker spawn/dispatch → strategy resolution → manager call → result persistence.
- Document job state transitions, queue ordering, concurrency, retries, backoff, stale-worker recovery, heartbeat and cancellation.
- Verify idempotency: duplicate submissions, worker crash after simulation but before persistence, retry after partial artifact creation and job recovery.
- Determine whether a worker is isolated per job, reused, or pooled; measure process startup overhead and memory behavior.
- Trace how strategy ID/version, parameters, symbol, timeframe, date range, initial capital, costs, slippage, spread, risk settings and dataset identity are pinned to a job.
- Verify every user-facing setting reaches the actual simulator/broker. Distinguish accepted settings from ignored or defaulted values.
- Establish whether jobs share mutable strategy, broker, data or global state.
- Inspect worker resource limits and what happens when a job exceeds them.

### D. Simulation and broker correctness

- Trace the full bar loop and event lifecycle into the backtest broker.
- Inspect fill simulation, fees, spread, slippage, order types, stop-loss/take-profit, trailing stops, equity, margin, positions and trade accounting.
- Identify whether broker contract behavior is shared correctly with PAPER/LIVE or has duplicated logic.
- Inspect repeated calculations and allocations inside the per-bar hot path.
- Verify deterministic ordering and numeric precision.
- Identify what can be accumulated incrementally and what genuinely requires full history.
- Do not change financial semantics or risk parity during discovery.

### E. Progress, logs and cancellation

- Trace progress production from manager to worker, PostgreSQL, event bus/WebSocket and frontend.
- Measure update frequency and payload size; inspect log capture and retained in-memory arrays.
- Separate job status, progress snapshots, diagnostic logs and domain events.
- Verify cancellation reaches the running simulation loop at a bounded interval and that the worker stops promptly.
- Check whether cancellation cleans temporary files and partial artifacts without deleting shared dataset content.
- Recommend throttling/coalescing, bounded log retention and event delivery only where evidence supports it.

### F. Analytics, reports and artifacts

- Inventory every metric, curve, trade record, chart series and export currently generated.
- Trace analytics inputs and determine whether calculations are repeated or can be accumulated during simulation.
- Identify the authoritative report schema and whether JSON file and PostgreSQL JSONB copies are both required.
- Separate compact report summary from detailed trades, equity curves, drawdown curves and downloadable artifacts.
- Determine which frontend views need which fields and when they request them.
- Inspect report versioning, pagination, chart downsampling, download streaming, filenames, access control, retention and deletion.
- Ensure chart downsampling never changes the authoritative full-resolution simulation or financial metrics.
- Verify that missing values are reported as unavailable, not replaced with invented defaults.

### G. Storage, lifecycle and security

- Map all tables, indexes, constraints and file directories involved in uploads, jobs, reports, trades and artifacts.
- Identify ownership and referential integrity between user, dataset, job, strategy version, report and artifacts.
- Inspect active-job protection, soft delete/archive semantics, garbage collection and orphan cleanup.
- Verify a dataset cannot be removed while queued/running jobs depend on it.
- Inspect user isolation, path safety, access control, storage quotas and retention policies.
- Avoid destructive schema changes in the discovery phase.

### H. Performance and limited-resource profile

Collect reproducible baseline measurements where practical. Record hardware/runtime, dataset size, bar count, strategy, worker count, measurement method and limitations.

Measure at least:
- upload duration and peak memory;
- validation/hash/decompression time;
- bytes written and number of physical copies;
- data preparation time and peak memory;
- simulation bars/second and CPU time;
- per-job and concurrent-job peak RSS;
- progress event count, payload bytes and database writes;
- analytics/report generation time and peak memory;
- report JSON/DB size, trades artifact size and download time;
- worker startup/idle memory and cleanup after completion.

Use representative small, medium and large datasets where available. Do not invent target thresholds. First establish the baseline; then propose targets based on measured workloads and available machine resources.

## 4. Source areas to inspect

This is an initial index, not a claim that these are the only owners. Re-check paths and line numbers against the current branch before citing them.

| Area | Initial paths / symbols |
|---|---|
| Frontend upload and results | `front_end/src/components/run/BacktestSubTab.tsx`, `front_end/src/api/backtest.ts`, relevant Run/Workspace/analytics views |
| Upload/job/report API | `engine/routes/backtestController.js`, `engine/routes/dataController.js` |
| Main orchestration | `engine/backtestManager.js` |
| Worker lifecycle | `engine/workers/jobWorker.js`, `engine/services/jobWorkerSupervisor.js`, `engine/workers/jobs/backtestRun.js` |
| Queue and persistence | `engine/services/pgStore.js`, job-related migrations, database service |
| Dataset resolution | `packages/corex-market-data/src/backtestDataResolver.js`, dataset/storage services |
| Broker/simulation | `packages/corex-broker-contract/`, especially the active BacktestBroker/driver and shared fill logic |
| Analytics | `utils/analytics.js` and all callers |
| Filesystem lifecycle | `utils/storageManager.js`, upload/report cleanup and download handlers |
| Tests | upload, dataset, job queue/worker, manager, broker, analytics, report and cancellation tests |

Before relying on any prior chat finding, reproduce it against the current branch and record exact file/function/line evidence.

## 5. Discovery sequence and deliverables

### Step 0 — Establish baseline and repository map
- Record current main SHA, package scripts, worker startup configuration and storage configuration.
- Locate all routes, consumers, tests, tables, migrations and cleanup paths.
- Deliver: source map and baseline environment record.

### Step 1 — Upload-to-dataset lifecycle
- Follow one real upload from UI to durable storage and dataset listing.
- Document request/response contract, validation, metadata, hashing, deduplication, storage copies and error cleanup.
- Deliver: upload sequence diagram and dataset ownership/lifecycle table.

### Step 2 — Dataset-to-job lifecycle
- Follow a run request into PostgreSQL, queue claim, worker execution and terminal state.
- Document job payload, state machine, retries, cancellation, concurrency and idempotency.
- Deliver: job state diagram, ownership matrix and failure/recovery matrix.

### Step 3 — Simulation and hot-path audit
- Trace data preparation and each bar through strategy and broker.
- Identify expensive loops, repeated sorting/conversion, allocation, duplicate calculations and configuration loss.
- Deliver: simulation call graph, data-shape map and confirmed correctness/performance findings.

### Step 4 — Analytics/report/artifact lifecycle
- Trace calculation → serialization → DB/file persistence → API retrieval → frontend rendering/download → cleanup.
- Classify summary vs detailed artifacts and identify duplicated or unused output.
- Deliver: report schema map, artifact inventory and retention/cleanup matrix.

### Step 5 — Resource baseline and optimization options
- Benchmark representative jobs and concurrent runs.
- Compare current behavior with practical streaming/batching, bounded arrays, compact report storage, chart downsampling and worker limits.
- Deliver: measured baseline, bottleneck ranking and cost/benefit options.

### Step 6 — Feature and complexity review
Classify each capability as:
- **KEEP** — needed and correctly owned;
- **FIX** — valuable but incorrect/unreliable;
- **SIMPLIFY** — useful but implemented with unnecessary complexity;
- **MERGE** — duplicated responsibility with an identified canonical owner;
- **DEFER** — valid but not required for the current product stage;
- **REMOVE CANDIDATE** — no active consumer or product value demonstrated.

A feature is not removed solely because it is unused in one search. Verify callers, API clients, migrations, stored data, external contracts and tests first.

### Step 7 — Architecture and implementation handoff
- Propose the smallest set of modules/services with explicit inputs, outputs and ownership.
- Define the canonical dataset contract, job contract, progress event contract, report schema and artifact references.
- Separate correctness fixes from structural refactors and performance optimizations.
- Order work by dependency and risk; specify regression tests and rollback strategy.
- Map changes to existing roadmap phases (especially STAGE-4 and P7); do not create competing workstreams.
- Deliver: approved-decision register, implementation slices and test/benchmark acceptance matrix.

## 6. Required handoff package

The completed discovery must leave these durable records:

1. `plans/architecture/BACKTEST_PIPELINE_DISCOVERY_AND_HANDOFF.md` — this plan, updated with status, findings, decisions, links and next actions.
2. `plans/architecture/BACKTEST_PIPELINE_OWNERSHIP_MAP.md` — verified end-to-end flow and responsibility matrix.
3. `plans/architecture/BACKTEST_RESOURCE_BASELINE.md` — benchmark methodology, workload samples and results.
4. A concise P7 implementation proposal, only after the discovery and STAGE-4 dependency are reconciled.
5. Roadmap updates that point to the completed deliverables and preserve dependency ordering.

Do not create a separate task file until the corresponding workstream is actually scheduled, consistent with roadmap rule 6.

## 7. Initial leads from the first code pass — NOT YET ACCEPTED AS FINAL FINDINGS

The following are leads to reproduce, not approved defects or implementation instructions:

- The manager appears to combine configuration resolution, data loading/normalization, simulation orchestration, analytics and persistence.
- CSV and compressed input paths appear to materialize large content in memory; repeated conversion/sorting may add avoidable cost.
- Manager-side size-limit handling may suppress its own oversize error; compressed expanded-size limits need checking.
- Simulation configuration propagation and cancellation checks may not be connected end-to-end.
- Upload identity/deduplication may conflate content identity with symbol-specific dataset registration.
- Progress/log capture and report arrays may create unbounded memory and transport overhead.
- Dataset lifecycle routes may have inconsistent archive/delete behavior.
- Market-data cache read/write usage and trades/report cleanup may be asymmetric.
- A controller import may reference an outdated data-resolver path; verify Node alias resolution and server startup before classifying as a startup blocker.

For each lead, record: status (CONFIRMED / DISPROVED / PARTIAL / UNKNOWN), source commit, exact path and line/function, reproduction or test, impact, severity, affected user journey, and proposed owner. Never carry an unverified statement into an implementation task as fact.

## 7A. Step 0 and Step 1 — verified evidence (2026-11-20)

Source baseline: `main` at `ea7e98b3a4faa33b1ce7f70210353aa027cffbeb`. All source paths and line references below were checked against this revision. The local Desktop MCP root contains multiple dirty checkouts and a stale local `origin/main`; it was not used as the source of truth. No source files were changed.

### Step 0 — baseline and repository map

- Root scripts: `start` → `node index.js`; `test` → Jest; `worker:jobs` → `node engine/workers/jobWorker.js`; frontend scripts are delegated through `ui:dev` / `ui:build`.
- Bootstrap order in `index.js`: migrations → config → engine → HTTP server → data culler → live dispatcher → job worker supervisor (only when DB is configured).
- `engine/server.js` eagerly imports `backtestController` while loading route modules; the controller is therefore on the server startup path.
- Upload storage is rooted at `process.cwd()/data/uploads`: `tmp/`, `dedup/`, `by-symbol/`, plus a legacy `index.json`; reports use `data/backtests/`.
- Default upload limits in `backtestController.js`: 50 MB per file, 10 registrations per user, 500 MB per-user quota. `storageManager` has a separate 500 MB / 30-day generic upload cleanup policy for the dedup directory. DB culler defaults: archive after 60 days, purge after 180 days.
- Worker is forked by `jobWorkerSupervisor`; heartbeat default 5 seconds, cancellation polling default 5 seconds. PostgreSQL queue claim uses `FOR UPDATE SKIP LOCKED`.

### Step 1 — upload-to-dataset flow

```text
BacktestSubTab file selection
  → backtestApi.upload(FormData: dataset + symbol)
  → POST /api/backtest/uploads (auth middleware → Multer temp file)
  → file-size/type checks → SHA-256 stream
  → global dedup blob + per-symbol physical copy
  → streaming CSV line scan (bars count + first/last timestamp)
  → backtest_uploads row (or legacy JSON index fallback)
  → UPLOAD_CREATED event + dataset metadata response
  → later POST /api/backtest/:strategyId with uploadId
  → user-scoped lookup + file existence check
  → resolved file path pinned into corex_jobs.payload.options.file.path
```

| Responsibility | Current owner | Verified behavior |
|---|---|---|
| File selection and multipart construction | `BacktestSubTab.tsx`, `front_end/src/api/backtest.ts` | Sends one `dataset` file and `symbol` field. |
| Temporary upload and initial limits | `backtestController.js` / Multer | Writes to `uploads/tmp`; default 50 MB limit; accepts CSV MIME or `.csv` filename. |
| Content identity and physical files | `backtestController.js:hashFile/buildUploadRecord` | Streams SHA-256; stores a content-addressed dedup file and a second symbol-scoped copy. |
| Dataset metadata | `pgStore.js`, migration `014_backtest_data_storage.sql` | PostgreSQL `backtest_uploads`; falls back to `uploads/index.json` when DB/table is unavailable. |
| Dataset selection and job handoff | `backtestController.js` | Looks up by user and upload ID; resolves symbol copy first, dedup copy second; stores resolved path in queued options. |
| Archive/purge | `dataCuller.js` | Gzips old symbol copies; checks queued/running job file paths before purge; soft-deletes metadata after purge. |
| User-requested delete | `backtestController.js` and `dataController.js` | Two routes currently implement different deletion semantics (see findings below). |

### Confirmed findings and open verification

| ID | Status | Evidence and impact | Next verification |
|---|---|---|---|
| UP-01 | CONFIRMED — module path mismatch | `backtestController.js:13` imports `@core/core/backtestDataResolver`, which resolves to `engine/core/backtestDataResolver.js`; that file is absent on this revision. The actual `MAX_BARS_LIMIT` export is in `packages/corex-market-data/index.js` as `@data`. `server.js` eagerly imports the controller, and `index.js` eagerly imports the server. This is a startup-path defect; verify with a clean runtime smoke test before implementation. | Reproduce in a clean worktree and record exact startup error. |
| UP-02 | CONFIRMED — upload identity conflates content and registration | `buildUploadRecord` uses `toScopedId(userId, digest)` as the row ID. Migration 014 defines the row primary key as `id` and a separate unique index on `(user_id, symbol, digest)`; `upsertBacktestUpload` conflicts on `id` and updates `symbol`. Re-uploading identical bytes for another symbol under the same user therefore overwrites the existing registration instead of creating a distinct symbol registration; the old symbol copy may remain orphaned. | Define canonical content ID versus dataset registration/version ID; trace legacy IDs and active jobs before proposing migration. |
| UP-03 | CONFIRMED — quota enforcement fails open on DB errors | Upload route converts any `getBacktestUploadUsageForUser` failure into zero usage, then continues. A DB/table outage can bypass both per-user count and byte quotas, including when metadata falls back to the JSON index. | Decide whether uploads should fail closed when quota state cannot be read; add regression coverage. |
| UP-04 | CONFIRMED — deletion semantics diverge | `DELETE /api/backtest/uploads/:id` hard-deletes the row and removes the symbol copy; `DELETE /api/data/storage/:id` soft-deletes the same table row and removes the symbol copy. The frontend Backtest tab currently uses the former; no frontend caller for `/api/data/storage` was found in the inspected frontend source. | Establish one product-level delete/archive contract and check external/API consumers before consolidation. |
| UP-05 | CONFIRMED — two physical copies are created | A first upload creates a global digest blob and a separate symbol-scoped copy. This supports fallback/self-heal behavior but duplicates storage; the DB culler deliberately does not rewrite shared dedup blobs while archiving symbol copies. | Measure disk amplification and read-path benefit before deciding whether one canonical blob plus metadata is sufficient. |
| UP-06 | PARTIAL — upload scan is not full dataset validation | Hashing and line scanning are streamed. The scan counts non-empty data lines and optionally extracts a timestamp range; scan errors are swallowed and metadata is saved with null bar count/range. It does not validate OHLC values or enforce a decompressed-byte ceiling. | Trace the actual simulation parser and validate malformed CSV/gzip handling and expanded-size limits. |

The frontend Backtest tab's upload request and the server upload route are traced. The separate `/api/data/storage` route is exposed but no frontend caller was found in the inspected source. This is not, by itself, authorization to remove it.

## 7B. Step 2 — dataset-to-job lifecycle (2026-11-20)

### Verified execution sequence

```text
POST /api/backtest/:strategyId
  → validate user, strategy, data source and simulation options
  → resolve selected upload to a filesystem path
  → enqueue corex_jobs row (UUID, type=backtest.run, attempts=0, maxAttempts=2)
  → return HTTP 202 + queue job UUID
  → supervisor forks one jobWorker process when DB is configured
  → worker polls queue and atomically claims oldest eligible job (FOR UPDATE SKIP LOCKED)
  → worker loads strategy source from strategies by name and compiles instance
  → backtestRun passes options + progress + abort callback to backtestManager
  → manager loads bars, simulates, calculates analytics and saves report/artifacts
  → worker writes terminal job result; supervisor relays progress to event bus
  → frontend consumes BACKTEST_PROGRESS over WS and polls REST every 1.5s as fallback
```

### Job state and ownership

```text
queued ──claim──> running ──success──> succeeded
                    │
                    ├──failure──> failed ──retry allowed──> queued
                    │
                    └──user cancel──> cancelled

running ──stale lock──> queued (attempts remain) OR failed (attempt limit reached)
```

| Responsibility | Owner | Verified behavior |
|---|---|---|
| Request validation and job payload | `backtestController.js` | Validates source, symbol, timeframe, capital, range and realism settings; queues options and resolved file path. |
| Durable queue/state | `jobQueue.js` + `corex_jobs` | UUID jobs; atomic oldest-first claim with `FOR UPDATE SKIP LOCKED`; per-user reads/cancellation; attempt count and delayed retry. |
| Worker process lifecycle | `jobWorkerSupervisor.js` | Parent forks one worker by default, relays IPC progress to event bus and restarts an exited child with bounded backoff. |
| Job execution | `jobWorker.js`, `jobs/backtestRun.js` | One job at a time per worker process; heartbeat every 5s; cancellation polling every 5s; stale-lock recovery every 30s (15-minute stale threshold by default). |
| Strategy resolution | `jobs/backtestRun.js` | Queries current `script_body/runtime_params` by strategy name at execution time; it does not pin a strategy version in the job payload. |
| Simulation and report creation | `backtestManager.js` | Receives abort callback; checks before/after data loading and simulation, and inside simulation after each configured batch (default 500 bars). |
| UI progress | `jobWorkerSupervisor.js` → event bus → WS; REST progress endpoint | Worker emits progress immediately and persists snapshots to PostgreSQL; frontend also polls every 1.5s. |

### Confirmed findings and open verification

| ID | Status | Evidence and impact | Next verification |
|---|---|---|---|
| JOB-01 | CONFIRMED — cancellation terminal state can remain stale in DB | `cancelJob` sets `status='cancelled'` and clears `locked_by/locked_at`. Worker progress writes require `locked_by = WORKER_ID`; after the cancellation update, the worker cannot persist its final `CANCELLED` progress stage. The progress endpoint maps a cancelled job to UI status `RUNNING` unless stored progress stage is `CANCELLED` or `FAILED`. REST polling can therefore remain running until the frontend timeout. | Add a deterministic queue/worker cancellation test before selecting a lock/terminal-state correction. |
| JOB-02 | CONFIRMED — UI treats terminal errors/cancellation as success | Both WebSocket and REST handlers test `pct === 100` / `pct >= 100` in the success branch before checking `ERROR`, `FAILED` or `CANCELLED`. Worker error/cancel events use 100%. The UI can call report retrieval instead of presenting the actual terminal state. | Add frontend tests for ERROR, FAILED, CANCELLED and DONE at 100%; status must take precedence over percentage. |
| JOB-03 | CONFIRMED — retry event is presented as terminal | Worker emits an `ERROR` event before it schedules a retry. The Backtest tab clears its active job on ERROR, so a later retry can continue in the queue after the UI has stopped tracking it. | Define non-terminal retry status/progress contract and test retry → success from the UI. |
| JOB-04 | CONFIRMED — strategy source is not pinned to the job | Job payload stores a strategy name/ID and params, but `backtestRun.js` reads the current `script_body/runtime_params` by name when the worker starts. It does not select a `strategy_versions` row or store a source hash. A strategy edit while a job waits in the queue can change what that job executes. | Define reproducibility requirement and inspect strategy version persistence before designing a pinned source reference. |
| JOB-05 | CONFIRMED — archive can invalidate an active job's file path | Dataset archive gzips the symbol file with `deleteSource: true` and updates the upload row, but unlike purge it does not call `isUploadInUse`. Queued job payloads retain the old uncompressed path. The run route's `touchBacktestUploadForUser` call is fire-and-forget, leaving a race with the age-based archive pass. | Reproduce with a queued job and archive candidate; define path-stable dataset references or protect archive as well as purge. |
| JOB-06 | CONFIRMED — cancellation does not interrupt an in-flight provider fetch | Manager passes `shouldAbort` to `fetchGuardedHistory`, but that resolver only consumes symbol, interval, outputsize and progress callback; it never checks the abort callback. Cancellation during online history fetch waits for the fetch to return. | Test slow provider + cancellation; decide on provider abort support and bounded fetch timeout. |
| JOB-07 | CONFIRMED — no enqueue idempotency key | `jobQueue.enqueue` always creates a new UUID and inserts a new row. Repeated identical run requests create independent jobs; no request/idempotency key is checked. | Decide whether duplicate-click/request replay protection is required; do not deduplicate distinct intentional runs. |

### Resource and reliability notes

- The default supervisor starts one worker child; that child processes jobs sequentially. The PostgreSQL queue supports multiple worker processes, but no default worker pool is configured.
- Worker progress snapshots are written to PostgreSQL on each emitted progress update. The manager reports simulation progress at roughly 2% increments; strategy logs can add more events.
- The worker keeps a compact list of distinct progress steps, rather than appending every simulated bar.
- The manager's simulation yields to the event loop at the configured batch interval (default 500 bars), allowing the 5-second cancellation poll and heartbeat timers to run. A synchronous strategy call itself cannot be pre-empted while it blocks the event loop.
- The worker handler returns only report metadata/performance in the queue result; the full report is stored separately by the manager.

## 7C. Step 3 — simulation and data-preparation audit (2026-11-20; partial)

**Source baseline:** `main` at `94c3fb3917fd12b5c396b01d166100dfb56ac71d`. Comparing this with `ea7e98b3a4faa33b1ce7f70210353aa027cffbeb` shows the commits since then changed only this handoff document; inspected application source is unchanged. Findings are code-trace confirmations, not runtime reproductions. No application code or tests were changed or run.

### Verified execution/data path

```text
BacktestManager.run
  → _resolveConfig(options, strategy)
  → StrategyContract.validateAndAdapt
  → construct BacktestBroker with resolved commission/slippage/spread
  → _loadAndNormalizeData
      ├─ offline: read complete CSV or gzip buffer → complete CSV string → DataForge DataFrame
      └─ online: fetchGuardedHistory → normalized rows → DataForge DataFrame
  → _processDataFrame: parse → filter → orderBy → range → toArray
  → bars.sort(time) again
  → _runSimulation: sequential synchronous strategy.onBar; yields between batches
  → broker metrics snapshot → format.buildReport rebuilds trade-derived series
  → report JSON file + full trades CSV + PostgreSQL JSONB report
```

### Confirmed findings

| ID | Status | Evidence and impact | Required follow-up |
|---|---|---|---|
| SIM-01 | CONFIRMED — offline file-size guard does not reject oversize files | `_readCsvAsDataFrame` throws “Dataset too large” inside a try, then catches and suppresses that exact error (lines 376–384). It proceeds to read the file. Gzip is loaded as a complete buffer and synchronously decompressed into a complete string (386–392), with no expanded-byte ceiling. | Add tests for oversized plain CSV, oversized gzip and high-expansion gzip; define compressed and decompressed limits. |
| SIM-02 | CONFIRMED — config resolver drops submitted realism and execution settings | Controller puts `commissionPct`, `slippageBps`, `spread`, `barBudgetMs`, `barBudgetStrikes` and `batchSize` into job options (around 800–830). `_resolveConfig` does not copy these fields. Broker construction therefore receives missing values defaulting to zero; the UI's configured trading costs are not applied. Simulation uses fallback budget/batch values rather than submitted values. | Regression tests must prove every UI/API setting reaches broker and simulator. Do not change fill semantics until characterized. |
| SIM-03 | CONFIRMED — date-range boundaries are discarded | Controller parses and validates `rangeStart`/`rangeEnd`, but omits them from the options object placed in the job. `_resolveConfig` therefore receives undefined values; `_processDataFrame` interprets these as unbounded and selects the whole dataset. BacktestSubTab has rangeMode state but no setter/date controls, so date mode is not selectable through the current screen. | Decide whether date ranges are in the product contract. If yes, carry normalized boundaries end-to-end and test; otherwise reject unsupported mode rather than silently ignoring it. |
| SIM-04 | CONFIRMED — cancellation and online-fetch progress callbacks are lost at manager boundary | `backtestRun.js` supplies `onProgress` and `shouldAbort`; `run()` keeps abort locally but passes options through `_resolveConfig`, which omits both. `_fetchFromBroker` sees null callbacks, and `_runSimulation` checks a missing `config.shouldAbort`. Cancellation during fetch or the bar loop is not observed until simulation returns and the outer abort check runs. Fetch progress is also lost. This strengthens JOB-06: the callback is discarded before the resolver. | Add deterministic cancellation tests during fetch and long simulation, plus fetch-progress propagation tests; define provider timeout/abort contract. |
| SIM-05 | CONFIRMED — data preparation materializes the full input and sorts twice | Offline CSV is synchronously read as one string; gzip is read as one buffer then expanded to one string. DataForge transforms/orders/materializes with `toArray()`; `run()` then sorts the resulting bars again. Online rows are also wrapped in a DataFrame and materialized. This creates multiple full-dataset representations and repeated sorting; peak RSS/time impact is not measured. | Benchmark before choosing streaming, typed arrays or indexed storage. Remove redundant work only with ordering/reproducibility tests. |
| SIM-06 | PARTIAL — OHLCV validation is weaker than a canonical data contract requires | Offline normalization filters finite time and positive close only; open/high/low use zero fallbacks and are not checked for finiteness, positivity or OHLC consistency. Online resolver checks finite OHLC fields but not positivity or high/low/open consistency. Invalid bars may reach strategy/broker logic. | Define canonical bar validation and test missing, non-finite, negative and inconsistent OHLCV rows in both modes. |
| SIM-08 | CONFIRMED — quantity-bearing partial exits close the entire simulated position | `Strategy.exitLong/exitShort/exitAll` resolves a requested exit quantity and emits it on the EXIT signal (`packages/corex-strategy-engine/src/Strategy.js:_resolveExitQuantity`). The manager forwards that signal to `BacktestDriver.execute`, but the driver deletes the full position regardless of `qtyToClose`; the manager also sets its tracked `position = null` after any EXIT. A partial close therefore discards the remainder from both broker and manager state. | Add long/short partial-exit tests across strategy state, manager state, broker position, realized P&L and subsequent exit/protection. Preserve financial semantics until expected contract is agreed. |
| SIM-07 | PARTIAL — report construction and persistence multiply trade-history representations | `MetricsAccumulator` retains trades and equity points; snapshots filter/reduce trades and copy trade/equity arrays. Manager requests snapshots after simulation and again for analytics. `format.buildReport` rebuilds equity from trades and constructs returns, drawdown, underwater and rolling series. Complete report JSON is written to disk and PostgreSQL JSONB, plus a full trades CSV. Duplication is confirmed; wastefulness requires consumer and size measurements. | Complete Step 4 consumer inventory; measure peak RSS, report/JSONB size, CSV size and UI field usage before choosing summary plus on-demand artifacts. |

| SIM-09 | PARTIAL — online market-data cache is written but no read path has been located | `BacktestManager._fetchFromBroker()` invokes `_persistFetchedDataset()`, which upserts rows into `backtest_market_data`; `pgStore` exposes the upsert and expiry deletion methods, but no corresponding getter was found in the inspected manager/store code. This may be write-only storage and adds DB writes/storage without improving subsequent fetches. A repository-wide consumer check remains required before classification. | Search all package/service callers and migration history; if no consumer exists, decide whether to add a cache read path or remove/defer the write-only cache with data-retention review. |

### Simulation/broker observations — not yet accepted as defects

- The bar loop calls `strategy.onBar` synchronously and yields only at batch boundaries. A single synchronous strategy call cannot be pre-empted. The per-bar quota uses `Date.now()` millisecond resolution, so short-call cost is imprecisely measured.
- `BacktestDriver.execute` calculates spread, slippage and commission directly. It also constructs/maintains `SharedFillSim`, but the inspected execute path does not delegate to it. This is a duplicated ownership lead, not a removal decision.
- The partial-exit defect is now classified as SIM-08: strategy exit helpers explicitly resolve and emit requested quantities, while both manager and broker clear the entire position after any EXIT.
- The current driver fill path is bar-close based. `SharedFillSim` has a `fillPolicy` option whose inspected market-order branches currently choose the same reference price; do not infer next-bar semantics from the option name.

### Test coverage and verification limits

The test tree contains focused tests for the guarded online resolver, report file persistence, resolver public API and BacktestBroker event emissions. The inspected tests do not cover manager option propagation, oversized offline file guard, date-range propagation, in-flight cancellation, malformed offline OHLCV or partial exits. GitHub source inspection cannot execute the Windows checkout; no runtime reproduction or benchmark is claimed.

### Step 3 status

**PARTIAL — core data preparation, manager option flow, simulation loop and first broker/report handoff mapped.** Broker accounting edge cases, strategy partial-exit callers, analytics semantics, report consumers and cleanup still need a complete trace. Do not begin P7 recomposition or change financial behavior from this partial audit.

## 7D. Step 4 — analytics, report and artifact audit (2026-11-20; partial)

**Source baseline:** `main` at `756aac6fe1f429b28636ba7fa325b44685817dcb`; application source is unchanged since `ea7e98b3a4faa33b1ce7f70210353aa027cffbeb`. This is a code trace only; no runtime/API download tests or report-size measurements were run.

### Verified report lifecycle

```text
BacktestDriver MetricsAccumulator
  → manager receives full closed-trade list
  → utils/analytics.format.buildReport
      ├─ scalar performance stats
      ├─ trade-exit-based equity/return/drawdown/underwater curves
      ├─ rolling/risk series and histogram/heatmaps
      └─ optional trade preview (manager truncates to 20)
  → manager writes report JSON file
  → manager writes full trade CSV when trades exist
  → manager attempts PostgreSQL JSONB report write
  → GET /api/backtest/:reportId reads PostgreSQL first, JSON file fallback
  → BacktestSubTab renders stats, curves, histogram and trade preview
  → report delete removes PostgreSQL row and JSON file
```

### Confirmed findings

| ID | Status | Evidence and impact | Required follow-up |
|---|---|---|---|
| REP-01 | CONFIRMED — win-rate display scales an already-percent value again | `utils/analytics.js:trades.computeStats` returns `winRate * 100`; `BacktestSubTab.tsx` multiplies `report.performance.winRate` by another 100 for display. A 50% win rate is rendered as 5000%. | Add report-contract/UI tests and choose one canonical unit (fraction or percent) for API values. |
| REP-02 | CONFIRMED — max-drawdown card reads a field not produced by the report | Analytics returns `performance.maxDrawdownPercent`; the UI reads `performance.maxDrawdownPct`, so the displayed card falls back to zero. | Add contract tests for required performance fields and UI rendering. |
| REP-03 | CONFIRMED — drawdown chart plots cumulative return, not drawdown | The UI's `chartData` computes `(equity - initialCapital) / initialCapital` and binds it to the chart labelled “DRAWDOWN EXPOSURE”. The report already contains `analytics.drawdownCurve`, but this chart does not use it. | Verify intended chart definition; use the authoritative drawdown series and test peak-to-trough examples. |
| REP-04 | CONFIRMED — equity chart timestamp is multiplied by 1000 | Manager/data timestamps are normalized to milliseconds; broker trade timestamps and report equity-curve times remain milliseconds. UI maps them with `new Date(c.time * 1000)`, treating milliseconds as seconds and producing invalid/future dates. | Add timestamp-unit contract tests from CSV input through chart rendering. |
| REP-05 | CONFIRMED within the mounted backtest router — trade-download URLs have no matching handler | Manager sets `meta.csvUrl` to `/api/backtest/:id/csv` and saves `.trades.csv`; the mounted `backtestController` defines no CSV/download GET route. Its `fullDownloadUrl` points to `/api/backtest/download/:id`, also with no matching handler in that router. The UI does not render either URL. The controller's >50-trade truncation branch is normally unreachable for newly generated reports because the manager has already truncated `report.trades` to 20. | Confirm no alternate route is mounted elsewhere; define one authenticated, user-scoped, streamed artifact endpoint and expose it in UI only if full trade export is a product feature. |
| REP-06 | CONFIRMED — report deletion and retention leave full-trade CSV artifacts behind | `_saveTradesToCsv` writes `${reportId}.trades.csv`. Report DELETE removes only JSON files and DB row. `storageManager.cleanupBacktestsAsync` enumerates/deletes only `.json` files. CSV artifacts are therefore not removed by either report deletion or report retention cleanup. | Add artifact ownership/manifest and coordinated delete/retention tests; inventory existing orphan CSVs before cleanup. |
| REP-07 | CONFIRMED — full report is duplicated in filesystem and PostgreSQL | `_saveReport` writes the complete report JSON, then `_saveToDatabase` stores the same complete report in JSONB. GET prefers PostgreSQL and falls back to JSON file. This is a deliberate fallback design today, but creates two full copies of curves and preview trades. | Measure storage and failure modes; decide which copy is authoritative and whether fallback should retain a compact snapshot or be moved to object/file storage. |

| REP-08 | CONFIRMED — aggregate commission field is never populated by current backtest report assembly | `MetricsAccumulator.getSnapshot()` does not return `totalCommission`; manager's `gradeStats` supplement passes only profit, maxDrawdownPct and sharpeRatio; `trades.computeStats()` defaults missing `supplement.totalCommission` to zero. The UI's aggregate commissions field therefore always reads zero even if broker commission accounting is later corrected. | Define commission accounting once in broker metrics and pass it through the report contract; test non-zero commission end-to-end. |

| REP-09 | CONFIRMED — automatic report retention does not prune PostgreSQL report rows | The scheduled `DataCuller` calls `storage.cleanupBacktestsAsync` for report files, while its database culling hook handles upload metadata/files and cached backtest datasets only. The report-file cleanup filters `.json` files; it does not delete rows from `backtests`. Since the complete report is stored in JSONB, automatic file retention does not bound database report storage; rows remain until manual report deletion or another unlocated process. | Define coordinated DB/file/artifact retention and test that retention preserves active/downloadable reports and removes all associated artifacts. Confirm no external DB maintenance job exists before final classification. |
| REP-10 | CONFIRMED — report header reads the wrong timeframe property | `_buildMeta()` writes `meta.timeframe`; `BacktestSubTab` renders `report.meta.interval`, so the report header falls back to `15m` instead of showing the actual timeframe. | Add metadata schema/UI contract test and use the canonical `timeframe` field. |
| REP-11 | CONFIRMED — “Profit Distribution Histogram” uses only the first 15 preview trades | `BacktestSubTab` builds its histogram from `report.trades.slice(0, 15)`. The manager truncates `report.trades` to 20, so this chart does not represent the full trade distribution. The report already contains a separate analytics histogram, but the UI does not consume it. | Define whether this chart means trade P&L or return distribution; calculate from the full authoritative series and test against >20 trades. |
| REP-12 | CONFIRMED — report-history list response does not match frontend fields | `GET /api/backtest` returns `timestamp` and no `status`; `BacktestSubTab` types/reads `createdAt` and `status`. The history UI therefore renders `N/A` for date and an empty/undefined status badge. | Define one list-response contract and add API-to-UI contract tests. |

| REP-13 | CONFIRMED — report-list discovery is database-only even though direct retrieval has a file fallback | `_saveToDatabase()` catches and suppresses PostgreSQL write errors after the JSON file is saved. `GET /api/backtest` requires DB configuration and lists only `backtests` rows; it does not scan the report directory. A report can therefore be reported as successfully completed and be retrievable by known ID from its file, yet be absent from the history list after a DB write failure. | Define the report commit/success contract and test DB-write failure followed by list and direct retrieval. |
| REP-14 | CONFIRMED — report deletion can report success after database deletion failed | `DELETE /api/backtest/:reportId` suppresses PostgreSQL delete errors, then removes JSON files and returns success. If the DB delete failed, the DB row can remain and the report can reappear from the DB on the next history refresh. | Make deletion outcome explicit and test DB failure, file failure and retry/idempotency across all associated artifacts. |

| REP-15 | PARTIAL — annualized risk metrics use trade-level returns with a fixed 252-period multiplier | `format.computeFull()` builds returns from the equity curve generated from closed trades, then calls Sharpe/Sortino/annualized volatility and rolling calculations with `periodsPerYear: 252`. The observations are trade exits, not guaranteed daily periods; this can misstate annualized metrics depending on trade frequency and selected timeframe. | Agree on a time-frequency contract (bar/day/trade) and compute/annualize consistently; compare known synthetic schedules. |
| REP-16 | PARTIAL — equity and drawdown metrics omit open-position and intratrade mark-to-market movement | `MetricsAccumulator.recordTrade()` adds equity points only when a trade closes. `BacktestDriver.onBar()` updates last price but does not update the accumulator; report series are rebuilt from closed trades. The reported curve/drawdown therefore reflects realized trade exits and omits floating P&L and adverse movement during open trades. | Decide whether reports require bar-level mark-to-market equity; if yes, add deterministic tests for a large intratrade drawdown followed by recovery/exit. |
| REP-17 | PARTIAL — displayed performance Sharpe uses a different return basis from net P&L | `MetricsAccumulator.recordTrade()` computes `profitPct` from gross price P&L before subtracting entry/exit commission, then derives its `sharpeRatio` from those returns. `_computeAnalytics()` supplies that broker Sharpe as the `performance.sharpeRatio` supplement, while the separate `risk.sharpe` is computed from the net-profit-derived equity returns. The main performance card and risk block can therefore disagree, especially once trading costs are correctly propagated. | Define whether Sharpe uses gross or net returns and one observation frequency; derive both report fields from the same canonical series. |

### Report/analytics semantics requiring further review

- `MetricsAccumulator` adds equity points only when a trade closes. Its equity curve and the analytics curves rebuilt from closed trades therefore represent realized trade-exit points, not per-bar mark-to-market equity. Open-position floating P&L and intratrade drawdown are not represented in those curves. Confirm the intended report definition before changing it.
- Analytics derives returns from consecutive trade-exit equity points, then calculates Sharpe/volatility using `periodsPerYear: 252`. This is a trade-frequency series, not a daily series by construction; annualization and risk metric interpretation need a documented frequency model and financial review.
- The report contains full equity/drawdown/underwater/returns/rolling arrays in both JSON file and JSONB. The UI currently consumes equityCurve for its two charts, and the first 20 trade records for histogram/table; full consumers of the other analytics arrays still need to be found.
- `includeTrades=false` can omit the trade preview while the manager still writes a full CSV if closed trades exist. The UI currently has no visible export action.
- The UI shows a “Commissions Paid” metric, but analytics receives no totalCommission supplement from the manager; that value defaults to zero. This is consistent with SIM-02's dropped commission configuration, but the report field wiring needs a separate contract test.

### Step 4 status

**PARTIAL — persistence, GET/list/delete paths and primary BacktestSubTab consumers mapped.** Need complete frontend consumer search, confirm whether any other artifact route exists, inspect report cleanup and CSV behavior under failure, and review analytics formulas/series frequency before finalizing the report contract.

## 7E. Step 5 — resource-baseline feasibility (2026-11-20; initial review)

**Status: NOT BENCHMARKED.** The source tree contains `scripts/bench/engine-micro-bench.js` and an `npm run bench:engine` script. That harness measures queue implementations, strategy tick bursts and warmup replay; it does not exercise CSV/gzip ingestion, DataForge preparation, the backtest bar loop, broker fills, analytics, report serialization, PostgreSQL persistence or concurrent backtest workers. Its RSS output is a single startup snapshot, not peak per-stage/per-job memory.

The existing `test/backtest-report-path.test.js` uses a deterministic 120-bar synthetic CSV to characterize report persistence. It is a correctness fixture, not a representative performance workload. No small/medium/large backtest dataset fixtures or backtest-specific benchmark harness were found in the inspected tree.

### Baseline collection requirements

Before proposing optimization thresholds, run a controlled benchmark on the intended Windows/Dell environment and record Node version, CPU/RAM, storage medium, PostgreSQL configuration, worker count, dataset bytes/bars, compression ratio, strategy behavior and run options. Measure these stages separately:

1. file stat/read/decompression and parser/normalizer;
2. sorting/range selection and data materialization;
3. simulation bars/second, strategy-call latency and broker fills;
4. analytics and report construction;
5. JSON file, CSV and JSONB persistence;
6. report retrieval and frontend payload size;
7. process RSS before/after and peak RSS, plus concurrent-job RSS;
8. worker startup/idle overhead and progress-event/database-write counts.

Use generated deterministic datasets for reproducibility, but also test representative real-format CSVs after sanitizing private data. At minimum include a tiny correctness fixture, a medium workload and the largest workload the current product intends to support. Keep uploaded CSV, gzip expansion and bar-count limits distinct. Do not infer performance targets from the existing 120-bar test or the unrelated engine microbenchmark.

No benchmark was run in this session: the GitHub-connected source view cannot execute the user's Windows checkout, and the local CoreX MCP was not available for command execution. This is an explicit measurement gap, not a zero-cost result.

## 8. Guardrails — no implementation during discovery

- No source-code edits, schema migrations, dependency additions, branch creation or implementation PRs.
- No splitting `backtestManager.js` before the full caller/ownership map is complete.
- No switching queue technology or adding Redis/NATS based on preference alone.
- No blanket conversion to streaming if the strategy/broker contract requires random access; measure and choose the appropriate data shape.
- No change to financial calculations, fill semantics, risk behavior or report meaning without explicit review and regression evidence.
- No deleting features, caches, routes, tables or artifacts until consumers and stored-data implications are traced.
- No new microservices or package forest. Prefer a small number of cohesive responsibilities.
- Keep the current PostgreSQL job queue as the baseline unless measurements identify a specific limitation.
- Keep STAGE-4 and P7 dependency gates intact. Discovery may inform those phases but does not waive their prerequisites.
- Follow roadmap's two-workstream limit. B10 is a backlog discovery item, not an active phase/workstream.

## 9. Exit criteria

Discovery is complete only when:
- [ ] Upload journey and dataset lifecycle are traced end-to-end.
- [ ] Job lifecycle, worker ownership, state transitions, retries and cancellation are verified.
- [ ] Simulation/broker path and financial settings are mapped.
- [ ] Report, analytics, artifacts, frontend consumers and cleanup are mapped.
- [ ] All major leads in §7 are classified with evidence.
- [ ] Duplicate, dead, write-only and low-value features have caller/consumer evidence.
- [ ] Resource baseline is reproducible or unavailable measurements are explicitly explained.
- [ ] Proposed data/job/report contracts have explicit owners.
- [ ] Proposed optimization choices include trade-offs and preserve correctness.
- [ ] P7/STAGE-4 dependencies and implementation sequence are reconciled with the roadmap.
- [ ] Owen reviews and approves the implementation handoff before any source changes begin.

## 10. Session handoff checklist

At the start of every continuation:
1. Read this file and `plans/ROADMAP.md`.
2. Verify current `main` SHA and compare it with the baseline above.
3. Check whether STAGE-1, P1, STAGE-4 or P7 status/dependencies changed.
4. Read the exact source files for the next unfinished step; do not trust stale line numbers.
5. Update the progress log below before ending the session.
6. Do not repeat completed discovery unless new code invalidates the evidence.

### Progress log

| Date | Baseline SHA | Step | Work completed | Evidence / output | Next action |
|---|---|---|---|---|---|
| 2026-11-20 | `ea7e98b3a4faa33b1ce7f70210353aa027cffbeb` | Step 7F — source-scan closure | Completed source-level trace of upload/dataset, job/worker, simulation/broker, analytics/report, artifact and cleanup paths. Consolidated UP-01–UP-06, JOB-01–JOB-07, SIM-01–SIM-09 and REP-01–REP-17; classified partial leads and documented validation order/gaps. | GitHub source scan; compare against `main` confirmed only this handoff document changed during discovery. No application source/test changes. | Owen review; next work is targeted runtime/financial regression tests and controlled backtest benchmarks, subject to roadmap gates. |
| 2026-11-20 | `3c4f11c1de997561a22fa8763f86b3a23fec4ea4` | Initial pass | Traced main upload/controller, queue/worker, manager, broker, analytics and report flow at a high level. Identified leads in §7. | ChatGPT initial read-only pass; findings require reproduction and exact source references. | Begin Step 0 and Step 1 from current main; verify all paths and contracts. |
| 2026-11-20 | `ea7e98b3a4faa33b1ce7f70210353aa027cffbeb` | Steps 0–1 | Verified current main baseline, bootstrap/worker startup, upload UI/API, Multer/storage/hash/scan, PostgreSQL metadata schema, dataset selection, delete routes and archive/purge path. Recorded UP-01–UP-06 in §7A. | GitHub source at current main; exact paths/functions/line references recorded above. No source changes. | Continue Step 1 edge cases and then Step 2 job lifecycle; reproduce UP-01 in a clean worktree before proposing any fix. |
| 2026-11-20 | `94c3fb3917fd12b5c396b01d166100dfb56ac71d` | Step 3 | Traced manager config/data preparation, simulation loop, BacktestDriver fill path, metrics accumulator, analytics report assembly and persistence. Recorded SIM-01–SIM-09 in §7C. | Source trace; no runtime reproduction or benchmarks; no application source/test changes. | Source scan closed in §7F; empirical validation remains. |
| 2026-11-20 | `077e349bf2172e088fa0bf4efd7c2f64ada2557b` | Step 5 | Inspected existing `bench:engine` harness and available backtest fixtures. Confirmed current benchmark does not exercise the backtest pipeline and does not measure peak RSS. Recorded the measurement gap and required benchmark stages in §7E. | Source-only review; no benchmark or local tests executed. | Source scan closed in §7F; run controlled backtest benchmarks when local execution is available. |
| 2026-11-20 | `756aac6fe1f429b28636ba7fa325b44685817dcb` | Step 4 | Traced report JSON/JSONB persistence, list/get/delete endpoints, BacktestSubTab consumers, analytics field units, chart transformations and report cleanup. Recorded REP-01–REP-17 in §7D. | Source trace; no runtime/API download tests or report-size measurements; no application source/test changes. | Source scan closed in §7F; runtime/API validation and financial methodology approval remain. |

## 7G. Decision update — D7 reversed; new package workstream scheduled (2026-11-23)

**Owen's decision:** Reverse the previous D7 deferral. Build `packages/corex-backtest` now rather than waiting for STAGE-4/P7. This is a scheduling decision for a separate domain package; it does not authorize immediate implementation. BT-0 must first be completed and reviewed, followed by Owen's explicit implementation approval.

### Remaining baseline scope

- **BT-0a — ownership map:** reported complete by Owen; report review/reconciliation pending.
- **BT-0b — failed-jobs triage (read-only DB):** reported complete by Owen; report review/reconciliation pending.
- **BT-0c — golden-run harness:** remaining lane. Establish deterministic reference runs using pinned strategy-engine code, explicit strategy/config/data inputs, and recorded outputs/environment/limitations. This is baseline/test work, not package implementation.
- **BT-0 review:** reconcile all three lanes; distinguish confirmed defects from hypotheses/stale findings; freeze the reference baseline and present the implementation scope for Owen's approval.

### Proposed package sequence (contracts remain subject to BT-0 review)

1. **BT-1 — contracts and package skeleton:** define public API, injected ports, dependency direction and package-level tests.
2. **BT-2 — domain implementation:** BarSource, SimulationRunner and analytics; deterministic parity tests against BT-0 golden runs.
3. **BT-3 — engine adapters and cutover:** keep application infrastructure in the engine; integrate only after dataset/job contracts and STAGE-4 implications are reconciled, with parity and rollback evidence.
4. **BT-4 — confirmed correctness/reliability fixes:** fix only findings reproduced against the agreed baseline; preserve financial semantics unless Owen separately approves a change.
5. **BT-5 — frontend contract integration:** update UI only after the engine API/report/progress contracts are frozen.

### Ownership boundary

The new package owns backtest-domain contracts and simulation/analytics logic. It must not own Express routes/controllers, authentication, PostgreSQL repositories, upload endpoints, dataset registration/storage lifecycle, durable job queue or worker-process supervision, filesystem/report artifact lifecycle, or API orchestration. Those remain engine/application responsibilities and are supplied to the package through explicit ports/adapters.

STAGE-4 is no longer a blocker to package-domain development. It remains relevant to engine-side dataset-resource integration/cutover. P7 must be re-scoped before it starts: the former `backtestManager` split is now handled by BT-1/BT-2; P7's remaining `StrategyLoader` facade work and existing dependencies are not automatically cancelled.

**Implementation gate:** No BT-1/BT-2 implementation until BT-0 evidence has been reviewed, the package contract/scope has been presented, and Owen explicitly approves implementation. Failed or unverified findings are recorded as known issues with evidence rather than expanded into speculative fixes.
