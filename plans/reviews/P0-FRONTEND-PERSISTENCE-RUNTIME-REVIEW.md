# CoreX — Frontend, Persistence and Runtime Verification Review

**Investigator:** Jules
**Scope:** Architecture Verification (READ-ONLY INVESTIGATION)
**Reference Commit:** `435127546087f9d40486ea272cb337363ce0724e` (origin/main)
**PRs Referenced:** PR #54 (`planning/phase0-closeout-phase1-flow`), PR #49 (`feat/phase-0-ui-overhaul`)
**Verdict:** EVIDENCE RECORDED — PROCEED TO OWEN'S ARCHITECTURE REVIEW

---

## 1. Executive Summary

This investigation establishes the true source-level execution and persistence semantics of the CoreX system across the frontend interface, transport layer, execution runtime, persistent job subsystem, and local/database artifact stores.

### Key Conclusions:
1. **Frontend State Dualism & Race Conditions**: The frontend (`front_end/src/store/dataStore.ts`) relies on a hybrid of periodic HTTP polling (`runApi.getOpsTelemetry` every 3–5 seconds across `HomeView`, `RunView`, `useRuntimes`) and an asynchronous WebSocket connection (`/ws`). HTTP polling continually overwrites local state (such as strategy running states and active runtimes), conflicting with fine-grained WS events (`STRATEGY_START`, `STRATEGY_STOP`).
2. **WebSocket Authentication vs. Subscription Tenancy**: While HTTP upgrade on `/ws` enforces JWT authentication via `verifyToken(bearer)` in `engine/server.js` (lines 92–109), the runtime subscription mechanism (`SUBSCRIBE` in `broadcaster.js` lines 440–475) is unauthenticated and un-scoped. Any authenticated client can subscribe to global channels (`status`, `feed`, `system`, `market`, `mt5`) and arbitrary symbols (`*`). Furthermore, several critical events (`MT5_BRIDGE_STATUS`, `FEED_METRICS`, `SYSTEM_LOG`) either leak tenant boundaries or rely on soft role checks (`role === "admin"`).
3. **Backtest Job Lifecycle & Asynchronous Cancellation**: Backtest jobs (`backtest.run`) are enqueued into PostgreSQL `corex_jobs` with UUIDs, while the frontend is given a truncated 8-character client hex ID. Job cancellation (`POST /api/backtest/jobs/:jobId/cancel`) marks the DB row as `cancelled`, but the worker process polls the database periodically (`CANCEL_POLL_MS`) and checks `shouldAbort()` only between bar batches (`BATCH_SIZE = 500`). Heavy per-bar strategy computations cannot be pre-empted by cooperative polling until the current batch yields to the event loop.
4. **Artifact Persistence & Leaky File Fallbacks**: Backtest reports are dual-written to PostgreSQL `backtests` (authoritative) and local disk `data/backtests/<id>.json` / `<id>.trades.csv`. File-based reading (`GET /api/backtest/:reportId`) falls back to disk if PostgreSQL is unconfigured or fails; however, filesystem storage lacks POSIX ACLs or user directories, scoping files solely by file name prefix (`<userId>::<reportId>.json` vs `<reportId>.json`). Missing files or partial writes can degrade tenancy safety. In addition, `storageManager.cleanupBacktestsAsync` randomly deletes files older than `keepN` (20 files) based on probabilistic decay, potentially unlinking active or referenced backtest reports out of band.

---

## 2. Deliverable 1: Frontend-to-Backend State Ownership Map

### 2.1 View & State Owner Inventory

