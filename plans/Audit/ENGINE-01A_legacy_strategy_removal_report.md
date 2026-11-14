# ENGINE-01A — Legacy Strategy Path Removal: Read-Only Impact Report

> Task: ENGINE-01A (decision-support only; nothing implemented)
> Date: 2026-11-14
> Author: Kilo Code
> Branch inspected: `fix/upload-multipart-transport` (working tree, includes uncommitted WIP in
> `engine/backtestManager.js`, `engine/services/userScope.js`, `engine/services/strategyCompiler.js`,
> `engine/strategyLoader.js`, `engine/workers/jobWorker.js`, `utils/security.js`)
> Scope: read-only. No source file was modified. No DB writes were performed (SELECT only).
> Decision context: CoreX goes forward-only — delete `utils/BaseStrategy.js` and the legacy
> `adapt()` logic in `engine/core/strategy/StrategyContract.js`; support only the
> DeclarativeStrategy lifecycle (`onStart` / `onBar` / `onTick` / `onFill` / `onStop`).

## Tag legend

| Tag | Meaning |
|---|---|
| **CONFIRMED** | Seen directly in source at the cited `file:line`. |
| **INFERRED** | Follows from CONFIRMED code but was not executed/observed at runtime. |
| **UNKNOWN** | Could not be determined in this read-only pass (needs runtime or credentials). |

Every table has a **proposal (not a decision)** column using KEEP / MOVE / REMOVE / MIGRATE.

---

## Q1 — Every reference to `engine/core/strategy/StrategyContract.js`

Aliases are generic, so there is no explicit alias entry for this module anywhere.

| # | Reference | Kind | Proposal |
|---|---|---|---|
| 1 | `utils/BaseStrategy.js:15` (`require("@core/core/strategy/StrategyContract")`) and `:474` (`StrategyContract.adapt(BaseStrategy.prototype)`) | static require + prototype mutation | **REMOVE** (with `BaseStrategy`) |
| 2 | `engine/strategyLoader.js:32` (require) and `:452` (`StrategyContract.adapt(instance)` after `new meta.StrategyClass()` at `:451`) | static require + per-instance adapt | **MIGRATE** (keep the call, move the module) |
| 3 | `engine/services/strategyCompiler.js:39` (require); `:265`/`:268` (`validateAndExtractClass`), `:344`/`:346` (`compile`) | static require + adapt/validate | **MIGRATE** |
| 4 | `engine/backtestManager.js:31` (require) and `:144` (`StrategyContract.validateAndAdapt(strategy)`) | static require + validateAndAdapt | **MIGRATE** |
| 5 | `packages/corex-strategy-engine/src/Strategy.js:5` (require) and `:516` (`StrategyContract.adapt(Strategy.prototype)`) | static require — **domain package → engine** inversion | **MOVE** (contract belongs with the strategy package/contract layer) |
| 6 | `engine/core/strategy/StrategyContract.js:151` — in-function `require("@utils/strategy/StrategyIntrospection")` | the only non-top-level require of a strategy module in this file | **KEEP** (moves with the contract) |
| 7 | `package.json:37` `"@core": "./engine"` | `_moduleAliases` (runtime) | **KEEP** |
| 8 | `package.json:90` `"^@core/(.*)$": "<rootDir>/engine/$1"` | jest `moduleNameMapper` | **KEEP** |
| 9 | `packages/corex-strategy-engine/package.json`, `packages/corex-broker-contract/package.json`, `packages/corex-market-data/package.json`, `packages/corex-gateway/package.json` — each maps `^@core/(.*)$` to `../../engine/$1` | package-local jest mappers | **KEEP** (needed until the contract moves) |

- **CONFIRMED** — No dynamic, computed, or string-built require of `StrategyContract` exists anywhere:
  a full-tree scan for `require(` with a non-literal argument found only user-code loading in
  `engine/services/strategyCompiler.js:54-120` (`_loadModuleFromString`), which never names the contract.
- **CONFIRMED** — `validateAndAdapt()` has exactly one production caller: `engine/backtestManager.js:144`.
  `adapt()` has five (`strategyLoader.js:452`, `strategyCompiler.js:265`, `:344`, `StrategyContract.js:90`
  (internal), `utils/BaseStrategy.js:474`, `packages/corex-strategy-engine/src/Strategy.js:516`).
- **INFERRED** — `plans/Audit/package-ownership.md:127-131` and `:208` already record this engine→package
  inversion as a known ownership defect.

---

## Q2 — Consumers of `utils/BaseStrategy.js`, and `utils/` ownership classification

### Q2a — Direct consumers of `utils/BaseStrategy.js`

| Consumer | file:line | Nature | Proposal |
|---|---|---|---|
| Strategy scaffold template | `utils/template.txt:2`, `:4` (served by `engine/routes/strategyController.js:155`) | Generates **new** strategies extending `BaseStrategy` | **MIGRATE** (must be rewritten before removal) |
| Legacy validator | `utils/strategy/StrategyValidator.js:13`, `:15`, `:39-42`, `:82-85` | `MISSING_INHERITANCE` check requires `BaseStrategy` | **REMOVE** |
| Security scanner allowance | `utils/security.js:121-132` (`mod.toLowerCase().includes("basestrategy")`) | Allows `require('BaseStrategy')` in user code | **REMOVE** (legacy-only allowance) |
| Benchmark script | `scripts/bench/engine-micro-bench.js:5`, `:35` | `class BenchStrategy extends BaseStrategy` | **MIGRATE** |
| Tests | `test/DeclarativeStrategy.test.js:113`, `test/runtimeExclusivity.test.js:5`, `test/runtime-lifecycle-provider.test.js:89`, `test/round7.comprehensive.test.js:501`, `:555`, `test/security-exact-package-allow.test.js:4` | See Q6 | **MIGRATE / REMOVE** per Q6 |
| Comment-only | `engine/strategyLoader.js` (no import), `engine/core/runtime/RuntimeRegistry.js:19`, `engine/core/runtime/RuntimeLifecycle.js:34`, `engine/services/strategyCompiler.js:243`, `db/migrations/024_strategy_runtime_state.sql:2`, `:15`, `schema.sql:459` | Documentation strings only | **KEEP** (text) / update wording |

