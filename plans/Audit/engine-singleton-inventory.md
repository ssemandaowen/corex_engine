# J10 — Engine Singleton Inventory

> Evidence-only analysis (no code changes). Branch: `jules/j10-engine-singletons`.
> Scope: every module under `engine/` that exports an instance or holds module-level mutable state.
> Labels: **OBSERVED** = directly seen in source; **INFERRED** = derived from importer scan / behavior reasoning.
> Sorted by importer count (descending).

## Summary table

| # | Module | Lines | State it holds | Importers | Reads config/db/env at require? | Starts timers/connections at require? |
|---|--------|-------|----------------|-----------|-------------------------------|-------------------------------------|
| 1 | `engine/services/postgres.js` | 109 | `let pool` (pg Pool, lazily created) | 37 | INFERRED: reads `process.env` only inside `getPool()` (lazy) | INFERRED: no — `pool` created on first `getPool()` call, not at require |
| 2 | `engine/services/pgStore.js` | 648 | `module.exports = new PgStore()` | 14 | INFERRED: queries via `postgres.getPool()` inside methods | INFERRED: no — queries are method-scoped |
| 3 | `engine/core/loader/StrategyLoader.js` | 141 | `module.exports = new StrategyLoader()` | 7 | INFERRED: no | INFERRED: no |
| 4 | `engine/core/engine.js` | 718 | `module.exports = new CoreXEngine()` | 5 | INFERRED: no | INFERRED: `setTimeout` present but method-scoped (OBSERVED in source) |
| 5 | `engine/core/runtime/RuntimeRegistry.js` | 190 | `module.exports = new RuntimeRegistry()` | 5 | INFERRED: no | INFERRED: `setInterval` present but method-scoped |
| 6 | `engine/core/strategy/StrategyContract.js` | 225 | `module.exports = { StrategyContract }`; `const FORBIDDEN_PROPERTIES = new Set(...)` (immutable) | 5 | INFERRED: no | INFERRED: no |
| 7 | `engine/services/configService.js` | 198 | `module.exports = {...}`; `let cache/health/initialized/loadingPromise` | 5 | INFERRED: reads env inside `load()` (lazy) | INFERRED: no |
| 8 | `engine/services/runtimeService.js` | 276 | `module.exports = new RuntimeService()` | 5 | INFERRED: no | INFERRED: no |
| 9 | `engine/services/jobWorkerSupervisor.js` | 131 | `module.exports = new JobWorkerSupervisor()` | 4 | INFERRED: reads `process.env` inside methods | INFERRED: no — `fork()` happens in `start()`→`_spawn()` (lazy) |
| 10 | `engine/strategyLoader.js` | 621 | `module.exports = {...}`; `_metaRegistry = new Map()`, `_startInFlight = new Set()`, `let _engine/_compiler/_lifecycle` | 4 | INFERRED: `query-call` present (method-scoped) | INFERRED: `setTimeout` present (method-scoped) |
| 11 | `engine/backtestManager.js` | 913 | `module.exports = new BacktestManager()` | 3 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 12 | `engine/services/broadcaster.js` | 788 | `module.exports = new Broadcaster()`; `let lastCpuUsage/lastCpuTime/lastDbStatus`; `WS_GLOBAL_EVENT_TYPES/WS_USER_SCOPED_EVENT_TYPES/DEFAULT_CHANNELS/DEFAULT_SYMBOLS = new Set(...)` | 3 | INFERRED: `query-call` present (method-scoped) | INFERRED: no — 6 `setInterval`s start in `initServer()` (lazy, called at boot), constructor only nulls fields |
| 13 | `engine/services/connectorSettingsService.js` | 53 | `module.exports = new Shim()` | 2 | INFERRED: no | INFERRED: no |
| 14 | `engine/services/historicalCache.js` | 72 | `module.exports = new HistoricalCache()` | 2 | INFERRED: no | INFERRED: no |
| 15 | `engine/services/integrationRuntime.js` | 96 | `module.exports = {...}`; `let initialized` | 2 | INFERRED: no | INFERRED: no |
| 16 | `engine/services/jobQueue.js` | 355 | `module.exports = new JobQueue()` | 2 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 17 | `engine/core/pipeline/SignalExecutionEngine.js` | 96 | `module.exports = new SignalExecutionEngine({ concurrency: 8, maxQueue: 20000 })` | 1 | INFERRED: no | INFERRED: no |
| 18 | `engine/core/pipeline/SignalGenerationEngine.js` | 248 | `module.exports = new SignalGenerationEngine()` | 1 | INFERRED: no | INFERRED: no |
| 19 | `engine/core/pipeline/SignalProcessingEngine.js` | 70 | `module.exports = new SignalProcessingEngine()` | 1 | INFERRED: no | INFERRED: no |
| 20 | `engine/routes/backtestController.js` | 993 | `let storageInit/storageInitPromise/uploadsIndexWrite/uploadsDbInit/uploadsDbInitPromise` | 1 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 21 | `engine/routes/systemController.js` | 1006 | `let lastCpuUsage/lastCpuTime/_docsWatcherStarted` | 1 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 22 | `engine/server.js` | 174 | `module.exports = {...}`; `let runtimeConfigured/routesConfigured` | 1 | INFERRED: no | INFERRED: `listen()` present but inside `start()` (lazy) |
| 23 | `engine/services/dataCuller.js` | 382 | `module.exports = new DataCuller()` | 1 | INFERRED: `query-call` present (method-scoped) | INFERRED: `setInterval`/`setTimeout` present (method-scoped) |
| 24 | `engine/services/healthCheck.js` | 281 | `module.exports = {...}`; `let state = {...}`, `let monitorTimer` | 1 | INFERRED: reads env inside `checkDb()` etc. (lazy) | INFERRED: no — `monitorTimer` set in `start()` (lazy) |
| 25 | `engine/services/liveOrderDispatcher.js` | 114 | `module.exports = new LiveOrderDispatcher()` | 1 | INFERRED: `query-call` present (method-scoped) | INFERRED: `setInterval` present (method-scoped) |
| 26 | `engine/services/userEngineSettingsService.js` | 110 | `module.exports = new UserEngineSettingsService()` | 1 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 27 | `engine/core/EngineSettings.js` | 68 | `module.exports = new EngineSettings()` | 1 (`engine/core/engine.js:16` via `./EngineSettings`) | INFERRED: no | INFERRED: no |
| 28 | `engine/modules/strategyRuntime/index.js` | 53 | `module.exports = new StrategyRuntimeService()` | 2 (`engine/core/engine.js:25`, `index.js:36` via `@core/modules/strategyRuntime`) | INFERRED: no | INFERRED: no |
| 29 | `engine/modules/strategyRuntime/workerPool.js` | 202 | `module.exports = new StrategyWorkerPool()` | 1 (`engine/modules/strategyRuntime/index.js:3` via `./workerPool`) | INFERRED: reads env inside methods | INFERRED: no — `fork()`/`setTimeout` method-scoped (dormant, see AGENTS.md) |
| 30 | `engine/services/backtestService.js` | 51 | `module.exports = new BacktestService()` | 0 | INFERRED: `query-call` present (method-scoped) | INFERRED: no |
| 31 | `engine/signalAdapter.js` | 50 | `module.exports = new SignalAdapter()` | 0 | INFERRED: no | INFERRED: no |
| 32 | `engine/workers/jobWorker.js` | 375 | `let stopping` (module-level) | 0 require-importers; forked by `jobWorkerSupervisor.js:37` (path.resolve) | INFERRED: reads env inside handlers | INFERRED: `setInterval`/`setTimeout` method-scoped |
| 33 | `engine/workers/strategyWorker.js` | 188 | `module.exports = {...}`; `const activeStrategies = new Map()` | 0 require-importers; forked by `workerPool.js:146` (path.resolve), tested by `test/strategyWorker.warmup.test.js:18` | INFERRED: no | INFERRED: no |