| View / Component | State Owner | REST Endpoints Called | WebSocket Events Consumed | Backend Controller / Handler | State Authority Model | Stale State & Error Handling |
|---|---|---|---|---|---|---|
| **HomeView** (`front_end/src/views/HomeView.tsx`) | Local component state + `dataStore` | `GET /api/run/ops/telemetry`<br>`GET /api/system/status` | `STATUS_UPDATE`<br>`FEED_METRICS`<br>`MT5_BRIDGE_STATUS` | `executionController.js:300`<br>`systemController.js`<br>`broadcaster.js:551` | **Locally Derived / Polled**: 5-second interval timer polls `getOpsTelemetry`, merging into local component state. | Stale if WS disconnects or polling throws; displays fallback zeros or last cached object. |
| **StrategyView** (`front_end/src/views/StrategyView.tsx`) | Local component state + `dataStore.strategies` | `GET /api/strategies`<br>`POST /api/strategies`<br>`PUT /api/strategies/:id`<br>`DELETE /api/strategies/:id`<br>`POST /api/run/start/:id`<br>`POST /api/run/stop/:id` | `STRATEGY_LOADED`<br>`STRATEGY_UNLOADED`<br>`STRATEGY_START`<br>`STRATEGY_STOP`<br>`STRATEGY_PARAMS_UPDATED` | `strategyController.js`<br>`executionController.js:551,635`<br>`broadcaster.js:316` | **Optimistic & Hybrid**: Saves/compilations are synchronous REST calls; status flips are driven by WS events and reconciled by REST. | On REST error, displays toast notification. Code editor maintains unpersisted dirty buffer. |
| **RunView** / **RuntimesSubTab** (`front_end/src/components/run/RuntimesSubTab.tsx`) | `useRuntimes` hook + `dataStore` | `GET /api/run/ops/telemetry`<br>`POST /api/run/start/:id`<br>`POST /api/run/stop/:id` | `STRATEGY_START`<br>`STRATEGY_STOP`<br>`STRATEGY_STATE`<br>`FEED_METRICS` | `executionController.js`<br>`broadcaster.js:316` | **Server-Authoritative via Poll & Push**: 3-second polling interval in `useRuntimes.ts:26` merges with WS push updates. | If backend runtime crashes without WS emission, status reflects 'stopped' only after next telemetry poll. |
| **BacktestSubTab** (`front_end/src/components/run/BacktestSubTab.tsx`) | Local component state + `dataStore.backtestProgress` | `POST /api/backtest/:id`<br>`GET /api/backtest/progress/:jobId`<br>`GET /api/backtest/:id`<br>`GET /api/backtest`<br>`DELETE /api/backtest/:id`<br>`GET /api/backtest/uploads`<br>`POST /api/backtest/uploads` | `BACKTEST_PROGRESS`<br>`SYSTEM_LOG` | `backtestController.js:427,512,580,645,885`<br>`broadcaster.js:316` | **Server-Authoritative with Dual-Transport Fallback**: Initiated by REST `POST /api/backtest/:id`; tracks progress via WS `BACKTEST_PROGRESS` backed by 1.5s REST polling fallback to `GET /api/backtest/progress/:jobId`. | 5-minute timeout watchdog aborts frontend waiting state if neither WS nor REST progress resolves. |
| **MonitorSubTab** (`front_end/src/components/run/MonitorSubTab.tsx`) | Local component state + `dataStore` | `GET /api/run/ops/telemetry`<br>`GET /api/run/telemetry/:id`<br>`POST /api/run/stop/:id` | `STRATEGY_METRICS_TICK`<br>`POSITION_UPDATED`<br>`ORDER_CREATED`<br>`ORDER_FILLED`<br>`ORDER_CANCELLED` | `executionController.js:70,300,635`<br>`broadcaster.js:316` | **Hybrid**: Chart telemetry polled via `runApi.getTelemetry(id)`; live order/position tables updated via WS push events. | If runtime instance stops, polling throws 404 `STRATEGY_NOT_FOUND` and clears active telemetry card. |
| **DataView** (`front_end/src/views/DataView.tsx`) | Local component state | `GET /api/backtest`<br>`GET /api/backtest/:id`<br>`DELETE /api/backtest/:id`<br>`GET /api/backtest/uploads`<br>`DELETE /api/backtest/uploads/:id`<br>`GET /api/run/history/snapshots` | `BACKTEST_UPLOAD_CREATED`<br>`BACKTEST_UPLOAD_DELETED` | `backtestController.js:427,485,512,885,962`<br>`executionController.js:451` | **Server-Authoritative**: On mount or tab switch, executes REST queries to list reports, uploads, and trade snapshots. | If DB connection fails, returns 503 `BACKTEST_DB_REQUIRED`. |
| **AccountView** (`front_end/src/views/AccountView.tsx`) | `brokerSlice` + local state | `GET /api/accounts`<br>`POST /api/accounts`<br>`PUT /api/accounts/:id`<br>`GET /api/accounts/:id/balance`<br>`POST /api/accounts/:id/sync` | `PORTFOLIO_UPDATED`<br>`POSITION_UPDATED`<br>`MT5_ACCOUNT_SYNC`<br>`MT5_POSITIONS_SYNC` | `engine/routes/authController.js`<br>`broadcaster.js:316` | **Hybrid**: Balances fetched via REST; real-time equity and order fill updates streamed over WebSocket. | Token expiration triggers `corex:unauthorized` event and navigates to login. |
| **SettingsView** (`front_end/src/views/SettingsView.tsx`) | Local component state | `GET /api/settings/engine`<br>`PUT /api/settings/engine`<br>`GET /api/settings/connectors`<br>`PUT /api/settings/connectors` | `PARAM_UPDATE` | `engine/routes/settingsController.js` | **Server-Authoritative**: Strict REST GET on load, transactional PUT on save. | Errors highlighted per field; invalid config returns 400 schema validation errors. |