- **CONFIRMED** — The only *runtime* importer of `utils/BaseStrategy.js` inside product code is
  `utils/template.txt` (via the create-strategy route) and `utils/strategy/StrategyValidator.js`.
  Everything else is a test, a script, or a comment.

### Q2b — `utils/` classification (ONLY-LEGACY vs SHARED)

| File | Class | Consumers (file:line) | Proposal |
|---|---|---|---|
| `utils/BaseStrategy.js` | **ONLY-LEGACY** | Q2a table | **REMOVE** |
| `utils/DeclarativeStrategy.js` | **ONLY-LEGACY (shim)** | `test/DeclarativeStrategy.test.js:1` only; body is `module.exports = require("corex-strategy-engine").Strategy` (`:3-4`) | **REMOVE** |
| `utils/analytics.js` | **SHARED** | `engine/backtestManager.js:33`, `engine/services/runtimeService.js`, `engine/verify-metrics.js` | **KEEP** |
| `utils/logger.js` | **SHARED** | ~55 modules incl. every package | **KEEP** |
| `utils/metrics.js` | **SHARED** | `packages/corex-broker-contract/src/drivers/BacktestDriver.js`, `.../MetaApiDriver.js`, `engine/verify-metrics.js` | **KEEP** |
| `utils/security.js` | **SHARED** | `engine/strategyLoader.js:26`, `:618`, `engine/services/corex-reg.js` | **KEEP** (minus legacy allowance `:121-132`) |
| `utils/stateController.js` | **SHARED** | `engine/strategyLoader.js`, `engine/core/runtime/RuntimeLifecycle.js`, `engine/core/engine.js`, `engine/core/pipeline/SignalGenerationEngine.js:6`, routes | **KEEP** |
| `utils/storageManager.js` | **SHARED** | `engine/core/engine.js`, `engine/backtestManager.js:34`, `engine/routes/backtestController.js`, `engine/services/historicalCache.js` | **KEEP** |
| `utils/linkedList.js` | **SHARED** | `utils/stateController.js` only | **KEEP** |
| `utils/strategy/index.js` | **ONLY-LEGACY (barrel)** | `utils/BaseStrategy.js:25` only (verified: no `@utils/strategy` root import exists) | **REMOVE** |
| `utils/strategy/IndicatorAdapter.js` | **ONLY-LEGACY** | `utils/BaseStrategy.js:16`, `:184` | **REMOVE** |
| `utils/strategy/RuleChain.js` | **ONLY-LEGACY** | `utils/strategy/index.js:8`; used at `utils/BaseStrategy.js:401` | **REMOVE** |
| `utils/strategy/StrategySignalUtils.js` | **ONLY-LEGACY** | `utils/strategy/index.js:6` (mixed into `BaseStrategy`) | **REMOVE** |
| `utils/strategy/StrategyDevHelpers.js` | **ONLY-LEGACY** | `utils/strategy/index.js:7`; defines `logGuard` (`:123`) used by `BaseStrategy` | **REMOVE** |
| `utils/strategy/StrategyValidator.js` | **ONLY-LEGACY** | `scripts/validate-strategy.js:22` | **REMOVE** or **MOVE** (duplicate of package validator) |
| `utils/strategy/IncrementalIndicators.js` | **ONLY-LEGACY** | `test/IncrementalIndicators.test.js:4` only (package has `src/indicators/*`) | **REMOVE** |
| `utils/strategy/StrategyRuntimeUtils.js` | **ONLY-LEGACY (shim)** | re-export of `packages/corex-strategy-engine/src/StrategyRuntimeUtils`; `Strategy.js:9` uses the package path directly | **REMOVE** |
| `utils/strategy/Position.js` | **ONLY-LEGACY (shim)** | re-export of package `Position`; only `utils/strategy/index.js:4` | **REMOVE** |
| `utils/strategy/StrategyIntrospection.js` | **SHIM, still consumed** | `engine/core/strategy/StrategyContract.js:151`, `engine/services/strategyCompiler.js:37` | **MOVE** |
| `utils/strategy/StrategyPositionManager.js` | **SHIM, still consumed** | `packages/corex-broker-contract/src/base/BaseBroker.js:6` | **MOVE** (repoint broker to package) |
| `utils/strategy/StrategyManifest.js` | **SHARED** | `engine/routes/strategyController.js:14`, `scripts/sync-strategy-manifest.js:11` | **MOVE** |
| `utils/strategy/StrategyDataManager.js` | **SHARED** | `packages/corex-strategy-engine/src/Strategy.js:7` | **MOVE** |
| `utils/strategy/SoACandleStore.js` | **SHARED** | `utils/strategy/StrategyDataManager.js:4` | **MOVE** |
| `utils/strategy/StrategyParamUtils.js` | **SHARED** | `packages/corex-strategy-engine/src/ParamSchema.js:3` | **MOVE** |
| `utils/strategy/StrategyStateStore.js` | **SHARED** | `packages/corex-strategy-engine/src/Strategy.js:6` | **MOVE** |

- **CONFIRMED** — Duplicate, dead package-local copies exist: `packages/corex-strategy-engine/src/StrategyDataManager.js:6`
  and `packages/corex-strategy-engine/src/SoACandleStore.js:3` are never imported (the live imports resolve to
  `@utils/strategy/...`), while `src/Strategy.js:7` imports the `utils` copy. `src/StrategyParamUtils.js:3` is
  likewise unused because `src/ParamSchema.js:3` imports the `utils` copy.
- **CONFIRMED** — `utils/strategy/{Position,StrategyPositionManager,StrategyRuntimeUtils,StrategyIntrospection}.js`
  are one-line re-export shims into `packages/corex-strategy-engine/src/*` (legacy path → package direction).

---

## Q3 — Call sites of legacy strategy methods, by execution path