## Modules whose `require` has side effects

**None observed.** Every singleton detected initializes its fields in the constructor or defers
connections/timers/queries to explicit lifecycle methods (`initServer`, `start`, `getPool`,
`load`, `_spawn`). The `setInterval`/`setTimeout`/`fork`/`connect`/`listen`/`query` calls
flagged by the scan are all method-scoped, not top-level. This is an **OBSERVED** conclusion
from reading the constructors and lifecycle methods of the top importers (postgres.js,
broadcaster.js, jobWorkerSupervisor.js, healthCheck.js, server.js).

The only top-level mutable state that is *not* inside a class is in:
- `engine/services/postgres.js:5` — `let pool = null` (OBSERVED; assigned lazily in `getPool()`)
- `engine/services/configService.js:15-26` — `let cache/health/initialized/loadingPromise` (OBSERVED; mutated by `load()`)
- `engine/services/healthCheck.js:20-28` — `let state`, `let monitorTimer` (OBSERVED; mutated by `run()`/`start()`)
- `engine/strategyLoader.js:43-48` — `_metaRegistry`, `_startInFlight`, `_engine`, `_compiler`, `_lifecycle` (OBSERVED)
- `engine/services/broadcaster.js:19-23` — `lastCpuUsage`, `lastCpuTime`, `lastDbStatus` (OBSERVED)
- `engine/routes/systemController.js:52-53,874` — `lastCpuUsage`, `lastCpuTime`, `_docsWatcherStarted` (OBSERVED)
- `engine/routes/backtestController.js:32-36` — `storageInit`, `storageInitPromise`, `uploadsIndexWrite`, `uploadsDbInit`, `uploadsDbInitPromise` (OBSERVED)
- `engine/server.js:33-34` — `runtimeConfigured`, `routesConfigured` (OBSERVED)
- `engine/workers/jobWorker.js:27` — `stopping` (OBSERVED)
- `engine/services/integrationRuntime.js:9` — `initialized` (OBSERVED)