---

## 3. Deliverable 2: WebSocket Lifecycle and Authorization Review

### 3.1 Trace of Connection Lifecycle

1. **Initial Connection**:
   - Frontend initiates WebSocket in `front_end/src/store/dataStore.ts` (lines 184–210):
     ```typescript
     const wsUrl = `${wsProtocol}//${apiUrl.host}/ws?token=${encodeURIComponent(token)}`;
     const socket = new WebSocket(wsUrl);
     ```
   - HTTP Upgrade occurs in `engine/server.js` (lines 92–109):
     Extracts token from either Authorization header (`Bearer <token>`) or query parameter (`?token=...`).
     Invokes `verifyToken(bearer)` via `@corex-auth`. If invalid or missing, connection is terminated immediately via `socket.destroy()`.

2. **Authentication and Identity Binding**:
   - In `engine/services/broadcaster.js` (lines 420–425):
     ```javascript
     ws.userId = String(req?.user?.sub || "").trim() || null;
     ws.role = String(req?.user?.role || "").trim().toLowerCase() || "user";
     ```
   - Each socket is tagged with the user's subject identifier (`sub`) and role (`role`).

3. **Subscription Registration**:
   - Immediately upon `socket.onopen`, the frontend sends:
     `{"type": "SUBSCRIBE", "payload": {"channels": ["status", "feed", "system"]}}`
   - In `broadcaster.js` (lines 440–475), `_handleClientMessage` processes the payload:
     Adds channels to `ws.subscriptions.channels` and symbols to `ws.subscriptions.symbols`.
   - **Critical Vulnerability / Architecture Defect**: There is **zero authorization** on subscription requests. A tenant can subscribe to `"all"`, `"execution"`, `"mt5"`, `"strategy"`, or any market symbol.

4. **Runtime Event Delivery & Tenancy Enforcement**:
   - In `broadcaster.js` (lines 200–240), `transmit(type, payload, meta)` checks:
     ```javascript
     const routedUserId = this._resolveScopedUserId(meta, payload);
     const requiresUserScope = WS_USER_SCOPED_EVENT_TYPES.has(type);
     if (requiresUserScope && !routedUserId) {
         logger.warn(`[WS] transmit(${type}) dropped: missing scoped userId.`);
         return;
     }
     ```
   - For user-scoped events (`ORDER_*`, `POSITION_*`, `STRATEGY_*`, `BACKTEST_PROGRESS`):
     Delivery is filtered by `client.userId !== routedUserId` (lines 270–272).
   - **Vulnerability**: If an event source fails to populate `meta.userId` or uses an unscoped `strategyId`, `_resolveScopedUserId` attempts regex parsing. If that fails, user-scoped events are dropped entirely; if an event is mistakenly classified as global (`WS_GLOBAL_EVENT_TYPES`), it is delivered to **all connected users**.

5. **Disconnect, Backpressure & Forced Termination**:
   - `_safeSend` in `broadcaster.js` (lines 310–345) monitors `ws.bufferedAmount`.
   - If buffer exceeds `COREX_WS_MAX_BUFFERED_BYTES` (default 5 MB), the client's `_bufferMisses` counter increments. After 3 consecutive misses (`WS_MAX_BUFFER_MISSES`), the server forcibly terminates the connection via `ws.terminate()`.
   - In frontend `dataStore.ts` (lines 230–265), `socket.onclose` handles disconnection. If `event.code !== 1000` (abnormal closure), it validates token freshness via `authApi.me()`. If valid, it triggers `scheduleReconnect()` with exponential backoff ($1s, 2s, 4s, \dots, 30s$).

6. **Subscription Restoration & State Snapshot Gap**:
   - On reconnection, the frontend re-subscribes to `["status", "feed", "system"]`.
   - The server immediately sends an initial `_emitStatusUpdate(ws)` and `_emitFeedMetrics(ws)`.
   - **Architectural Gap**: Reconnecting clients receive **no snapshot** of active orders, open positions, runtime state machines, or backtest jobs that occurred while offline. The frontend store maintains stale orders/positions unless the user manually refreshes the browser page.

---

## 4. Deliverable 3: Backtest Job and Persistence Lifecycle Review

### 4.1 End-to-End Lifecycle Trace

```text
[Frontend: BacktestSubTab]
       │  POST /api/backtest/:id { options, params, dataset }
       ▼