| Method invoked | Call site (file:line) | Path | Notes | Proposal |
|---|---|---|---|---|
| `onBar(packet)` | `engine/backtestManager.js:580` (`strategy.onBar({ ...bar, symbol })`) | **backtest** (own loop, see Q11) | The only strategy call in the backtest loop | **MIGRATE** (keep `onBar`) |
| `onBar` / `onTick(bar, true)` | `engine/core/engine.js:554-558` | **boot warmup** | Prefers `onBar`, falls back to `onTick`; then sets `strategy._warmedUp = true` (`:565`) | **MIGRATE** |
| `onMarketData(packet, context)` | `packages/corex-market-data/src/MarketFeed.js:200` | **live/paper** | Wrapped in a `COREX_STRATEGY_TIMEOUT_MS` (default 2000) race (`:198-207`); crash → `onStrategyCrash` (`:211-216`) | **MIGRATE** (keep) |
| `_syncPositionSnapshot(snapshot)` | `packages/corex-market-data/src/MarketFeed.js:181-183`, `:225-228` | **live/paper** | Reads `broker.getPositionSnapshot()` | **KEEP** |
| `next(packet)` then `onTick()` (no args) | `engine/core/pipeline/SignalGenerationEngine.js:172-176` | **pipeline (stage 1)** | Only reachable via `runPipeline` → **0 callers** (Q8/Q11) | **REMOVE** with the pipeline path |
| `onMarketData` → `onBar`/`onTick` | `packages/corex-strategy-engine/src/Strategy.js:393-396` | self-dispatch | Declarative base method | **KEEP** |
| `onBar(ctx, packet)` / `onTick(ctx, packet)` | `packages/corex-strategy-engine/src/Strategy.js:363-366` | self-dispatch | Calls captured user hooks (`_userHooks`, captured at `:256-277`) | **KEEP** |
| `generateSignal(packet, ctx)` | `packages/corex-strategy-engine/src/Strategy.js:367-368`, `:398-400` | self-dispatch | Only used when no `onBar`/`onTick` user hook exists | **MIGRATE** (or KEEP as alias) |
| `generateSignal` / `onMarketData` / `onBar` / `onTick` / `next` | `engine/workers/strategyWorker.js:39-51` | **dormant worker pool** | Never invoked from any live path — see `packages/corex-strategy-engine/AGENTS.md` ("intentionally dormant") | **MIGRATE** |
| `teardown()` | **no call sites** | — | Defined at `engine/core/strategy/StrategyContract.js:55`; production termination uses `destroy()` (`engine/strategyLoader.js:103`, `engine/core/runtime/RuntimeLifecycle.js:374`, `engine/workers/strategyWorker.js:85`) | **REMOVE** (dead API) |
| `adapt(instance)` | `engine/strategyLoader.js:452`, `engine/services/strategyCompiler.js:265`, `:344`, `packages/corex-strategy-engine/src/Strategy.js:516`, `utils/BaseStrategy.js:474` | **loader/compile** | See Q7 for what `adapt` actually contributes | **MIGRATE** |
| `adapt` legacy branch (`next`/`onBar`/`onTick` → `generateSignal`) | `engine/core/strategy/StrategyContract.js:107-118` | — | `Strategy` already defines `generateSignal`/`onMarketData` (`Strategy.js:398`, `:393`), so the branch is a **no-op for declarative strategies** | **REMOVE** |
| `onMarketData` fallback alias | `engine/core/strategy/StrategyContract.js:121-125` | — | Same: `Strategy` defines it (`Strategy.js:393`) | **REMOVE** |

### Does the backtest pipeline require `generateSignal`?

- **CONFIRMED — No.** The live backtest path calls `strategy.onBar(...)` directly
  (`engine/backtestManager.js:580`). `generateSignal` is never called by the backtest loop.
- **CONFIRMED** — The *pipeline* stage-1 (`SignalGenerationEngine._callStrategy`) would require
  `next(packet)` or a zero-arg `onTick()`, **not** `generateSignal`
  (`engine/core/pipeline/SignalGenerationEngine.js:172-176`).
- **CONFIRMED** — What `DeclarativeStrategy` (= `corex-strategy-engine` `Strategy`) exposes today:
  `onBar` (`Strategy.js:389`), `onTick` (`:385`), `onMarketData` (`:393`), `generateSignal` (`:398`),
  `dataManager` (`:196`), `currentBar` (`:202`, `:340`), `candleBased` (`:150`), `tfMs` (`:157`),
  `updateParams` (`:467`), `positions`/`_posSnapshot` (`:205`, `:230`), `_syncPositionSnapshot` (`:235`),
  `resetState` (`:299`), `destroy` (`:312`), `onStart`/`onStop`/`onFill` (`:509-511`), `plotBuffer` (`:207`).
- **CONFIRMED** — It does **not** define `next`, `setPositionsSnapshot`, `applyDeferredFlip`, `isWarmedUp`,
  or `_indicatorAdapter` (full grep of `packages/corex-strategy-engine/src/Strategy.js`: no matches).
  `getStateSnapshot` and `__corexApi` are also absent and are supplied by `StrategyContract.adapt`
  (`StrategyContract.js:128-156`); `__corexApi` is consumed by `engine/routes/executionController.js:197`.

---

## Q4 — Stored strategies: `BaseStrategy` vs `DeclarativeStrategy`

Read-only query against `public.strategies` (SELECT only; no writes).

| # | `strategies.name` | Base class | Evidence | `strategies.runtime_state` | Proposal |
|---|---|---|---|---|---|
| 1 | `8bb1780d-977e-4075-8525-312035860760::demo` | **BaseStrategy** | `require('@utils/BaseStrategy')` + `class demo extends BaseStrategy` + `next(data, isWarmedUp)` in `script_body` (428 chars) | `RUNNING` | **MIGRATE** (rewrite to declarative) or delete |
| 2 | `8bb1780d-977e-4075-8525-312035860760::Rapid` | **Declarative** | `script_body` references `corex-strategy-engine` (1791 chars) | `STOPPED` | **KEEP** |

- **CONFIRMED** — Count: **2 stored strategies — 1 legacy (`BaseStrategy`), 1 declarative.** No other strategy-like
  tables hold code (`strategies`, `strategy_versions`, `strategy_signals`, `strategy_ticks`, `strategy_runtimes`
  were enumerated from `information_schema`).