These are module-level `let` bindings mutated by functions, but none of them execute a
connection, timer, fork, or query at require time.

## Notes for the engine design (input, not recommendations)

- The highest-fan-in singleton is `engine/services/postgres.js` (37 importers) — the DB pool
  accessor. It is the de facto shared infrastructure primitive that several packages
  (`corex-broker-contract/src/mt5Bridge.js`, `corex-accounts/src/brokerPersistenceService.js`)
  still reach into via `@core/services/postgres` / `@core/services/pgStore` (see J5/J6).
- `engine/services/broadcaster.js` (788 lines) is the second-largest coupling point and is
  held for Owen (issue #7).
- `engine/workers/strategyWorker.js` and `engine/workers/jobWorker.js` are forked child
  processes with their own module-level state (`activeStrategies` Map, `stopping` flag) —
  they are not require-time singletons in the main process.
- `engine/services/backtestService.js` and `engine/signalAdapter.js` currently have **0
  detected require-importers** (OBSERVED from the repo-wide require scan) — candidates for
  dead-code review, but this scan does not prove they are unused (dynamic requires or
  string-built specifiers would not be caught).
- `engine/workers/jobWorker.js` and `engine/workers/strategyWorker.js` have **0
  require-importers** but are consumed via `child_process.fork()` with a `path.resolve`'d
  path (not a `require`), so they are intentionally absent from the require graph.
- Importer counts were derived by scanning for `require("<specifier>")` where the specifier
  matches the module's alias form (`@core/...`), bare path form, or relative form. Counts
  for modules imported only via relative paths from sibling directories or via directory
  index specifiers (`@core/modules/strategyRuntime`) were verified by hand against grep.