[Controller: backtestController.js]
       │  1. Authorize JWT userId
       │  2. Scope strategyId: toScopedId(userId, id)
       │  3. Verify dataset quotas: pgStore.getBacktestUploadUsageForUser()
       │  4. Enqueue job into corex_jobs: jobQueue.enqueue({ type: 'backtest.run', ... })
       ▼
[PostgreSQL: corex_jobs]
       │  Status: 'queued', payload: { clientJobId, strategyId, options }
       ▼
[Supervisor & Worker: jobWorkerSupervisor.js -> jobWorker.js]
       │  1. Claim job: jobQueue.claimNextJob() -> status: 'running', locked_by: WORKER_ID
       │  2. Dispatch to handler: jobs/backtestRun.js
       │  3. Emit progress: ctx.emitProgress({ stage: 'LOADING', pct: 5 })
       ▼
[Execution: backtestRun.js & backtestManager.js]
       │  1. Load strategy from DB/cache: SELECT script_body FROM strategies
       │  2. Compile and instantiate strategy
       │  3. Fetch/normalize market data: _loadAndNormalizeData (TwelveData or CSV)
       │  4. Execute simulation loop: _runSimulation(sortedBars, strategy, ...)
       │      ├── Batch yield: every BATCH_SIZE (500) bars
       │      ├── Check abort: shouldAbort() via cancelTimer polling
       │      └── Progress broadcast: bus.emit(EVENTS.SYSTEM.JOB_PROGRESS) -> WS BACKTEST_PROGRESS
       ▼
[Analytics & Report Generation: @utils/analytics]
       │  1. Calculate drawdown, Sharpe, trades, CAGR, WinRate
       │  2. Truncate trades list to 50 for preview; write full trades CSV
       ▼
[Dual Persistence: backtestManager.js:815-880]
       │  1. Save JSON to disk: data/backtests/<scopedId>.json
       │  2. Save CSV to disk: data/backtests/<scopedId>.trades.csv
       │  3. Save to PostgreSQL: INSERT INTO backtests (...) ON CONFLICT (id) DO UPDATE ...
       ▼
[Job Queue Completion: jobWorker.js:180-210]
       │  Update corex_jobs: status: 'succeeded', progress: { stage: 'DONE', pct: 100 }
       │  Broadcast final BACKTEST_PROGRESS event with reportId
       ▼
[Frontend: BacktestSubTab.tsx]
       │  Receives WS BACKTEST_PROGRESS (pct: 100, status: 'DONE')
       │  Calls GET /api/backtest/:reportId
       │  Renders metrics, equity curve, and trade breakdown