- **CONFIRMED (stale state)** — `strategies.runtime_state` for `::demo` is `RUNNING`, but
  `strategy_runtimes` shows `'...::demo::BTC/USD::PAPER'` = `STOPPED` (updated 2026-11-11T20:33:34Z), and
  `'...::ema_crossover::BTC/USD::PAPER'` = `STOPPED` with **no matching row in `strategies`** (orphan runtime row).
  **INFERRED** — `strategies.runtime_state` is not the authoritative live flag; `RuntimeRegistry` /
  `strategy_runtimes.actual_state` is.
- **CONFIRMED** — `plans/decisions.md:396-402` records deletion of 7 legacy strategies (incl. `Demo`, `rapid`,
  `ema_crossover`). The `::demo` row above is a **different** row (scoped name) that survived that purge, and the
  `ema_crossover` runtime row is its orphaned leftover.
- **UNKNOWN** — Whether any runtime is executing *right now* (process state). The DB indicates all runtimes STOPPED.

---

## Q5 — `DeclarativeStrategy` location, dependents, ownership

| Item | Finding | Tag | Proposal |
|---|---|---|---|
| Location | `utils/DeclarativeStrategy.js` — 4 lines: `const { Strategy } = require("corex-strategy-engine"); module.exports = Strategy;` (`:3-4`) | **CONFIRMED** | **REMOVE** |
| Canonical implementation | `packages/corex-strategy-engine/src/Strategy.js:127` (`class Strategy`), exported at `packages/corex-strategy-engine/index.js:4`, `:22` | **CONFIRMED** | **KEEP** |
| Dependents of the shim | `test/DeclarativeStrategy.test.js:1` only (full-tree scan) | **CONFIRMED** | **MIGRATE** (repoint test to `corex-strategy-engine`) |
| Ownership match | **No.** `utils/` is restricted to domain-neutral primitives (`AGENTS.md` §3.7); a strategy base class is domain code and already lives in the owning package. The shim exists only so `@utils/DeclarativeStrategy` resolves. | **CONFIRMED** (rule) / **INFERRED** (intent) | **REMOVE** |
| Lifecycle | `onStart`/`onBar`/`onTick`/`onFill`/`onStop` are captured from subclasses at `Strategy.js:256-277` and invoked at `:354-366`, `:267-273`, `:314-320` | **CONFIRMED** | **KEEP** |
| Package coupling (defect) | `Strategy.js:3-7` imports `@utils/logger`, `@config/constants`, `@core/core/strategy/StrategyContract`, `@utils/strategy/StrategyStateStore`, `@utils/strategy/StrategyDataManager` — a package depending upward on `engine/` and `utils/` | **CONFIRMED** | **MOVE** (resolve after contract move) |

---

## Q6 — Tests referencing the legacy path

| Test / block | file:line | What it asserts | Class |
|---|---|---|---|
| "Old-format strategy (BaseStrategy / next) still compiles and runs unchanged" | `test/DeclarativeStrategy.test.js:112-126` | `BaseStrategy` + `next()` produces a long signal | **TESTS-REMOVED-BEHAVIOR** |
| Security scanner allowlist suite (fixture string `require("BaseStrategy")`) | `test/security-exact-package-allow.test.js:3-10`, `:16-47` | `corex-strategy-engine` exact import allowed; subpaths blocked; `mathjs`/`technicalindicators` allowed; others blocked | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** (fixture text must be updated; `security.js:121-132` allowance is legacy) |
| Loop-guard / eval / fs / process suite (fixture string extends `BaseStrategy`) | `test/round7.comprehensive.test.js:495-570` | Scanner blocks `while(true)`, `for(;;)`, `eval`, `require('fs')`, `process` | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** (fixture text only) |
| "BaseStrategy — runtime injection" block | `test/round7.comprehensive.test.js:273-290` (and `:10` header note) | Simulates `_attachRuntime`/`_syncPositionSnapshot`/`env`/`state` on a BaseStrategy-like object | **TESTS-REMOVED-BEHAVIOR** (behavior survives on `Strategy.js:218-239`) |
| Symbol-level runtime exclusivity | `test/runtimeExclusivity.test.js:5-13` (uses `BaseStrategy` subclasses) | One runtime per `userId::strategy::symbol::mode` | **TESTS-REMOVED-BEHAVIOR** as written; the **behavior must survive** → migrate to `Strategy` |
| Warmup recovery | `test/runtime-lifecycle-provider.test.js:89-91` (**untracked** file) | Provider-recovery warmup; currently fails (`entry.strategyInstance` vs `entry.instance`) | **TESTS-REMOVED-BEHAVIOR** as written; migrate |
| Worker warmup contract | `test/strategyWorker.warmup.test.js:63`, `:79` | Instances exposing `generateSignal()` | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** (worker contract, dormant) |
| Incremental indicators | `test/IncrementalIndicators.test.js:4`, `:13`, `:88-124` | `IncrementalEMA/RSI/ATR` from `utils/strategy` | **TESTS-REMOVED-BEHAVIOR** (module is ONLY-LEGACY) |
| SoA store + data manager | `test/SoACandleStore.test.js:3-4` | `utils/strategy/SoACandleStore` + `StrategyDataManager` | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** (modules are SHARED) |
| New-path strategy suite | `packages/corex-strategy-engine/test/Strategy.test.js:39`, `:59-190` | Declarative lifecycle, `BaseBroker.setRiskValidator` stub | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** |
| Legacy-path removal guard | `test/broker-legacy-paths-removed.test.js:7-37` | Asserts `/broker` shims + `@broker` aliases are gone | **TESTS-BEHAVIOR-THAT-MUST-SURVIVE** (pattern to copy for strategy paths) |

- **CONFIRMED** — `test/runtime-lifecycle-provider.test.js` is untracked (`git status`), i.e. not yet committed.
- **CONFIRMED** — No test imports `utils/strategy/StrategyRuntimeUtils` except `test/round7.comprehensive.test.js:370`.

---

## Q7 — `_checkPrototypePollution` / `FORBIDDEN_PROPERTIES`: enforced elsewhere?

