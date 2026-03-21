# Backend Improvement Form (Production-Grade Trading Engine)

This document is a backend-focused audit + refactor guide for the CoreX Node.js engine. It targets:
- Reducing overcrowded "god files" and tight coupling.
- Removing production risks (blocking I/O, unsafe runtime code execution, leaky timers/listeners).
- Standardizing module boundaries so the engine can evolve into a professional trading runtime.

## Current Backend Map (What Runs What)

- Entry point: `index.js`
  - Runs DB migration, loads config, applies persisted engine settings, starts engine and HTTP server.
- HTTP API + WebSockets: `engine/server.js`
  - Express routes: `engine/routes/*Controller.js`
  - WS upgrades: `/ws` (UI broadcaster), `/mt5` (MT5 bridge receiver)
- Core tick + strategy runtime: `engine/core/engine.js`
  - Tick queues (per-symbol), strategy queues (per-strategy), backpressure stats.
- Strategy lifecycle: `engine/strategyLoader.js` + `engine/services/strategyCompiler.js`
  - Loads strategies from DB, validates, links runtime, registers with engine.
- Brokers:
  - Market data: `broker/twelvedata.js` (WS + REST)
  - Paper execution: `broker/paper.js`
  - Live execution: `engine/services/mt5Bridge.js`
- Persistence:
  - Pool: `engine/services/postgres.js`
  - Queries: `engine/services/pgStore.js`
- Shared event bus: `events/bus.js` (Node `EventEmitter`)

## Hotspots (Overcrowded Files)

Largest backend modules (highest refactor ROI):
- `engine/core/engine.js` (engine orchestration + backpressure + warmup cache I/O)
- `engine/strategyLoader.js` (boot pipeline, state restore, runtime update logic)
- `engine/routes/systemController.js` (system + account + integrations + ops)
- `engine/routes/backtestController.js` (uploads + storage + progress + reports + API)
- `engine/signalAdapter.js` (signal validation + routing + persistence + execution)
- `engine/routes/executionController.js` (strategy status + telemetry + history + ops)

## Improvement Ticket Template (Use This For Each Refactor)

- `Title`:
- `Area` (engine/broker/db/http/ws/strategy/backtest):
- `Evidence` (file + function + why it’s overloaded):
- `Risk` (what breaks in prod: latency, correctness, security, cost):
- `Change` (what you will extract/replace):
- `Acceptance` (measurable checks):
- `Tests` (unit/integration/load):
- `Rollout` (feature flag, canary, fallback plan):

## Priority Improvements (What To Fix First)

### P0: Security, Correctness, Production Failure Modes

1) Isolate strategy code execution
- Problem: `engine/services/strategyCompiler.js` compiles DB-provided code via Node module compilation (`Module._compile`).
- Risk: Remote-code-execution class of risk, filesystem/network access, process escape, secrets exposure.
- Standard: Run untrusted code out-of-process (worker) with a restricted API surface; treat the main process as trusted.
- Options:
  - Separate Node worker process with a narrow RPC surface (recommended for this codebase).
  - Sandboxing libraries (better than nothing, still risky in Node if requirements are strict).
 - References:
   - Node.js `vm` docs warn it is not a security mechanism for untrusted code.
   - OWASP Node.js Security Cheat Sheet (in particular: secrets management and least privilege).

2) Stop blocking the Node event loop on hot paths
- Problem: sync filesystem calls in runtime routes and backtest endpoints.
- Risk: pauses ticks, stalls WS, increases order latency and timeouts.
- Standard: async I/O only in the server process; long jobs offloaded to workers/queues.

3) Remove cross-module "global" side effects on import
- Problem: some modules create dirs/files/timers at import time.
- Risk: brittle startup, breaks in containers/readonly FS, hard-to-test behavior.
- Standard: `init()` / `start()` owns side effects; module import should be pure.

4) Fix case-sensitivity and encoding for Linux deployment
- Problem: mixed-case imports (Windows works; Linux breaks), non-ASCII log markers that show garbled output.
- Standard: consistent file casing and ASCII-safe logs (or enforce UTF-8 end-to-end).

5) Encrypt integration secrets at rest and never return them to the UI
- Problem: integration API keys/tokens are stored inside settings payloads and can be returned by `GET /api/system/settings`.
- Risk: credential leakage through UI logs, browser storage, or accidental sharing.
- Standard: encrypt-at-rest for secrets (app-layer encryption) and return masked values only.
- Status: implemented in this repo via `engine/services/secretsVault.js` + masking/encrypting in settings routes/config loader.
- Ops: set `COREX_SECRETS_KEY` to a 32-byte key (base64 or hex). Rotate by re-encrypting stored values.

### P1: Latency + Resource Efficiency

1) Eliminate per-event DB lookups in hot paths
- Problem: `engine/signalAdapter.js` queries `strategies.runtime_mode` to decide LIVE/PAPER.
- Standard: keep a memory cache of runtime_mode; update from loader/config refresh events; DB only on change/miss.
- Acceptance: one DB read per strategy change, not per signal.
 - Status: implemented (short TTL cache in `engine/signalAdapter.js`).