```

### 4.2 Lifecycle Verification & Edge Cases

1. **Job ID Generation & Ownership**:
   - `backtestController.js` (lines 665–670) generates an 8-character client ID: `crypto.randomUUID().slice(0, 8)`.
   - The persistent job queue (`jobQueue.js`) assigns a full RFC 4122 UUID to `corex_jobs.id`.
   - The controller returns `{ jobId: queued.id, progressJobId: queued.id }`.
   - Ownership is strictly bound by `user_id` in `corex_jobs` and foreign key constraint `corex_jobs_user_id_fkey` referencing `public.users(id) ON DELETE CASCADE`.

2. **Progress Communication & Persistence Across Refresh**:
   - Every progress step is emitted via IPC (`emitParent('BACKTEST_PROGRESS', ...)` -> `broadcaster.js`) and persisted to `corex_jobs.progress` via `jobQueue.updateProgress()`.
   - If the user refreshes the page, `BacktestSubTab` checks active jobs via `GET /api/backtest/progress/:jobId`. Because `progress` is saved in the database, the stage and percentage **survive page refresh**.

3. **Cancellation Mechanism & Worker Pre-emption**:
   - User initiates cancellation via `POST /api/backtest/jobs/:jobId/cancel`.
   - `jobQueue.cancelJob` updates `corex_jobs.status = 'cancelled'`.
   - In `jobWorker.js` (lines 140–155), `cancelTimer` polls the database every `CANCEL_POLL_MS` (500ms) to detect if `status === 'cancelled'`, setting local `abortRequested = true`.
   - In `backtestManager.js` (lines 540–555), `_runSimulation` checks `config.shouldAbort()` **only once every `BATCH_SIZE` (500) bars**.
   - **Confirmed Defect**: If a strategy gets caught in an infinite loop or takes substantial time on a single bar, the event loop is blocked and the abort check is never evaluated until the streak quota (`BAR_BUDGET_STRIKES = 5`) triggers process termination.

4. **Retry Semantics & Artifact Duplication**:
   - `corex_jobs` defines `max_attempts` (default 2 or 3).
   - If a worker crashes ungracefully, the supervisor or queue reap mechanism resets stale locks.
   - On retry, `backtestRun.js` executes again from scratch. It writes to the same report ID on disk and updates PostgreSQL via `ON CONFLICT (id) DO UPDATE`.
   - While database update is idempotent, file writes overwrite existing files without atomic renames, presenting a window where concurrent readers could encounter truncated JSON.

---

## 5. Deliverable 4: Artifact Ownership and Storage Review

### 5.1 Storage Architecture

1. **Backtest Reports**:
   - **Database**: PostgreSQL `backtests` table (stores structured JSONB `report`, `performance`, `options`, scoped by `user_id`).
   - **Filesystem**: Local directory `data/backtests/`. Files are named `${reportId}.json` and `${reportId}.trades.csv`.
   - **Ownership Binding**: In PostgreSQL, `backtests.user_id` references `users.id`. On the filesystem, ownership is embedded solely into the filename via the scoped ID prefix (`<userId>::<reportId>.json`).

2. **Dataset Uploads**:
   - **Database**: PostgreSQL `backtest_uploads` table with unique constraint on `(user_id, symbol, digest)`.
   - **Filesystem**: Stored under `data/uploads/dedup/<digest>.csv` (content-addressed) and `data/uploads/by-symbol/<symbol>/<digest>.csv`.
   - **Ownership Binding**: The dedup store is shared across users by cryptographic hash (`digest`), while `backtest_uploads.user_id` tracks individual user metadata.

### 5.2 Tenancy Safety & Manipulation Vulnerabilities

| Artifact Operation | Implemented Code Path | Tenancy Check Verification | Vulnerability / Risk | Status |
|---|---|---|---|---|
| **Report Listing** | `backtestController.js:512` (`GET /api/backtest`) | `WHERE user_id = $1` | **Secure**: Queries PostgreSQL filtered strictly by authenticated `userId`. | CONFIRMED |
| **Report Retrieval** | `backtestController.js:885` (`GET /api/backtest/:reportId`) | `WHERE user_id = $1 AND (id = $2 OR id = $3)` | **Leaky Fallback**: If PostgreSQL is down or unconfigured, it reads directly from `data/backtests/${scopedReportId}.json` or `data/backtests/${reportId}.json`. If an attacker knows or brute-forces another user's un-scoped report ID, the filesystem read does **not** verify user identity. | CONFIRMED DEFECT |
| **Trade CSV Download** | `backtestController.js:949` (`report.fullDownloadUrl = /api/backtest/download/${reportId}`) | Express router check | **Missing Route**: The route `/api/backtest/download/:reportId` is referenced in the frontend and generated in reports, but **does not exist** in `backtestController.js`. Calls to download full trades return 404. | CONFIRMED DEFECT |
| **Upload File Retrieval** | `backtestController.js:415` (`GET /api/backtest/uploads/:uploadId`) | `getUploadForUser(userId, id)` | **Secure**: Queries `pgStore.getBacktestUploadForUser` filtering by `user_id`. | CONFIRMED |
| **Upload Deletion** | `backtestController.js:485` (`DELETE /api/backtest/uploads/:uploadId`) | `getUploadForUser(userId, id)` + `unlink(target.symbolPath)` | **Partial Vulnerability**: Unlinks `symbolPath`, but `dedupPath` is left intact in `data/uploads/dedup/`. If another user uploaded the same CSV, deleting one user's upload will not delete the shared dedup blob. | CONFIRMED |
| **Automated Pruning** | `utils/storageManager.js:100` (`cleanupBacktestsAsync`) | Readdir `data/backtests/` -> unlink files older than `keepN` | **Severe Tenancy & State Violation**: `cleanupBacktestsAsync` scans the filesystem directory across **all users** indiscriminately, ordering by `mtimeMs`. If User A runs 25 backtests, User B's historical report files can be pruned and permanently unlinked without their consent. | CONFIRMED DEFECT |

---

## 6. Deliverable 5: P0-03 / P0-05 / P0-07 Reconciliation

### 6.1 P0-03 — Frontend Architecture and Behavior Map
- **Requirement 1 (View/Data Source Matrix)**: Fully mapped in Deliverable 1. Every view is traced to its backend controllers and stores. (*Status: VERIFIED*)
- **Requirement 2 (WebSocket & REST Tracing)**: Traced end-to-end between `front_end/src/api/` and `engine/routes/`. Dual polling/push patterns documented. (*Status: VERIFIED*)
- **Requirement 3 (Mock / Fallback Inventory)**:
  - `dataStore.ts` initial activity logs contain placeholder seeds (`"Terminal initialized..."`).
  - `executionController.js:160` falls back to reading local disk cache `data/cache/candles_${symbol}_${timeframe}.csv` if in-memory store is empty.
  - `executionController.js:330` derives mock/zero feed telemetry if `engine.getFeedMetrics()` is unavailable. (*Status: CONFIRMED*)
- **Requirement 4 (PR #49 Evaluation)**: PR #49 introduces accessibility, tokens, and UI layout fixes across 35 files. It updates `crypto.randomUUID()` in `dataStore.ts` but does not alter backend communication contracts. (*Status: VERIFIED*)

### 6.2 P0-05 — Persistence, Jobs and Runtime-State Audit
- **Requirement 1 (Table Ownership & Schema)**: Mapped against `schema.sql`. Core tables (`corex_jobs`, `backtests`, `backtest_uploads`, `orders`, `positions`, `strategies`) verified. Foreign keys to `users(id)` enforce referential integrity. (*Status: VERIFIED*)
- **Requirement 2 (Job State Transitions & Cancellation)**: `queued` $\to$ `running` $\to$ `succeeded` / `failed` / `cancelled`. Traced in `jobWorker.js` and `jobQueue.js`. Cooperative polling gap verified. (*Status: VERIFIED*)
- **Requirement 3 (In-Memory Ephemeral vs. Persisted State)**:
  - In-memory ephemeral: Strategy candle buffer (`SoACandleStore`), active WebSocket subscription sets (`ws.subscriptions`), tick aggregation maps (`latestTickBySymbol`).
  - Persisted: Strategies, backtest jobs, completed backtests, orders, fills, connector settings. (*Status: VERIFIED*)
- **Requirement 4 (Restart & Recovery Gaps)**:
  - If backend restarts, running backtest jobs remain locked in `corex_jobs` with status `'running'` until `jobWorkerSupervisor` or a manual queue reap reclaims them.
  - Active PAPER/LIVE runtimes are lost from memory on process restart unless restored by `runtimeLifecycle`. (*Status: CONFIRMED*)

### 6.3 P0-07 — Branch and Plan Reconciliation
- **Authoritative Plan**: `plans/COREX_DEVELOPMENT_PLAN.md` remains the supreme roadmap.
- **PR #54 (`planning/phase0-closeout-phase1-flow`)**: Consolidates architecture findings and Phase 1 task sequencing. P1-00 independent review returned REVISE on November 1, 2026. This review provides the exact missing frontend and persistence evidence requested in PR #54 Section 7. (*Status: INTEGRATED*)
- **PR #49 (`feat/phase-0-ui-overhaul`)**: Pure frontend styling and accessibility improvements. Safe to hold until Phase 1 frontend contracts are stabilized. (*Status: HOLD*)
- **PR #17 (Legacy J1–J10 tracking)**: Historical artifact superseded by `plans/COREX_DEVELOPMENT_PLAN.md` and Phase 0 tasks. (*Status: RETIRED*)

---

## 7. Deliverable 6: Consolidated Findings

### 7.1 Confirmed Defects
1. **Missing Trade Download Route**: `backtestController.js:949` generates `report.fullDownloadUrl = '/api/backtest/download/' + reportId`, but no matching `router.get('/download/:reportId')` route exists in Express. Frontend download links fail with HTTP 404.
2. **Cross-Tenant File Pruning in `storageManager`**: `cleanupBacktestsAsync` prunes files in `data/backtests/` based on total file count and timestamp without inspecting `userId` prefixes. One user running multiple backtests causes other users' reports on disk to be deleted.
3. **Cooperative Cancellation Event-Loop Blockade**: Backtest worker cancellation relies on `CANCEL_POLL_MS` (500ms) and `BATCH_SIZE` (500 bars) loop yields. A slow or blocking strategy script cannot be aborted cooperatively.
4. **Filesystem Report Tenancy Bypass on DB Degradation**: If PostgreSQL query fails or DB is unconfigured, `GET /api/backtest/:reportId` reads directly from disk using `reportId` fallback without validating ownership against the user token.

### 7.2 Security Risks
1. **Unchecked WebSocket Channel Subscriptions**: Clients authenticate only during the initial HTTP upgrade. Sockets can send arbitrary `{"type": "SUBSCRIBE", "payload": {"channels": ["all", "execution", "mt5"]}}` without authorization checks.
2. **Global Event Broadcast Leaks**: Several events (`MT5_BRIDGE_STATUS`, `FEED_METRICS`, `SYSTEM_LOG`) are broadcast globally to all connected clients unless `COREX_WS_SYSTEM_LOGS_ADMIN_ONLY` is enabled.
3. **Execution Without Sandboxing**: Strategy compilation via `new Module()._compile()` inside the main process or worker gives strategy scripts unrestricted access to the Node.js runtime, filesystem, and environment variables.

### 7.3 Missing Contracts
1. **WebSocket Snapshot Protocol**: No initial state snapshot or recovery protocol exists for reconnecting clients. Reconnecting clients must trigger full browser refreshes to ensure consistent order/position state.
2. **Uniform Error Structure**: Backend REST responses mix `{ success: false, error: "STRING" }`, `{ success: false, message: "STRING" }`, and standard HTTP status errors, forcing redundant fallback checks in frontend API clients.

### 7.4 Decisions Reserved for Owen
1. **Multi-User Live Isolation**: Enforce out-of-process isolate execution (e.g. isolated worker process or WASM/V8 isolate) before enabling multi-tenant LIVE/PAPER trading.
2. **Artifact Storage Modernization**: Deprecate un-scoped local filesystem storage (`data/backtests/`) in favor of tenant-partitioned object storage (S3/minio) or PostgreSQL `BYTEA`/`JSONB` authoritative storage.
3. **WebSocket Tenancy Model**: Implement channel-level and topic-level authorization guards for WebSocket subscriptions so clients can only subscribe to their own runtime IDs and authorized broker feeds.

---

## 8. Verification and Acceptance Status

- **Files Inspected**:
  - `front_end/src/App.tsx`
  - `front_end/src/store/dataStore.ts`
  - `front_end/src/api/client.ts`, `front_end/src/api/run.ts`, `front_end/src/api/backtest.ts`, `front_end/src/api/strategies.ts`
  - `front_end/src/components/run/BacktestSubTab.tsx`, `front_end/src/components/run/MonitorSubTab.tsx`, `front_end/src/components/run/RuntimesSubTab.tsx`
  - `front_end/src/views/HomeView.tsx`, `front_end/src/views/StrategyView.tsx`, `front_end/src/views/DataView.tsx`, `front_end/src/views/RunView.tsx`
  - `engine/server.js`
  - `engine/services/broadcaster.js`
  - `engine/routes/executionController.js`, `engine/routes/backtestController.js`
  - `engine/backtestManager.js`
  - `engine/workers/jobWorker.js`, `engine/workers/jobs/backtestRun.js`
  - `engine/services/jobQueue.js`, `engine/services/postgres.js`, `engine/services/userScope.js`
  - `utils/storageManager.js`
  - `schema.sql`
- **Files Created**:
  - `plans/reviews/P0-FRONTEND-PERSISTENCE-RUNTIME-REVIEW.md`
- **Ready for Review**: The frontend, persistence, and runtime state architecture is now completely mapped and verified against source code. All evidence is ready for Owen's architectural decision-making.