| Mechanism | Location | Covers | Tag |
|---|---|---|---|
| Instance-level check (primary) | `engine/core/strategy/StrategyContract.js:205-222`; list at `:28-36`; called only from `validateAndAdapt` (`:84`) | Forbidden own-properties on the instance **and** forbidden keys in `instance.params` (`:213-219`) | **CONFIRMED** |
| AST source scanner | `utils/security.js:38` (`constructor`, `__proto__`, `__defineGetter__`, `__defineSetter__` in `DANGEROUS_GLOBALS`), `:234-250` (`MemberExpression` blocks `. __proto__` / `. constructor`) | Source-level access only | **CONFIRMED** |
| Package validator | `packages/corex-strategy-engine/src/validation/StrategyValidator.js` — no `__proto__` / `FORBIDDEN` / pollution logic (grep of the whole `src/validation/` dir returned only `:79` `StrategyClass.prototype instanceof Strategy`) | Static class shape only | **CONFIRMED (absent)** |
| Broker risk validator | `packages/corex-broker-contract/src/base/BaseBroker.js:114-123` | Orders, not strategy objects | **CONFIRMED (out of scope)** |

- **CONFIRMED** — The instance-level check runs on **one** path only: `backtestManager.js:144`
  (`validateAndAdapt`). `strategyLoader.js:452`, `strategyCompiler.js:265`/`:344` and `Strategy.js:516` call
  `adapt()` alone, which does **not** perform the pollution check.
- **CONFIRMED** — Consequence: if `adapt()` is deleted wholesale, the `PROTOTYPE_POLLUTION_ATTEMPT` /
  `FORBIDDEN_PARAM_KEY` guard disappears from **every** path, and the package validator does not replace it.
- **Verdict** — this is **behavior that must survive**: **MIGRATE** `_checkPrototypePollution` +
  `FORBIDDEN_PROPERTIES` into a validator used by all three call sites (loader, compiler, backtest), or into
  `packages/corex-strategy-engine/src/validation/StrategyValidator.js`.

---

## Q8 — Circular dependencies in `engine/` and `packages/`

`madge` and `dependency-cruiser` are **not installed** (`Test-Path node_modules/madge` = False,
`node_modules/.bin/depcruise.cmd` = False), and no `lint`/dep-graph script exists in `package.json:9-34`.

**Method (substitute):** a read-only resolver script (no files written to the repo) that
(1) collects `.js` files under `engine/`, `packages/`, `utils/`, `events/`, `config/`, `db/`, `scripts/` plus
`index.js`; (2) extracts every `require('...')` literal; (3) resolves relative paths, `_moduleAliases`
(`package.json:35-52`) and package names; (4) runs Tarjan SCC over the graph.

| Metric | Value | Tag |
|---|---|---|
| Files scanned | **273** | **CONFIRMED** |
| Resolved internal edges | **643** | **CONFIRMED** |
| Non-trivial cycles (SCC size > 1) | **0** | **CONFIRMED** |
| Self-requires | **0** | **CONFIRMED** |

**Circular-dependency summary: none found.** Spot-check that the resolver works: `engine/backtestManager.js` →
`engine/core/strategy/StrategyContract.js`, `config/constants.js`, `utils/storageManager.js`, etc.

- **INFERRED** — The graph is acyclic *today* mainly because the strategy layer is reached through aliases
  (`@core/...`, `@utils/...`) rather than package entry points; the package-level `AGENTS.md` boundaries
  (e.g. `packages/corex-strategy-engine/AGENTS.md`, "No broadcaster / engine coupling") are currently violated in
  one direction only: package → `engine/` (`Strategy.js:3-5`), which is a dependency inversion, not a cycle.

---

## Q9 — Backtest path: `runPipeline` → `SignalGenerationEngine._callStrategy`

### Does a backtest run end-to-end today with a `DeclarativeStrategy`?

| Step | Finding | Tag |
|---|---|---|
| Backtest entry | `engine/workers/jobs/backtestRun.js:54` → `backtestManager.run(instance, options)` | **CONFIRMED** |
| Strategy adaptation | `engine/backtestManager.js:144` `StrategyContract.validateAndAdapt(strategy)` | **CONFIRMED** |
| Bar loop | `engine/backtestManager.js:522-647` (`_runSimulation`) — **its own loop**, not `runPipeline` | **CONFIRMED** |
| Strategy invocation | `engine/backtestManager.js:580` `strategy.onBar({ ...bar, symbol })` | **CONFIRMED** |
| Broker sync / execution | `broker.onBar(bar)` (`:567`), `broker.execute(signal, bar)` (`:608`, `:622`) | **CONFIRMED** |
| Warmup before run | `engine/core/engine.js:542-565` (`strategy.onBar(bar)` / `onTick(bar, true)`) | **CONFIRMED** |

- **CONFIRMED — Yes, a backtest runs end-to-end for a declarative strategy**, because the loop calls `onBar`,
  which `Strategy` implements (`packages/corex-strategy-engine/src/Strategy.js:389` → `_processData` `:328` →
  user hook `:363-364`).
- **CONFIRMED — No, `runPipeline`/`SignalGenerationEngine` would *not* work for a declarative strategy**:
  `_callStrategy` prefers `next(packet)` (`SignalGenerationEngine.js:172-173`); `Strategy` has no `next`, so it
  falls through to `strategyInstance.onTick()` **with no packet** (`:174-175`), and `_processData` returns
  `null` for a packet-less tick (`Strategy.js:334`). Result: every signal is `null`.
  `runPipeline` itself has **0 callers** (`engine/core/pipeline/runPipeline.js:76` definition;
  `index.js:7`/`:14` re-export only), so this is latent, not active.
- **CONFIRMED** — `SignalGenerationEngine._postProcess` also calls `this.logGuard(...)` (`:235`) but the class
  defines no `logGuard` (it exists only on `BaseStrategy` via `utils/strategy/StrategyDevHelpers.js:123`,
  mixed in at `utils/BaseStrategy.js:471`). If the risk gate at `:234` ever trips, it throws `TypeError`
  instead of blocking the signal.

### Members the pipeline relies on vs what `DeclarativeStrategy` provides

