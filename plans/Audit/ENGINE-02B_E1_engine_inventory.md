# ENGINE-02B / E1 — `engine.js` Caller Inventory and Ownership Map (FINAL)

> **Status:** complete. Read-only audit. No source code changed, no caller repointed, no module extracted.
> **Checkout:** `origin/main` = `20bad625434dcbefcd7bea2a5d389ff887159d82` (PR #64 merged).
> **Worktree / branch:** `../corex-e1-final` / `docs/engine-e1-final-report`.
> **Subject file:** `engine/core/engine.js` (716 lines).
> **Roadmap entry:** E1, `plans/ROADMAP.md` line 57 and line 101.

## Evidence standard

| Label | Meaning |
|---|---|
| **CONFIRMED** | Directly supported by repository evidence, with file and line references. |
| **INFERRED** | Reasonable architectural interpretation, explicitly distinguished from fact. |
| **UNKNOWN** | Insufficient evidence; the missing evidence is stated. |

Search coverage for the "unused" claims: `rg` over all `*.js` excluding `node_modules`, across the whole repository (root, `engine/`, `packages/`, `utils/`, `test/`, `config/`, `events/`, `db/`, `scripts/`). A method is only reported unreferenced when no call site exists outside its own definition and tests.

Line numbers are from the current checkout.

---

## 1. Q1 — Public surface of `engine/core/engine.js`, callers, proposed ownership

The module exports **one object**: `module.exports = new CoreXEngine()` (`engine/core/engine.js:716`). Everything below is therefore reachable by any importer, including private-by-convention members. There is no class export, so tests reach into `CoreXEngine.prototype` only through `require("@core/core/engine").constructor` (see `test/engine-warmup-dispatch.test.js:110`).

### 1.1 Members with production callers

| Member | Kind | Production callers | Proposed ownership |
|---|---|---|---|
| `start()` | async method | `index.js:140` (bootstrap) | Engine bootstrap — stays in `engine/` |
| `stop()` | method | `index.js:174` (graceful shutdown) | Engine bootstrap — stays |
| `restart()` | async method | `index.js:96` (Ctrl+R) | Engine bootstrap — stays |
| `updateSettings()` | method | `index.js:135` (persisted DB settings), `engine/routes/systemController.js:497` (API) | Engine settings service — `engine/services/` |
| `getSettings()` | method | `engine/routes/systemController.js:474` | Engine settings service |
| `getFeedMetrics()` | method | `engine/services/broadcaster.js:680` (WS `FEED_METRICS`), `engine/routes/systemController.js:164`, `engine/routes/executionController.js:327` | Telemetry read-model — `engine/services/` |
| `getExecutionTelemetry()` | method | `engine/routes/executionController.js:279` | Telemetry read-model |
| `handleStrategyCrash()` | method | Not called directly; wired as a callback at `engine/core/engine.js:128` (`MarketFeed.setDeps({ onStrategyCrash })`), invoked by `packages/corex-market-data/src/MarketFeed.js:214` | Runtime supervision — `engine/runtime/` |
| `signalPipeline` | property | Read by `getFeedMetrics`/`getExecutionTelemetry`; `SignalExecutionEngine` is a module singleton, not per-engine | Pipeline wiring — `engine/boot/` |

### 1.2 Members with no production caller

| Member | Evidence | Classification |
|---|---|---|
| `warmupStrategy()` (`:453-586`) | Only referenced by `test/engine-warmup-dispatch.test.js:110` (`CoreXEngine.prototype.warmupStrategy.call(...)`). No production call site. | **CONFIRMED** unused in production |
| `getUptime()` (`:649-651`) | No call site anywhere in the repository. | **CONFIRMED** unused |
| `_getWarmupCachePolicy()` (`:379-383`) | Called only from `warmupStrategy()` (`:457`). | **CONFIRMED** reachable only through dead code |
| `_normalizeCachedBars()` (`:385-416`) | Called only from `warmupStrategy()` and `_readWarmupCacheAsync()`. | **CONFIRMED** reachable only through dead cache path |
| `_mergeBarsByTime()` (`:418-451`) | Called only from `warmupStrategy()`. | **CONFIRMED** reachable only through dead code |
| `_readWarmupCacheAsync()` / `_writeWarmupCacheAsync()` (`:588-607`) | Called only from `warmupStrategy()` and `_sanitizeCacheDirectory()`. | **CONFIRMED** partially live (sanitize) |
| `_sanitizeCacheDirectory()` (`:139-191`) | Called only from `start()` (`:95`). | **CONFIRMED** live, engine-start only |
| `_normalizeTimeframe()` / `_timeframeToMs()` (`:609-633`) | `_timeframeToMs` used by `_sanitizeCacheDirectory` (`:163`) and `warmupStrategy` (`:459`); both exercised by `test/engine-warmup-dispatch.test.js`. | **CONFIRMED** live but only for cache/warmup |

`strategy._warmedUp = true` (`:565`) is written and **never read** anywhere in the repository (only asserted in `test/engine-warmup-dispatch.test.js:143-262`). **CONFIRMED** write-only field.

### 1.3 Private members and their real consumers

| Member | Consumer | Note |
|---|---|---|
| `_wireSocketX()` (`:117-137`) | `constructor` (`:70`) | Performs four global wirings at construction time, not at `start()` |
| `_scheduleRecovery()` / `_attemptRecovery()` / `_clearRecovery()` (`:231-292`) | The `EVENTS.SYSTEM.STATE_CHANGED` listener registered in `start()` (`:104-110`) | Recovery state machine; see §8 |
| `strategyCrashCounters`, `maxCrashCount`, `crashTimeframe`, `allowColdStart` (`:73-76`) | `handleStrategyCrash` (`:212-228`) | `allowColdStart` is written and never read — **CONFIRMED** write-only |
| `recoveryBaseDelay`, `recoveryMaxDelay`, `recoveryFactor`, `recoveryMaxAttempts`, `strategyRecoveryStates` (`:79-83`) | `_scheduleRecovery`, `_attemptRecovery`, `getSettings`, `updateSettings` | Recovery configuration surface exposed through the settings API |
| `lifecycle` (`:57`) | `getFeedMetrics` (`:310`) | `ComponentLifecycle` instance, snapshot only |

`allowColdStart` (`:76`) is assigned from `COREX_ALLOW_COLD_START` and never read: the cold-start decision is actually taken in `RuntimeLifecycle.boot` (`engine/core/runtime/RuntimeLifecycle.js:185-188`), which derives it from the return value of `_warmup()`. **CONFIRMED** — the engine-level flag is dead configuration.

### 1.4 Import-time shape

`engine/core/engine.js` constructs the singleton at import (`:716`), so **importing the module runs the constructor**, which clears the console, prints the banner (`:52`, `:37-49`), builds a `ComponentLifecycle`, mutates the global `SignalExecutionEngine` configuration from environment variables (`:65-68`) and performs four global wirings (`_wireSocketX`, `:70`). See §3.

---

## 2. Q2 — Warmup ownership

### 2.1 The live warmup path (CONFIRMED)

```
strategyLoader.startStrategy(id, options)          engine/strategyLoader.js:366
  └─ new RuntimeLifecycle().boot({...})            engine/strategyLoader.js:467-472
       ├─ runtimeRegistry.reserve(...)             engine/core/runtime/RuntimeLifecycle.js:62
       ├─ stateManager.commit(runtimeId,"WARMING_UP")   RuntimeLifecycle.js:180
       ├─ this._warmup(instance, profile)          RuntimeLifecycle.js:185, 524-557
       │    ├─ DataProviderFactory.fetchHistorical(...)  RuntimeLifecycle.js:530-535
       │    └─ instance.dataManager.ingestBar(bar)       RuntimeLifecycle.js:541-549
       ├─ this._assertOwnership(runtimeId, token)  RuntimeLifecycle.js:194
       ├─ marketFeed.subscribe(runtimeId, symbol)  RuntimeLifecycle.js:197
       └─ stateManager.commit(runtimeId,"ACTIVE")  RuntimeLifecycle.js:210
```

Facts about the live path:

- `RuntimeLifecycle._warmup()` uses `strategyInstance.lookback` (default 100) and `strategyInstance.timeframe` (default `"1m"`) — `RuntimeLifecycle.js:526-527`. **CONFIRMED**
- It ingests into `dataManager` only. It does **not** call `strategy.onBar()`, does **not** set `_warmedUp`, and does **not** use the warmup cache. **CONFIRMED** (`RuntimeLifecycle.js:524-557`)
- `_warmup()` returns `false` on empty data or exception (`:537`, `:553-556`); `boot()` treats `false` as cold start and continues (`:185-188`). **CONFIRMED**
- `MarketFeed.subscribe()` lazily calls `MarketFeed.start()` (`packages/corex-market-data/src/MarketFeed.js:85`), which attaches the `EVENTS.MARKET.TICK` listener (`:63`). So the tick listener is attached by the first runtime subscribe, not by `engine.start()`. **CONFIRMED**

### 2.2 The dormant warmup path (CONFIRMED)

`engine.warmupStrategy()` (`:453-586`) is a second, unrelated implementation:

- reads/writes a CSV(-gz) cache under `data/cache` (`:455`, `:483`, `:588-607`)
- resolves per-strategy cache policy via `EngineSettings.resolveWarmupCache` (`:379-383`)
- dispatches each bar to `strategy.onBar(bar)` (`:555`) or `strategy.onTick(bar, true)` (`:557`), or to a remote worker via `strategyRuntime.warmupBar({strategyId, bar})` when `strategy.__remote` is truthy (`:547-553`)
- sets `strategy._warmedUp = true` (`:565`)

It has **no production caller** (§1.2). Two further facts:

- `strategy.__remote` is never assigned anywhere in production code — the only occurrences are `engine/core/engine.js:547` (the read) and `test/engine-warmup-dispatch.test.js:226,242` (test fixtures). **CONFIRMED**: the remote-warmup branch is unreachable in production.
- The worker pool that would serve `WARMUP_BAR` is lazily started by `workerPool.request()` (`engine/modules/strategyRuntime/workerPool.js:115`), but **no production code calls any `strategyRuntime` method except `stop()`** (`index.js:176`). `execTick`, `execBar`, `loadStrategy`, `unloadStrategy`, `updateParams` and `warmupBar` have no production callers. **CONFIRMED**: worker-based execution is entirely dormant.

### 2.3 Relationship summary

| Concern | Owner today | Note |
|---|---|---|
| History fetch for warmup | `RuntimeLifecycle._warmup` (live) and `engine.warmupStrategy` (dead) | Two implementations, different data sources (factory vs cache) |
| Bar ingestion | `dataManager.ingestBar` in both | The only shared primitive |
| Cache policy | `EngineSettings.resolveWarmupCache` (`engine/core/EngineSettings.js`) | Used only by the dead path |
| Remote warmup | `strategyRuntime.warmupBar` → `workerPool` → `strategyWorker.WARMUP_BAR` (`engine/workers/strategyWorker.js:118`) | Unreachable from any live path |
| Warmup completion flag | `strategy._warmedUp` | Written by the dead path, read nowhere |
| Runtime cache/plot timer | `RuntimeRegistry.set()` `setInterval` (`engine/core/runtime/RuntimeRegistry.js:116-135`) | Per-runtime plot broadcast timer, unrelated to warmup; cleared in `delete()` (`:468-470`) and `clear()` (`:477-481`) |

**INFERRED:** warmup was moved from the engine into `RuntimeLifecycle` during the Stage 2 work and the engine-side implementation was left behind as a caller-less duplicate. Nothing in the repository records that decision; the code shape and the `ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md` report are consistent with it.

**UNKNOWN:** whether `engine.warmupStrategy`'s cache/remote behaviour is still wanted. Only Owen can say whether the cache layer should be revived inside `RuntimeLifecycle._warmup` or the engine implementation deleted. No evidence in the repository decides this.

---

## 3. Q3 — Import-time side effects and modules dependent on their timing

### 3.1 Side effects of importing `engine/core/engine.js`

| # | Side effect | Evidence | Classification |
|---|---|---|---|
| 1 | `require("module-alias/register")` — global alias registration | `engine/core/engine.js:3` | **CONFIRMED** |
| 2 | `new CoreXEngine()` runs at import | `engine/core/engine.js:716` | **CONFIRMED** |
| 3 | `console.clear()` + banner read/print, unless `NODE_ENV=test`, Jest, or `COREX_NO_BANNER` | `:52`, `:37-49` | **CONFIRMED** |
| 4 | `ComponentLifecycle` constructed; `status="IDLE"` | `:55-57` | **CONFIRMED** |
| 5 | Global mutation of `SignalExecutionEngine` settings from `SIGNAL_EXEC_CONCURRENCY` / `SIGNAL_EXEC_MAX_QUEUE` | `:65-68` | **CONFIRMED** |
| 6 | `RiskGateway.setRiskEngine(SocketXRiskEngine)` | `:118` | **CONFIRMED** |
| 7 | `SocketXServer.setAuthVerifier(...)` closing over `verifyToken` | `:119-125` | **CONFIRMED** |
| 8 | `MarketFeed.setDeps({registry: RuntimeRegistry, onStrategyCrash})` | `:126-129` | **CONFIRMED** |
| 9 | `BaseBroker.setRiskValidator(...)` closing over `SignalProcessingEngine` | `:130-132` | **CONFIRMED** |
| 10 | `process.env.COREX_ALLOW_COLD_START` read into a dead field | `:76` | **CONFIRMED** |
| 11 | `@data` package index auto-registers `TwelveDataProvider` and calls `DataProviderFactory.setActive("twelvedata")` at import | `packages/corex-market-data/index.js:23-31` | **CONFIRMED** |
| 12 | `RuntimeRegistry` module reads `COREX_WS_PLOT_INTERVAL_MS` at load | `engine/core/runtime/RuntimeRegistry.js:7` | **CONFIRMED** |
| 13 | `events/bus.js` creates a process-wide `EventEmitter` with `maxListeners` from `COREX_BUS_MAX_LISTENERS` (default 1000) | `events/bus.js:5-8` | **CONFIRMED** |

### 3.2 Modules whose behaviour depends on that timing

| Module | Dependency | Consequence if order changes | Classification |
|---|---|---|---|
| `engine/services/broadcaster.js` | Imports the engine at module load (`:10`) for `getFeedMetrics` (`:675-680`) | Importing the broadcaster constructs and wires the engine; the WS layer therefore cannot be loaded without triggering engine construction | **CONFIRMED** |
| `engine/routes/systemController.js:16`, `engine/routes/executionController.js:15` | Same import-time coupling | Route modules construct the engine on import (also in tests) | **CONFIRMED** |
| `packages/corex-market-data/src/MarketFeed.js` | `_resolveDeps()` throws when deps were never injected and the process is not a test (`:56`) | Any runtime crash before `_wireSocketX()` runs escalates from "best effort" to a thrown error inside the feed's catch block | **CONFIRMED** |
| `packages/corex-broker-contract` `BaseBroker` | Global risk validator installed at engine construction (`engine/core/engine.js:130-132`) | Broker signal validation is un-wired until the engine module is imported, not until `engine.start()` | **CONFIRMED** |
| `engine/services/broadcaster.js` `_bindInternalEvents()` | Binds `BUS_EVENT_TO_WS` handlers once during broadcaster init (`:187-205`), with `_unbindInternalEvents()` (`:207-210`) | Events emitted before broadcaster init are lost to WS clients; the broadcaster has an unbind path, the engine does not | **CONFIRMED** |
| `config/constants.js` | Builds `BUS_EVENT_TO_WS` at module load | Static table; no timing risk | **CONFIRMED** (no risk) |

**INFERRED:** because the singleton is constructed at import, "engine wired" and "engine started" are indistinguishable to a reader, and the wirings are not idempotent by construction — they are re-applied only when the module is first loaded in a process. No code path re-runs `_wireSocketX()` after `stop()`.

---

## 4. Q4 — Package-relative imports, engine imports, `@core` vs `@core/core`

### 4.1 Alias map (CONFIRMED, `package.json:35-51`)

```
@root → .            @core → ./engine        @strategies → ./strategies
@utils → ./utils     @data → ./packages/corex-market-data
@auth → ./packages/corex-auth
@events → ./events   @config → ./config
corex-accounts / corex-broker-contract / corex-market-data / corex-auth /
corex-gateway / corex-portfolio / corex-strategy-engine → ./packages/<name>
```

`@strategies` points at `./strategies`, which does not exist in this checkout — the alias is declared but has no target. **CONFIRMED** (directory absent; `rg` over `strategies/` fails with "cannot find the file specified").

### 4.2 `@core` vs `@core/core`

`@core` is literally `./engine`. Therefore:

- `@core/services/x` → `engine/services/x`
- `@core/core/engine` → `engine/core/engine`
- `@core/core/runtime/RuntimeRegistry` → `engine/core/runtime/RuntimeRegistry`

`@core/core/...` is **not** a separate alias. It is `engine/` + the subdirectory named `core`. The doubled segment is an artifact of nesting a directory called `core` inside the directory aliased as `core`. It is a naming collision, not a dependency boundary. **CONFIRMED**

Measured usage: **44** import sites use `@core/core/...`; **0** sites use `@core/...` for a path outside `engine/core`. The distinct `@core/*` targets are listed in §9. **CONFIRMED**

### 4.3 Cross-boundary imports from the subject file

| Import | Kind | Boundary rule (AGENTS.md §3.8) | Classification |
|---|---|---|---|
| `engine/core/engine.js:21` `require("../../packages/corex-gateway/index.js")` | Relative path into another package | Package registered as `corex-gateway`; should be imported by package name | **CONFIRMED** violation |
| `engine/core/engine.js:23` `require("../../packages/corex-auth/index.js")` | Relative path into another package | Package also aliased as `@auth` **and** named `corex-auth`; two legal non-relative forms exist | **CONFIRMED** violation |
| `engine/core/engine.js:22` `require("corex-broker-contract")` | Package name | Correct | **CONFIRMED** correct |

Eight relative cross-package imports exist inside `engine/` in total: `engine/core/engine.js:21,23`, `engine/services/brokerPersistence.js:3`, `engine/services/authService.js:10`, `engine/services/secretsVault.js:10`, `engine/routes/settingsController.js:8`, plus the two `engine/core/data/*` re-export shims (`DataProviderContract.js:3`, `providers/TwelveDataProvider.js:3`). **CONFIRMED**

**INFERRED:** the relative form was kept because it also reaches *internal* files (`/src/...`) that the package `index.js` does not export. That is exactly the pattern AGENTS.md §3.9 forbids, and it means a package cannot reorganise its internals without breaking `engine/`.

---

## 5. Q5 — Shutdown, stop, restart, runtime termination, listener and timer cleanup

### 5.1 `engine.stop()` (`engine/core/engine.js:635-647`) — CONFIRMED

Does: log, `status="STOPPING"`, `lifecycle.transition(STOPPING)`, `legacyMarketData.cleanup()`, `strategyCrashCounters.clear()`, `status="IDLE"`, `lifecycle.transition(STOPPED)`, `console.clear()`.

Does **not**:

- terminate any runtime in `RuntimeRegistry` (no `forStrategy`/`all()` iteration, no `terminate()` call)
- clear `strategyRecoveryStates` timers (`_clearRecovery` is only called from the state-changed listener and `_attemptRecovery`)
- remove the `EVENTS.SYSTEM.STATE_CHANGED` listener registered in `start()` (`:104-110`)
- unsubscribe feeds, destroy brokers or clear plot intervals
- reset `this.status` to a terminal value (it returns to `IDLE`, re-arming `start()`)

### 5.2 Shutdown orchestration — CONFIRMED

`index.js:155-189` runs, in order: `engine.stop()` (`:174`), `server.stop()` (`:175`), `strategyRuntime.stop()` (`:176`), `dataCuller.stop()` (`:177`), `liveOrderDispatcher.stop()` (`:178`), `jobWorkerSupervisor.stop()` (`:179`), `db.close()` (`:180`), with a `COREX_SHUTDOWN_FORCE_MS` (default 5000) forced-exit timer (`:168-171`).

So **`index.js` does separately invoke `strategyRuntime.stop()`** — the engine does not own worker shutdown, and that is correct today. **CONFIRMED** (question answered: yes).

But **no component terminates active runtimes**: `RuntimeRegistry` still holds live entries (with live brokers and plot intervals) when the process exits. `RuntimeLifecycle.terminate()` is never called on the shutdown path. **CONFIRMED**

### 5.3 Repeated `start()` — CONFIRMED duplicate listeners

- `start()` is guarded by `if (this.status !== "IDLE") return;` (`:87`).
- `stop()` sets `status = "IDLE"` (`:643`), so `restart()` (`:653-658`) → `stop()` → `start()` passes the guard on every cycle.
- Each `start()` registers a **new** `bus.on(EVENTS.SYSTEM.STATE_CHANGED, ...)` (`:104-110`) with no matching `off`.
- Each `start()` also calls `loader.init(this)` (`:101`), and `engine/strategyLoader.js:117-121` registers a **new** `bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, ...)` per `init()` with no removal and no re-entry guard.
- `bus.setMaxListeners(1000)` (`events/bus.js:7-8`) suppresses the default `MaxListenersExceededWarning`, so the leak is silent.

**Consequence (INFERRED, following directly from the code):** after N restart cycles, one `STATE_CHANGED` event invokes `_scheduleRecovery` N times for the same id. `_scheduleRecovery` clears and re-arms the same timer per id (`:236`), so the practical effect is N redundant log lines and N timer resets rather than N timers — but `_attemptRecovery` is then reachable from a listener that is never removed, and the strategy-recovery counters double-count attempts on every restart.

### 5.4 Runtime termination ownership — CONFIRMED

| Operation | Owner | Evidence |
|---|---|---|
| Create runtime | `RuntimeLifecycle.boot()` + `RuntimeRegistry.reserve/commitReservation` | `RuntimeLifecycle.js:50-232`, `RuntimeRegistry.js:192-329` |
| Terminate runtime | `RuntimeLifecycle.terminate()` (idempotent, joins in-flight cleanup) | `RuntimeLifecycle.js:574-587`, `625-778` |
| Stop by strategy | `strategyLoader.stopStrategy()` → `new RuntimeLifecycle().terminate()` per target | `engine/strategyLoader.js:500-569` |
| Timer cleanup | `RuntimeRegistry.delete()` / `clear()` clear `plotInterval` | `RuntimeRegistry.js:468-470`, `477-481` |
| Process shutdown | **nobody** calls `terminate()` | `index.js:173-180` |

---

## 6. Q6 — `EVENTS.SYSTEM.STATE_CHANGED` and `EVENTS.SYSTEM.ERROR`

### 6.1 `EVENTS.SYSTEM.STATE_CHANGED`

| Role | Site | Evidence |
|---|---|---|
| Emitter (single) | `stateManager.commit()` — every state transition | `utils/stateController.js:62` |
| Listener | Engine recovery state machine | `engine/core/engine.js:104-110` |
| Listener | WS bridge, mapped to `WS_EVENT_TYPES.STRATEGY_STATE` | `config/constants.js:161`, bound in `engine/services/broadcaster.js:188-204` |

Transition rules that gate emission: `utils/stateController.js:16-29`. `ERROR` is reachable only from `WARMING_UP` or `ACTIVE`. A commit for an id with no ledger entry is rejected (`current` undefined → `allowed` empty → `STATE_COLLISION` logged, `false` returned), and **no event is emitted in that case** — so a crash recorded against an identity that never booted through `RuntimeLifecycle` produces no recovery scheduling. **CONFIRMED**

Payload: `{ id, from, to, meta, at }`, with routing meta `{ userId }` derived from the `::`-prefix of `id` (`utils/stateController.js:58-65`).

### 6.2 `EVENTS.SYSTEM.ERROR`

| Role | Site | Evidence |
|---|---|---|
| Emitter | `engine.handleStrategyCrash()` — `{source:"strategy", strategyId, message, at}` | `engine/core/engine.js:205-210` |
| Emitter | `engine/services/strategyCompiler.js:279` | `engine/services/strategyCompiler.js:279` |
| Emitter | `engine/routes/systemController.js:603` (admin reset) | `engine/routes/systemController.js:603` |
| Emitter | `engine/core/pipeline/SignalGenerationEngine.js:62,99,216` | as listed |
| Listener | WS bridge → `WS_EVENT_TYPES.SYSTEM_ERROR` | `config/constants.js:164`, `broadcaster.js:188-204` |
| Listener | **none else** — no runtime-side handler | `rg "SYSTEM.ERROR"` over the repository |

**CONFIRMED:** `EVENTS.SYSTEM.ERROR` is emit-only apart from the WS bridge. No component reacts to it programmatically; the only behavioural reaction in the system is the engine's separate `STATE_CHANGED` listener.

---

## 7. Q7 — Proposed extraction map

Ownership follows AGENTS.md §3.4/§3.5: `engine/` owns orchestration; domain packages own domain concepts. Everything below is a **proposal**, not an approved change.

| Concern | Members to move | Target | Callers to repoint | Depends on |
|---|---|---|---|---|
| **Supervision** | `strategyCrashCounters`, `maxCrashCount`, `crashTimeframe`, `recovery*` fields, `handleStrategyCrash`, `_scheduleRecovery`, `_attemptRecovery`, `_clearRecovery`, the `STATE_CHANGED` listener | `engine/runtime/RuntimeSupervisor.js` (new) | `engine/core/engine.js:128` (wiring), `start()` (`:104-110`), `getSettings`/`updateSettings` (`:666-671`, `:681-697`) | P0 items 1, 2, 4 (fix the recovery defects before moving the code) |
| **Bootstrap / wiring** | `_wireSocketX`, the `SignalExecutionEngine.updateSettings` call, `_sanitizeCacheDirectory` call in `start()` | `engine/boot/` (e.g. `EngineBootstrap.js`) | `index.js:140`, tests importing the engine for side effects | P0 item 4 (idempotent wiring) |
| **Telemetry / read-model** | `getFeedMetrics`, `getExecutionTelemetry`, `getUptime` (or drop it), `getSettings` | `engine/services/EngineTelemetry.js` (or reuse an existing service) | `broadcaster.js:680`, `systemController.js:164,474`, `executionController.js:279,327` | none — no behavioural risk; pure read-only projection over `RuntimeRegistry`, `MarketFeed`, `SignalExecutionEngine` |
| **Warmup + cache** | `warmupStrategy`, `_getWarmupCachePolicy`, `_normalizeCachedBars`, `_mergeBarsByTime`, `_readWarmupCacheAsync`, `_writeWarmupCacheAsync`, `_normalizeTimeframe`, `_timeframeToMs`, `_sanitizeCacheDirectory` | Decide first: `engine/services/` if the cache is still wanted, otherwise delete with `EngineSettings.resolveWarmupCache` | none in production (only tests) | Owen's decision on §2.3 (revive vs delete). Not a mechanical move. |
| **Settings** | `getSettings`/`updateSettings` recovery block | `engine/services/` settings service | `index.js:135`, `systemController.js:497` | Telemetry row (same file) |
| **Dead shims** | `engine/engine.js`, `engine/managers/strategyManager.js`, `engine/signalAdapter.js` | delete | none — all three have no importers | separate cleanup task, not E1 |

Not proposed for extraction: `RuntimeRegistry` and `RuntimeLifecycle` are already owned and were settled by Stage 2 (`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`). Nothing in `engine/core/runtime/` moves under E1.

---

## 8. Re-verification of the previously identified critical findings

All eight were rechecked against `origin/main` = `20bad62`.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Recovery calls `loader.startStrategy(id)` and may treat `{ok:false}` as success because it checks object truthiness | **CONFIRMED** | `engine/core/engine.js:278-281` — `const success = await loader.startStrategy(id); if (!success) this._scheduleRecovery(id);`. `strategyLoader.startStrategy` returns an object on every path: `{ok:true, ...}` (`engine/strategyLoader.js:419`, `479`), `{ok:false, reason}` (`:369`, `:426`, `:428`, `:484`, `:489`, `:492`, `:494`). A failure object is truthy, so the retry branch is unreachable and the recovery loop dies silently after one attempt. |
| 2 | `runtimeService.startStrategy()` checks `result.ok` differently | **CONFIRMED** | `engine/services/runtimeService.js:23-27` — `if (!result || !result.ok) throw new Error(...)`. Correct handling; the defect is local to the engine. |
| 3 | `strategyLoader._engine` is assigned but never read | **CONFIRMED** | `engine/strategyLoader.js:46` (`let _engine = null`) and `:111` (`_engine = engine`) are the only two occurrences in the file; `rg "_engine" engine/strategyLoader.js` returns exactly those two lines. |
| 4 | Repeated `engine.start()` registers duplicate state listeners | **CONFIRMED** | §5.3. Guard at `:87`, listener added at `:104-110`, `stop()` resets status to `IDLE` at `:643`, `restart()` at `:653-658`. Additionally `loader.init()` adds a `SETTINGS_UPDATED` listener each time (`engine/strategyLoader.js:117-121`). |
| 5 | `engine.stop()` clears recovery timers and removes listeners | **REFUTED — it does neither** | `engine/core/engine.js:635-647`: no `_clearRecovery`, no `bus.off`, no `clearTimeout` over `strategyRecoveryStates`. |
| 6 | Overall `index.js` shutdown separately invokes `strategyRuntime.stop()` | **CONFIRMED** | `index.js:176` — `try { await strategyRuntime.stop(); }`. |
| 7 | `warmupStrategy()` has production callers | **REFUTED — it has none** | §1.2: only `test/engine-warmup-dispatch.test.js:110` calls it. |
| 8 | Shutdown actually terminates active runtimes | **REFUTED — it does not** | `index.js:173-180` stops engine, server, worker pool, culler, dispatcher, job supervisor and DB; no `RuntimeRegistry` iteration and no `RuntimeLifecycle.terminate()`. Plot intervals (`RuntimeRegistry.js:116-135`) are `unref`'d, so the process still exits, but brokers/instances are never destroyed and feed subscriptions are never released. |

### Additional defect found during verification (new)

**Recovery uses the wrong identity space.** `handleStrategyCrash` receives a **runtimeId** (`MarketFeed.js:214` passes `entry.runtimeId`), then:

- `_attemptRecovery` calls `RuntimeRegistry.forStrategy(id)` (`engine/core/engine.js:272`) — `forStrategy` matches `entry.strategyName` (`RuntimeRegistry.js:517-524`), and `strategyName` is `userId::strategy` while `runtimeId` is `userId::strategy::SYMBOL::MODE` (`engine/strategyLoader.js:413`, `471`). The lookup always returns `[]`, so the "force termination of partial runtime state" loop never runs.
- `loader.startStrategy(id)` (`:278`) then queries `strategies WHERE name = $1` with the runtimeId (`engine/strategyLoader.js:375-383`) → no row → throws → caught → returns `{ok:false}` → truthy → no reschedule.

**CONFIRMED** by code path. Combined with finding 1, a crashed runtime is never restarted and never retried.

---

## 9. Evidence table

| Finding | Classification | Evidence | Implementation implication |
|---|---|---|---|
| Engine singleton constructed at import | CONFIRMED | `engine/core/engine.js:716`; `:37-49`, `:65-68`, `:117-137` | Any importer triggers global wiring; tests and the WS layer inherit it |
| Four global wirings are constructor-time, not start-time | CONFIRMED | `engine/core/engine.js:70`, `:117-137` | `engine.start()` is not required for `BaseBroker` risk validation or `MarketFeed` crash reporting to be live |
| `RiskGateway`, `SocketXServer`, `MarketFeed`, `BaseBroker` are the four wiring targets | CONFIRMED | `engine/core/engine.js:118-132` | Bootstrap extraction must preserve exactly these four, in this order, before any runtime can boot |
| `getFeedMetrics` has three production consumers | CONFIRMED | `broadcaster.js:680`; `systemController.js:164`; `executionController.js:327` | Safe to extract as a read-model; no state ownership involved |
| `getExecutionTelemetry` has one consumer | CONFIRMED | `executionController.js:279` | Derive-from-`RuntimeRegistry` projection already documented at `:325-332`; keep as-is when moving |
| `updateSettings` mixes recovery tuning, pipeline tuning, log level and storage config | CONFIRMED | `engine/core/engine.js:675-713` | Split when extracting; the recovery subset belongs with supervision |
| `getSettings` exposes recovery internals | CONFIRMED | `:660-673` | Same split; API consumers are `systemController.js:474` |
| `allowColdStart` is written, never read | CONFIRMED | `:76`; cold-start decision at `RuntimeLifecycle.js:185-188` | Remove or wire; it is misleading configuration today |
| `_warmedUp` is written, never read | CONFIRMED | `:565`; no reader in the repository | Remove with the dead warmup path |
| `engine.warmupStrategy` has no production caller | CONFIRMED | `:453-586`; test-only call at `test/engine-warmup-dispatch.test.js:110` | Decide revive-vs-delete before extracting |
| Live warmup lives in `RuntimeLifecycle._warmup` | CONFIRMED | `RuntimeLifecycle.js:524-557`; invoked at `:185` | Any warmup change must target `RuntimeLifecycle`, not the engine |
| Remote warmup branch unreachable (`strategy.__remote` never set) | CONFIRMED | `:547`; only test fixtures set it | Worker warmup is dead code in practice |
| Worker execution path entirely dormant | CONFIRMED | `engine/modules/strategyRuntime/index.js:16-49` — no production caller except `stop()` at `index.js:176` | Do not design E1 extraction around worker IPC |
| `MarketFeed.subscribe()` lazily starts the feed | CONFIRMED | `MarketFeed.js:85` | No separate feed-start call exists or is needed |
| `EVENTS.MARKET.TICK` has a single listener (MarketFeed) | CONFIRMED | `MarketFeed.js:63` | Tick fan-out is inside the market-data package |
| `EVENTS.SYSTEM.STATE_CHANGED` has one emitter and one behavioural listener | CONFIRMED | `stateController.js:62`; `engine/core/engine.js:104-110` | Supervision extraction moves the only behavioural consumer |
| `EVENTS.SYSTEM.ERROR` has no programmatic listener | CONFIRMED | emit sites listed in §6.2; only WS bridge binds it | Errors are UI-visible only; no runtime reacts |
| Bus max listeners raised to 1000 | CONFIRMED | `events/bus.js:7-8` | Listener leaks are silent; cleanup must be explicit |
| Duplicate `STATE_CHANGED` + `SETTINGS_UPDATED` listeners per restart | CONFIRMED | `engine/core/engine.js:87`, `:104-110`, `:643`, `:653-658`; `engine/strategyLoader.js:117-121` | Restart cycles must remove listeners or register once |
| Recovery never retries after a failed restart | CONFIRMED | `engine/core/engine.js:278-281` vs return shapes in `engine/strategyLoader.js:369-494` | One-line class of fix, but must be covered by a test |
| Recovery looks up runtimes by the wrong id space | CONFIRMED | `engine/core/engine.js:272`, `:278`; `MarketFeed.js:214`; `RuntimeRegistry.js:517-524`; `engine/strategyLoader.js:413`, `471` | Fix must derive `strategyName` from the registry entry or the scoped id |
| `engine.stop()` does not terminate runtimes, clear timers or remove listeners | CONFIRMED | `engine/core/engine.js:635-647`; `index.js:173-180` | Shutdown path needs a runtime-termination step |
| `@core/core/*` is not a separate alias | CONFIRMED | `package.json:35-51`; 44 import sites | Cosmetic, mechanical, wide blast radius — not E1 |
| Relative cross-package imports from the engine | CONFIRMED | `engine/core/engine.js:21`, `:23` (+6 more in `engine/`) | Boundary cleanup belongs with the owning package, not E1 |
| `engine/engine.js`, `engine/managers/strategyManager.js`, `engine/signalAdapter.js` have no importers | CONFIRMED | `rg` over all `*.js` returns no import of any of the three | Dead shims; delete in a separate cleanup task |
| `@strategies` alias targets a non-existent directory | CONFIRMED | `package.json:38`; directory absent | Remove or create; unrelated to E1 |
| Whether the warmup cache layer is still wanted | UNKNOWN | No design record, no caller, no decision entry in `plans/decisions.md` | Requires Owen; blocks the warmup extraction row |
| Whether recovery state should survive a process restart | UNKNOWN | `strategyRecoveryStates` is in-memory only (`engine/core/engine.js:83`); `strategy_runtimes` persists desired state (`engine/strategyLoader.js:269-290`) but not attempts/backoff | Design decision for supervision extraction |
| Whether `EngineSettings.resolveWarmupCache` has any live consumer if the cache is dropped | UNKNOWN | Only `engine/core/engine.js:382` calls it | Follows from the warmup decision |

---

## 10. Implementation handoff (prioritised)

Categories: **P0** correctness/reliability defects demonstrated by evidence; **P1** safe structural extraction; **Later** deferred architectural work. Items are proposals, not approved work.

### P0 — Correctness / reliability defects

| ID | Problem | Files / methods | Evidence | Recommended change | Dependencies / risks | Task ID |
|---|---|---|---|---|---|---|
| P0-1 | Failed auto-restart is treated as success; recovery never retries | `engine/core/engine.js:262-286` (`_attemptRecovery`), esp. `:278-281` | `strategyLoader.startStrategy` always returns an object; `{ok:false}` is truthy | Check `result?.ok === true` (and treat `reason` as the failure), mirroring `runtimeService.js:24` | Needs a regression test that a failed start reschedules recovery. Behaviour change on a live trading path — audit trail (`[RECOVERY]` logs) must be preserved | `ENGINE-02B-P0-1` |
| P0-2 | Recovery operates on the wrong identity (runtimeId used as strategyName) | `engine/core/engine.js:231-292`; `MarketFeed.js:214`; `RuntimeRegistry.js:517-524`; `engine/strategyLoader.js:413`, `471` | `forStrategy(runtimeId)` always `[]`; `startStrategy(runtimeId)` never finds a DB row | Resolve the strategy name from the registry entry (`runtimeRegistry.get(id)?.strategyName`) or from `parseScopedId`, then operate on `strategyName` | Must not weaken `runtimeId` scoping (protected boundary, AGENTS.md §7.6). Combine with P0-1 in one change so the recovery loop is testable end to end | `ENGINE-02B-P0-2` |
| P0-3 | `engine.stop()` leaves runtimes, timers and listeners alive | `engine/core/engine.js:635-647`; `index.js:173-180`; `RuntimeRegistry.js:116-135`, `468-470` | No `terminate()`, no `_clearRecovery`, no `bus.off` | On stop: terminate all registered runtimes via `RuntimeLifecycle`, clear `strategyRecoveryStates`, remove the `STATE_CHANGED` listener (keep a handle) | Shutdown currently relies on forced exit (`COREX_SHUTDOWN_FORCE_MS`); adding termination can lengthen shutdown — must stay inside the force timer. Do not remove `strategyRuntime.stop()` from `index.js:176` | `ENGINE-02B-P0-3` |
| P0-4 | Listener leak across restart cycles (engine + bootloader) | `engine/core/engine.js:87`, `:104-110`, `:653-658`; `engine/strategyLoader.js:109-130` | Guard resets to `IDLE` on stop; listeners re-added per `start()`/`init()`; bus limit 1000 hides it | Register once (module scope or an `initialized` flag) or remove on stop; add an `init()` re-entry guard in the bootloader | Touches the bootloader's init contract; tests asserting listener counts may exist (`test/runtimeOwnership.test.js`) | `ENGINE-02B-P0-4` |

### P1 — Safe structural extraction

The roadmap already reserves E2/E3/E4 for these three extractions (rows 7a/7b/7c, `plans/ROADMAP.md:61-63`, all `LATER`, all blocked on "E1 approved"). The IDs below map onto them; no new roadmap row is needed except for P1-4.

| ID | Problem | Files / methods | Evidence | Recommended change | Dependencies / risks | Task ID |
|---|---|---|---|---|---|---|
| P1-1 | Supervision is embedded in the engine singleton | `engine/core/engine.js:73-83`, `:202-292` | §7 table; `handleStrategyCrash` is the only behavioural `STATE_CHANGED` consumer | Extract `RuntimeSupervisor` under `engine/runtime/`, constructed by bootstrap with injected `stateManager`/`bus`/`runtimeRegistry` | Must land after P0-1/P0-2/P0-4, otherwise the defects move with the code. Maps to roadmap **E2** | `E2` |
| P1-2 | Telemetry is a read-model living on the engine singleton | `engine/core/engine.js:294-377`, `:660-673` | §1.1 consumers | Extract a telemetry/settings service; engine delegates | Low risk: read-only over `RuntimeRegistry`/`MarketFeed`. Watch the `getSettings` ↔ `updateSettings` round-trip used by `index.js:135` and `systemController.js:497`. Maps to roadmap **E4** | `E4` |
| P1-3 | Bootstrap/wiring is a constructor side effect | `engine/core/engine.js:37-49`, `:65-68`, `:117-137` | §3.1 | Move the four wirings and the pipeline settings into an explicit `engine/boot` step invoked by `start()` (idempotent) | Changes when `BaseBroker` risk validation becomes live. Requires P0-4's idempotency work. Highest-risk P1 — own task with a wiring test. Maps to roadmap **E3** (which explicitly records that wiring stays at construction time — that note must be revisited if this is approved) | `E3` |
| P1-4 | Dead warmup/cache code and write-only fields | `engine/core/engine.js:379-607`, `:565`, `:76`; `engine/core/EngineSettings.js` | §1.2, §2.2 | **Decide first**: revive the cache inside `RuntimeLifecycle._warmup`, or delete the engine implementation with `EngineSettings.resolveWarmupCache` | Blocked on the UNKNOWN in §2.3. Deleting removes the only caller of `test/engine-warmup-dispatch.test.js` — that test must be retired with it. No existing roadmap row; needs one if approved | `ENGINE-02B-P1-4` |

### Later — Deferred architectural work

| ID | Item | Why deferred | Task ID |
|---|---|---|---|
| L-1 | Normalise `@core/core/*` (44 sites) to `@core/*` | Mechanical but wide; belongs with E2–E4 caller repointing, not with E1 | `E2`–`E4` scope |
| L-2 | Replace relative cross-package imports in `engine/` with package names or public APIs (8 sites) | Requires each package to export the needed internals (AGENTS.md §3.9) | with the owning packages |
| L-3 | Delete dead shims `engine/engine.js`, `engine/managers/strategyManager.js`, `engine/signalAdapter.js` | No importers, but deletion is a separate cleanup with its own review | separate cleanup task |
| L-4 | Remove or implement the `@strategies` alias | Unrelated to E1; `./strategies` does not exist | separate |
| L-5 | Persist recovery attempt/backoff state (or accept per-process recovery) | Requires a state-recoverability decision (AGENTS.md §7.3) | with `E2` |
| L-6 | `backtestManager` split and `StrategyLoader` facade collapse | Already roadmap item P7, depends on P5/P6 and STAGE-4 | `P7` |

Explicitly **not** approved by this report: moving `RuntimeRegistry`/`RuntimeLifecycle` (Stage 2 territory), moving warmup into a package, and any caller repointing.

---

## 11. Tally

Counted over the distinct findings in this document (the 26 CONFIRMED rows of §9, the four INFERRED paragraphs in §2.3/§3.2/§4.3/§5.3, and the three UNKNOWN items that appear in §2.3 and §9):

| Classification | Count |
|---|---|
| CONFIRMED | 26 |
| INFERRED | 4 |
| UNKNOWN | 3 |

---

## 12. Limitations

- Static inspection only. No test suite was executed for this report and no runtime behaviour was exercised; findings are about the code as written.
- "No production caller" means no call site in any `*.js` outside `node_modules` in this checkout. Dynamic dispatch by string (`require(`@core/${name}`)`) was searched for and not found, but a computed import outside the searched patterns cannot be fully excluded.
- The `strategies/` directory referenced by the `@strategies` alias does not exist here; any strategy code that would live there is out of scope.
- Warmup intent (§2.3) and recovery-state durability (§10 L-5) are product decisions and remain UNKNOWN.
- Line numbers refer to `origin/main` = `20bad62`; they will drift as E2–E4 land.

**No application source code was modified. No caller was repointed. No module was extracted.**