2) Replace `Array.shift()` queues with O(1) queues
- Problem: queue drain loops using `shift()` degrade with larger queues.
- Standard: head-index queue / ring buffer for any bounded queue.
 - Status: implemented for `engine/core/pipeline/SignalExecutionEngine.js`.

3) Add explicit backpressure policies
- Ensure you can choose behavior on overload:
  - Drop ticks (already implemented per-symbol).
  - Drop signals with metrics (already has bounded queue in execution pipeline).
  - Pause subscriptions / reduce symbol set / shed load.

4) Harden Postgres pool configuration
- Problem: default pool sizing/timeouts are implicit.
- Standard: configure pool size, idle timeout, statement timeout, connection timeout; track pool health.
 - Status: implemented in `engine/services/postgres.js` (env-configurable pool + stats).

### P2: Maintainability (Structure + Boundaries)

1) Make controllers thin (HTTP layer only)
- Goal: controllers parse/validate request, call an application service, return response.
- Move:
  - SQL and table knowledge into repositories (`*Repo`).
  - Business rules into services (`*Service`).
  - Cross-cutting concerns into middleware.

2) Replace implicit global coupling with explicit module dependencies
- Today: many modules `require()` each other and use the global bus.
- Standard: composition root wires dependencies once (bootstrap/container), modules expose stable interfaces.

3) Standardize module start/stop lifecycles
- Every long-lived component must support `start()` + `stop()` and must release:
  - timers/intervals
  - event listeners
  - sockets/ws clients
  - DB handles

## Standard Module Template (Recommended)

Use this pattern for new backend modules (example: `execution`):

```
engine/modules/execution/
  index.js                 # public API export
  executionService.js      # use cases, orchestration
  executionRepo.js         # SQL + persistence
  executionTypes.js        # stable DTO shapes / validators
  executionErrors.js       # error codes
  README.md                # boundaries + examples
```

Rules:
- No timers/listeners/FS writes at import-time.
- All I/O behind adapters/repos.
- Emit domain events from one place (not from helpers).
- Functions accept explicit dependencies; no hidden singletons.

## Proposed Target Modules (Map Existing Code Into Them)

- `engine/modules/marketData/`
  - from: `broker/twelvedata.js`
- `engine/modules/strategyRuntime/`
  - from: `engine/strategyLoader.js`, `engine/services/strategyCompiler.js`, `utils/BaseStrategy.js`
- `engine/modules/execution/`
  - from: `engine/signalAdapter.js`, `engine/services/mt5Bridge.js`, `broker/paper.js`
- `engine/modules/risk/`
  - from: `utils/riskManager.js` (currently not integrated)
- `engine/modules/backtest/`
  - from: `engine/backtestManager.js`, `engine/routes/backtestController.js`
- `engine/modules/system/`
  - from: `engine/routes/systemController.js`, `engine/services/healthCheck.js`
- `engine/modules/auth/`
  - from: `engine/services/authService.js`, `engine/routes/authController.js`
- `engine/modules/config/`
  - from: `engine/services/configService.js`, `engine/services/integrationRuntime.js`
- `engine/modules/telemetry/`
  - from: WS broadcaster, engine feed/execution metrics

## Refactor Plan (Incremental, Low-Risk)

Phase 1 (safe): extract helpers and caches
- Add mode cache in `SignalAdapter`.
- Convert hot queues to O(1).
- Fix Linux import casing.
 - Reduce WS overhead by computing shared status once per tick and using WS backpressure checks.
 - Add periodic data culling to enforce retention policies.
 - Encrypt integration secrets at rest and mask them in API responses.
 - Optional: enable live order dispatching from DB queue when MT5 bridge is authorized (`COREX_LIVE_DISPATCHER_ENABLED=true`).

Phase 2 (structure): split controllers
- `systemController.js` -> `system/heartbeat`, `system/integrations`, `system/admin`, `system/settings`
- `backtestController.js` -> `datasets`, `jobs`, `reports`, `settings`

Phase 3 (ops): move backtests to a worker
- Introduce a job queue (DB-backed or Redis-backed).
- UI polls job status; server remains responsive.

Phase 4 (security): isolate strategies
- Worker runs strategy code with a limited API.
- Main process only handles market data, risk checks, order submission, persistence.

## Acceptance Checklist (Done Means Done)

- No per-signal DB reads for runtime mode selection.
- No sync filesystem calls inside HTTP handlers.
- All services with timers/listeners implement `stop()` and are invoked on shutdown.
- Strategy execution runs outside the main server process (or is strongly sandboxed).
- Core queues are bounded and O(1) operations under load.
- Backend runs on Linux without case-related import failures.
- WS status/feed updates do not compute expensive snapshots per-client (compute once, fan out).
- Paper broker state is per-user (positions and cash are not shared across users).