| Member | Pipeline use (file:line) | `BaseStrategy` | `DeclarativeStrategy` (`Strategy`) | Tag |
|---|---|---|---|---|
| `dataManager.ingestBar` / `updateTick` | `SignalGenerationEngine.js:157-168` | yes (`utils/BaseStrategy.js:197`) | **yes** (`Strategy.js:196`, used `:339`, `:343`) | **CONFIRMED** |
| `currentBar` | `:160`, `:203` | yes (`:203`) | **yes** (`:202`, `:340`) | **CONFIRMED** |
| `candleBased` | `:165` | yes (`:142`) | **yes** (`:150`) | **CONFIRMED** |
| `tfMs` | `:162` | yes (`:149`) | **yes** (`:157`) | **CONFIRMED** |
| `updateParams` | `:120-122` | yes (via `StrategyParamUtils`, `utils/strategy/StrategyParamUtils.js:16`) | **yes** (`Strategy.js:467`) | **CONFIRMED** |
| `setPositionsSnapshot` | `:133-137` | **no** — falls back to `_posSnapshot` assignment | **no** — same fallback (`Strategy.js:235` has `_syncPositionSnapshot`, not `setPositionsSnapshot`) | **CONFIRMED** |
| `_indicatorAdapter._tickReset` | `:140-142` | yes (`utils/BaseStrategy.js:184`) | **no** (uses `_indicatorManager`, `Strategy.js:212`/`:283`) → silently skipped | **CONFIRMED** |
| `applyDeferredFlip` | `:188-190` | **no** (has `applyFlip`, `utils/BaseStrategy.js:113`) | **no** (has `applyFlip`, `Strategy.js:111`) → deferred flips unsupported | **CONFIRMED** |
| `isWarmedUp(symbol)` | `:152-154` | **no** | **no** → warmup guard skipped | **CONFIRMED** |
| `next(packet)` | `:172-173` | yes (`utils/BaseStrategy.js:390`) | **no** | **CONFIRMED** |
| `onTick()` | `:174-175` | yes (`:373`) | yes (`:385`) but requires a packet | **CONFIRMED** |

---

## Q10 — Risk hierarchy (drawdown / minBalance / daily loss)

| # | Limit | Source (file:line) | Enforced at | Reached from | Precedence | Tag |
|---|---|---|---|---|---|---|
| 1 | `riskFloor` (fraction of initial cash) | `packages/corex-broker-contract/src/base/BaseBroker.js:235-239`; config value from `broker_settings.config` (`db/migrations/008_settings_registry.sql:55-59` → `"riskFloor": 0.05` for `live`); default `0` (disabled) | `BaseBroker.handle` → `_passesRiskFloor()` (`:109-112`) | **live/paper strategy orders** (`MarketFeed.js:223` `broker.handle(signal)`) and **Socket_X** | 1st (fail-closed) | **CONFIRMED** |
| 2 | Risk validator gate | `BaseBroker.handle` `:114-123` (fails closed if unset); wired in `engine/core/engine.js:130-132` to `SignalProcessingEngine.validateForCommand` | every `handle()` | live/paper strategy orders; Socket_X | 2nd | **CONFIRMED** |
| 3 | `maxDrawdownThresholdPct = 10.0` | **hardcoded**, `engine/core/pipeline/SignalProcessingEngine.js:15`; used `:47-52` | `SignalProcessingEngine._validateRisk` | same as #2 (via `validateForCommand` `:35-42`) | 3rd (hard 10 % DD ceiling) | **CONFIRMED** |
| 4 | `maxDailyLossLimit = 2500` | **hardcoded**, `SignalProcessingEngine.js:16` | **nowhere** — no reader in the repo | — | dead config | **CONFIRMED (unused)** |
| 5 | `params.minBalance`, `params.maxDrawdownPct` (default `100`) | `SignalGenerationEngine.js:230-231` (from `RuntimeRegistry` entry params) | `_postProcess` `:234-239` | **only** `runPipeline` (0 callers) → effectively dead; would throw at `:235` if reached | would be 1st if reachable | **CONFIRMED (latent)** |
| 6 | `DEFAULT_MAX_DRAWDOWN_PCT = 10.0`, override `broker.config.maxDrawdownPct` | `packages/corex-gateway/src/socketx/RiskGateway.js:16`, `:26`, `:34-38` | `RiskGateway` pre-check | Socket_X orders only | before #1/#2 on the Socket_X path | **CONFIRMED** |
| 7 | EXIT-when-flat / ENTER-when-already-side blocks | `SignalProcessingEngine.js:54-64` | `_validateRisk` | `handle()` paths | after #3 | **CONFIRMED** |
| 8 | Backtest SL/TP/trail exits | `engine/backtestManager.js:570-576` (`_checkProtections`, defined `:648`) | backtest loop | backtest only | broker-independent | **CONFIRMED** |
| 9 | Broker margin guardrails (paper) | `packages/corex-broker-contract/src/drivers/CoreXPaperDriver.js:442-448` (`_checkEntryMargin`, `_checkMarginGuardrails`) | `execute()` | backtest + paper `execute()` calls | independent of #1-#3 | **CONFIRMED** |
| 10 | Strategy params source | `strategies.runtime_params` (DB) → `strategyLoader.js:469` (`mergedParams`) | — | all modes | lowest precedence | **CONFIRMED** |

- **CONFIRMED — precedence in practice:**
  - **Live/paper strategy orders:** `MarketFeed` → `broker.handle()` → **riskFloor (#1)** → **validator (#2)** → **10 % DD (#3)** → broker submit.
  - **Backtest:** `broker.execute()` (`BrokerContract.execute` `:132-142` → `submit`; `CoreXPaperDriver.execute` `:425-450`) **bypasses `handle()`**, so #1–#3 never run; only #8/#9 apply.
  - **Socket_X:** `RiskGateway` (#6) → `handle()` (#1–#3).
- **CONFIRMED** — The per-strategy `minBalance` / `maxDrawdownPct` knobs (#5) are **not** in effect anywhere today,
  because their only consumer is the unreachable `runPipeline` stage.
- **CONFIRMED — config source chain for `riskFloor` / `minBalance` / `maxSlippageBps` / `magic`:**
  `engine/core/runtime/RuntimeLifecycle.js:78` (`pgStore.getBrokerSettingsForUser(userId, mode)`) → `:80`
  (`brokerConfig = persisted.config || {}`) → `:89-96` (`RuntimeBrokerFactory.createBroker({ brokerConfig })`) →
  `BaseBroker.config` → `_passesRiskFloor` (`BaseBroker.js:236`). Fallback order in
  `engine/services/pgStore.js:238-247`: per-user `user_broker_settings` → global `broker_settings` (`:310`) →
  seed `db/migrations/008_settings_registry.sql:55-59`.
- **CONFIRMED — the `SignalProcessingEngine` thresholds have no configuration source at all.**
  `maxDrawdownThresholdPct` (`:15`) has exactly one reader (`:49`) and no env/DB/param override;
  `maxDailyLossLimit` (`:16`) has zero readers (full-repo grep). Changing either requires a code edit,
  i.e. it violates the "no hardcoded values that should be configurable" rule (`AGENTS.md` §6.1/§6.12).
- **UNKNOWN** — Whether `broker_settings.config` in the target environment contains a non-zero `riskFloor`
  (the seed sets `0.05` for `live`; the actual row was not read in this pass).

---

## Q11 — `engine/backtestManager.js` responsibilities

| Method | Lines | Responsibility | Tag |
|---|---|---|---|
| `constructor` | `44-51` | Singleton state (`storagePath`, metrics) | **CONFIRMED** |
| `_ensureStorageDirectory` | `52-71` | Creates report dir | **CONFIRMED** |
| `validateOptions` | `72-119` | Option/range validation incl. 5000-candle cap | **CONFIRMED** |
| `run` | `120-289` | Orchestration: resolve config → load data → build broker → `_runSimulation` → analytics → `_saveReport` | **CONFIRMED** |
| `_makeProgressEmitter` | `290-306` | SSE/progress events | **CONFIRMED** |
| `_resolveConfig` | `307-333` | Merge defaults/DB/env config | **CONFIRMED** |
| `_buildMeta` | `334-350` | Report metadata | **CONFIRMED** |
| `_loadAndNormalizeData` | `351-364` | CSV/file load entry | **CONFIRMED** |
| `_readCsvAsDataFrame` | `365-395` | CSV → data-forge frame | **CONFIRMED** |
| `_fetchFromBroker` | `396-422` | Provider fetch path | **CONFIRMED** |
| `_buildDatasetCacheKey` / `_persistFetchedDataset` | `423-474` | Dataset cache identity + persistence | **CONFIRMED** |
| `_processDataFrame` | `475-521` | Frame normalization | **CONFIRMED** |
| `_runSimulation` | `522-647` | **The simulation loop** — broker sync, protection checks, `strategy.onBar`, execution, progress, abort | **CONFIRMED** |
| `_checkProtections` | `648-720` | SL/TP/trailing-stop exits | **CONFIRMED** |
| `_normalizeSimulationSignal` | `721-820` | Signal shape normalization for the loop | **CONFIRMED** |
| `_safeReportFilename` / `getTradesCsvPath` | `821-845` | Filesystem-safe report names | **CONFIRMED** |
| `_saveReport` | `846-876` | File + CSV + DB persistence | **CONFIRMED** |
| `_saveToFile` | `877-895` | Atomic write (tmp + rename) | **CONFIRMED** |
| `_saveTradesToCsv` | `896-925` | CSV export | **CONFIRMED** |
| `_saveToDatabase` | `926-966` | Postgres insert | **CONFIRMED** |
| `_saveToFile` (second definition) | `967-974` | Plain write, no return value — **overrides `:877`** in the class body | **CONFIRMED** |

- **CONFIRMED — `backtestManager` uses its own simulation loop, not `runPipeline`.**
  `_runSimulation` (`:522-647`) calls `broker.onBar` (`:567`) and `strategy.onBar` (`:580`) directly.
- **CONFIRMED** — Defect in the current working tree (uncommitted WIP): `_saveToFile` is defined twice
  (`:877` and `:967`); the later definition wins, so `run()`'s `const savedPath = await this._saveReport(...)`
  (`:251`) receives `undefined`. This is **unrelated to the legacy strategy path** but blocks any
  "backtest verified" claim. (Flagged, not fixed — out of scope for ENGINE-01A.)
- **CONFIRMED** — `runPipeline` is exported (`engine/core/pipeline/index.js:14`) but has **no callers**;
  the three pipeline stages are otherwise reached only via `BaseBroker.handle()` (stage 2 only, see Q10).

---

## (a) Break list — what fails if the legacy path were deleted today

Ordered by severity (all CONFIRMED unless tagged).

1. **New strategy creation produces code that cannot compile.** `engine/routes/strategyController.js:155`
   serves `utils/template.txt`, whose body is `class ${name} extends BaseStrategy` (`:4`). Deleting
   `utils/BaseStrategy.js` makes every strategy created through the UI fail at
   `strategyCompiler._loadModuleFromString` (`:54-120`).
2. **The one stored legacy strategy stops compiling.** `8bb1780d-...::demo`
   (`require('@utils/BaseStrategy')`, `extends BaseStrategy`, `next()`) is still in `strategies`
   (Q4). Any reload/boot of that strategy throws `Cannot find module '@utils/BaseStrategy'`.
3. **`StrategyContract.adapt()` disappears for the new path.** `Strategy.js:516`,
   `strategyLoader.js:452`, `strategyCompiler.js:265`/`:344` all depend on it. Removing `adapt`
   wholesale also removes `getStateSnapshot` (`StrategyContract.js:128-138`) and `__corexApi`
   (`:149-156`), breaking `engine/routes/executionController.js:197` (`entry.instance.__corexApi`).
4. **Prototype-pollution guard is lost everywhere** (Q7). Only `backtestManager.js:144` runs it today;
   the package validator has no equivalent.
5. **`utils/strategy` SHARED modules are pulled down with the legacy ones** if `utils/strategy/index.js`
   and friends are deleted together: `packages/corex-strategy-engine/src/Strategy.js:6-7`,
   `packages/corex-strategy-engine/src/ParamSchema.js:3`,
   `packages/corex-broker-contract/src/base/BaseBroker.js:6`,
   `engine/core/strategy/StrategyContract.js:151`, `engine/services/strategyCompiler.js:37`,
   `engine/routes/strategyController.js:14`, `scripts/sync-strategy-manifest.js:11` all break.
6. **Test suite breaks** — `test/DeclarativeStrategy.test.js:112-126`,
   `test/runtimeExclusivity.test.js:5`, `test/runtime-lifecycle-provider.test.js:89`,
   `test/round7.comprehensive.test.js:275-290`/`:501`/`:555`,
   `test/security-exact-package-allow.test.js:4`, `test/IncrementalIndicators.test.js:4`.
7. **`scripts/bench/engine-micro-bench.js:5`** (`extends BaseStrategy`) and
   **`scripts/validate-strategy.js:22`** (legacy validator → `BaseStrategy`) stop working.
8. **Dead-but-removed APIs**: `teardown()` has no callers (safe), but `next()`/`generateSignal()` on the
   contract (`StrategyContract.js:51-53`, `:107-118`) is referenced by `engine/workers/strategyWorker.js:39-51`
   and `engine/core/pipeline/SignalGenerationEngine.js:172-176`; removing them changes those files'
   behavior (both currently dormant).
9. **Documentation/DB comments become stale** (not a runtime break):
   `schema.sql:459`, `db/migrations/024_strategy_runtime_state.sql:2`/`:15`,
   `engine/core/runtime/RuntimeRegistry.js:19`, `engine/core/runtime/RuntimeLifecycle.js:34`.

**Explicitly NOT broken** (verified): the live/paper path (`MarketFeed.js:200`), warmup
(`engine/core/engine.js:554-558`), and backtest (`backtestManager.js:580`) all call `onBar`/`onTick`/
`onMarketData`, which `Strategy` provides.

## (b) Suggested removal order (proposal, not a decision)

| Step | Action | Gate before proceeding | Proposal |
|---|---|---|---|
| 0 | Fix the duplicated `_saveToFile` (`backtestManager.js:877` vs `:967`) and re-verify backtests | backtest report path returns a real path | **MIGRATE** (separate task) |
| 1 | Rewrite `utils/template.txt` to emit a `corex-strategy-engine` `Strategy` subclass (`onBar(ctx, bar)`) | create-strategy route produces compilable code | **MIGRATE** |
| 2 | Migrate the stored `::demo` strategy (or delete the row); clean the orphan `ema_crossover` runtime row | `strategies` holds 0 `BaseStrategy` rows | **MIGRATE** |
| 3 | Move `_checkPrototypePollution` + `FORBIDDEN_PROPERTIES` into `packages/corex-strategy-engine/src/validation/StrategyValidator.js` (or a shared contract module) and call it from loader, compiler and backtest | validator unit tests pass on all three call sites | **MIGRATE** |
| 4 | Split `StrategyContract.adapt()`: keep `getStateSnapshot`, `__corexApi`, `symbol → symbols`; delete the `next`/`onBar`/`onTick` → `generateSignal` branch (`:107-118`) and the `onMarketData` alias (`:121-125`) | loader/compiler/backtest suites green; `__corexApi` still present in `executionController` payload | **MIGRATE** |
| 5 | Move the contract out of `engine/core/strategy/` into the strategy package/contract layer; repoint `Strategy.js:5`, `strategyLoader.js:32`, `strategyCompiler.js:39`, `backtestManager.js:31` | package no longer imports `@core/...`; jest mappers updated | **MOVE** |
| 6 | Repoint `BaseBroker.js:6`, `StrategyContract.js:151`, `strategyCompiler.js:37`, `strategyController.js:14`, `sync-strategy-manifest.js:11` to package entry points; delete the four `utils/strategy` shims (`Position`, `StrategyPositionManager`, `StrategyRuntimeUtils`, `StrategyIntrospection`) | package `index.js` exports the moved symbols | **MOVE** |
| 7 | Move the remaining SHARED modules (`StrategyDataManager`, `SoACandleStore`, `StrategyParamUtils`, `StrategyStateStore`, `StrategyManifest`) into the package and delete the dead package-local duplicates (`src/StrategyDataManager.js`, `src/SoACandleStore.js`, `src/StrategyParamUtils.js`) | package tests green; no `@utils/strategy/*` imports remain | **MOVE** |
| 8 | Delete `utils/BaseStrategy.js`, `utils/DeclarativeStrategy.js`, `utils/strategy/{index,IndicatorAdapter,RuleChain,StrategySignalUtils,StrategyDevHelpers,StrategyValidator,IncrementalIndicators}.js`; remove the `basestrategy` allowance in `utils/security.js:121-132` | `rg "BaseStrategy"` returns only comments/docs | **REMOVE** |
| 9 | Update/remove the tests in Q6 (migrate `runtimeExclusivity`, `runtime-lifecycle-provider`; delete the `BaseStrategy` describe in `round7`; repoint fixtures) | full suite green | **REMOVE / MIGRATE** |
| 10 | Delete the dead pipeline stage-1 legacy dispatch (`SignalGenerationEngine.js:172-176`) and either wire or delete `runPipeline` (`runPipeline.js:76`) plus `maxDailyLossLimit` (`SignalProcessingEngine.js:16`) | decision on `runPipeline` recorded in `plans/decisions.md` | **REMOVE** (after a keep/delete decision) |
| 11 | Update `schema.sql:459`, `db/migrations/024_strategy_runtime_state.sql`, `RuntimeRegistry.js:19`, `RuntimeLifecycle.js:34` comments | docs only | **MIGRATE** |

---

## Method, limitations, and verification status

| Item | Status | Tag |
|---|---|---|
| Only one file created in the repo (`plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`) | `git status` shows exactly this new file plus pre-existing user changes | **CONFIRMED** |
| DB access | Read-only `SELECT` via `pg` using `.env` credentials; no writes | **CONFIRMED** |
| `madge` / `dependency-cruiser` | Not installed; custom resolver used (Q8) | **CONFIRMED** |
| Runtime behavior (live/paper/backtest execution) | Not executed — no broker credentials, no live feed | **UNKNOWN** |
| Whether a runtime is executing right now | DB shows `STOPPED` for both runtimes; process state unknown | **UNKNOWN** |
| `broker_settings.config.riskFloor` in the target environment | Not read | **UNKNOWN** |
| Uncommitted WIP in `engine/backtestManager.js`, `engine/services/userScope.js`, `engine/services/strategyCompiler.js`, `engine/strategyLoader.js`, `engine/workers/jobWorker.js`, `utils/security.js` | Findings describe the **working tree**, not `origin/main` | **CONFIRMED** |