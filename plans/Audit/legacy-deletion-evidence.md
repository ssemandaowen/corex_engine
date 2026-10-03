# Legacy Deletion Evidence

**Repository:** https://github.com/ssemandaowen/corex_engine
**Purpose:** Establish, with actual import and persistence evidence, which legacy artifacts may be deleted, which require importer migration, and which require an architectural decision.
**Constraint:** This file is evidence only. No production code, shims, moves, or test changes are made by this task.

---

## 1. Verification of Old Strategy Compatibility Usage

For each referenced symbol, every occurrence in the repository is classified. Non-.js files (`.md`, `.sql`) that contain the string are noted but classified separately.

### 1.1 `utils/BaseStrategy` (absolute path)

| Line / Location | Classification | Notes |
|---|---|---|
| `test/runtimeExclusivity.test.js:5` | TEST ONLY | `const BaseStrategy = require("../utils/BaseStrategy")`; instantiates `StratA extends BaseStrategy` to verify RuntimeLifecycle rejects two runtimes on the same symbol/account/mode. Live test, part of `npm test`. |
| `test/DeclarativeStrategy.test.js:114` | TEST ONLY | Test "Old-format strategy (BaseStrategy / next) still compiles and runs unchanged" — explicitly asserts legacy `next()`-style strategies still run. Live test. |
| `utils/security.js:122` | LIVE RUNTIME (protection rule) | The security scanner's `require()` filter contains: `const isBaseStrategy = mod.toLowerCase().includes("basestrategy")` and permits such imports. This is the runtime security boundary that allows strategy source loaded from `strategies/` (or from the DB) to `require('@utils/BaseStrategy')`. |
| `scripts/bench/engine-micro-bench.js:5,35,47,86,122,167` | TEST ONLY (benchmark) | `require("@utils/BaseStrategy")`; a bench strategy `extends BaseStrategy` implementing `next()`; exercised only via `npm run bench:engine`. Benchmarks are development tools, not production runtime. |
| `utils/BaseStrategy.js` (the file itself) | LIVE RUNTIME (source) | The artifact being audited; 476 lines, not a shim. |

**OBSERVED:** `BaseStrategy` is actively exercised by 2 unit tests, 1 benchmark script, and is encoded in the runtime security scanner's allowlist. `utils/BaseStrategy.js` is a real strategy base class, not a compatibility stub.

### 1.2 `BaseStrategy` (bare symbol, any import style)

| Line / Location | Classification | Notes |
|---|---|---|
| `packages/corex-strategy-engine/src/validation/StrategyValidator.js:34,77` | LIVE RUNTIME (validation logic) | `this._extendsBaseStrategy(StrategyClass)` and its implementation — validates that a declarative strategy's prototype chain extends the legacy base class. This is current validator logic, not legacy code. |
| `test/round7.comprehensive.test.js:10 (comment), 273-275, 504-505, 558-559` | TEST ONLY | Comments referencing `BaseStrategy`; two inline `eval` test bodies instantiate `class S extends BaseStrategy` and `class MyStrat extends BaseStrategy` via `require("BaseStrategy")` (aliased to `../utils/BaseStrategy`). |
| `engine/core/runtime/RuntimeRegistry.js:19` | MIGRATION/SHIM (documentation only) | JSDoc comment `instance: object, BaseStrategy subclass instance (live)`. No executable use; the registry stores any strategy instance by runtimeId. |
| `engine/core/runtime/RuntimeLifecycle.js:34` | MIGRATION/SHIM (documentation only) | JSDoc comment `config.strategyInstance - Pre-instantiated BaseStrategy subclass`. |
| `engine/services/strategyCompiler.js:102` | MIGRATION/SHIM (documentation only) | JSDoc comment `triggers the BaseStrategy constructor`. |
| `utils/BaseStrategy.js:127-138,469-476` | LIVE RUNTIME | Class definition + prototype mixins. |
| `schema.sql:459`, `db/migrations/024_strategy_runtime_state.sql:2,15` | DEAD/UNREFERENCED (comments only) | Column COMMENT strings mention `BaseStrategy.this.state`. Comments on a JSONB column; no runtime behavior depends on the wording. |

**OBSERVED:** The only *executable* live-runtimereferences are `utils/security.js:122` (security allowlist) and `packages/corex-strategy-engine/src/validation/StrategyValidator.js:34,77` (`_extendsBaseStrategy`). The engine-side occurrences are JSDoc comments.

### 1.3 `DeclarativeStrategy`

| Line / Location | Classification | Notes |
|---|---|---|
| `test/DeclarativeStrategy.test.js:3,9,42,87` | TEST ONLY | Main test file; imports `../utils/DeclarativeStrategy`; creates `TestDeclarativeStrategy extends DeclarativeStrategy`; exercises `onBar` through the pipeline. |
| `test/DeclarativeStrategy.test.js:100-108` | TEST ONLY | Inline eval test importing `../utils/DeclarativeStrategy`. |
| `utils/DeclarativeStrategy.js` | MIGRATION/SHIM | 4-line re-export shim: `const { Strategy } = require("corex-strategy-engine"); module.exports = Strategy;`. Nothing else in the repo imports it except the test file above. |

**OBSERVED:** The only production consumer of `utils/DeclarativeStrategy.js` is the test file `test/DeclarativeStrategy.test.js`. The shim currently re-exports the new package `Strategy`.

### 1.4 `next` (legacy entrypoint method)

| Line / Location | Classification | Notes |
|---|---|---|
| `packages/corex-strategy-engine/src/validation/StrategyManifest.js:6` | LIVE RUNTIME (manifest) | `ENTRYPOINT_METHODS = ["next", "generateSignal", "onMarketData", "onTick", "onBar", "_processData"]` — the IDE/completion manifest. `next` remains in the manifest because `utils/security.js` and `utils/BaseStrategy.js` still support it. |
| `engine/services/strategyCompiler.js:38` | LIVE RUNTIME (validation) | `METHOD_CANDIDATES = ["next", "onBar", "onTick", "_processData"]` — boot-time check that a compiled strategy defines at least one of these. |
| `engine/workers/strategyWorker.js:51` | LIVE RUNTIME (worker path) | `if (typeof instance.next === "function") return instance.next(packet);` — the worker's fallback dispatch when `onBar`/`onTick` are absent. |
| `utils/BaseStrategy.js:357` | LIVE RUNTIME | `let signal = this.next(packet);` — BaseStrategy's legacy hot path. |
| `engine/core/strategy/StrategyContract.js:113` | LIVE RUNTIME | `adapt()` maps `next` → `generateSignal` for duck-typed legacy strategies. |
| `engine/core/pipeline/SignalGenerationEngine.js:173` | LIVE RUNTIME | `strategyInstance.next(packet)` — the `next`-only fallback in the engine's tick pipeline. |
| `test/round7.comprehensive.test.js:507,561` | TEST ONLY | `eval`-injected `next(bar) { ... }` bodies in security-suitability and strategy-loader tests. |
| `test/DeclarativeStrategy.test.js:119` | TEST ONLY | `next(packet)` in the old-format strategy test. |
| `scripts/bench/engine-micro-bench.js:47` | TEST ONLY | Benchmark strategy implements `next()`. |
| `package.json:94` | MIGRATION/SHIM (alias only) | Jest `moduleNameMapper` line `^@strategies/(.*)$` — alias target does not exist (see §4.6). No execution path uses it. |
| `schema.sql:459`, `migrations/024_strategy_runtime_state.sql` | DEAD/UNREFERENCED | Comment text only. |

**OBSERVED:** `next` survives as live, executed code in `utils/BaseStrategy.js`, in three engine dispatch/vanity points (`strategyWorker.js:51`, `SignalGenerationEngine.js:173`, `strategyCompiler.js:38`), in the contract's `adapt()` shim, and in the manifest. It is NOT dead.

### 1.5 `onBar` / `onTick`

| Line / Location | Classification | Notes |
|---|---|---|
| `packages/corex-strategy-engine/src/Strategy.js:257,262-265,363-366,385,389-395` | LIVE RUNTIME | The declarative engine's own `onBar`/`onTick` hook dispatch. Primary execution path for all new strategies. |
| `packages/corex-strategy-engine/src/validation/StrategyValidator.js:153,170` | LIVE RUNTIME (validation) | Error fix text and iteration over `["generateSignal", "onMarketData", "onBar", "onTick"]`. |
| `packages/corex-strategy-engine/src/validation/StrategyManifest.js:6` | LIVE RUNTIME | Manifest includes them (see `next` above). |
| `engine/core/strategy/StrategyContract.js:98,114-115` | LIVE RUNTIME | `adapt()` maps `onBar`/`onTick` → `generateSignal`. |
| `engine/workers/strategyWorker.js:45-47` | LIVE RUNTIME | Worker dispatch for `onBar`/`onTick`. |
| `engine/core/engine.js:556-559` | LIVE RUNTIME | Main event loop: `strategy.onBar(bar)` / `strategy.onTick(bar, true)`. |
| `engine/backtestManager.js:568,581` | LIVE RUNTIME | Backtest simulation loop calls `broker.onBar(bar)` and `strategy.onBar({...bar})`. |
| `engine/core/pipeline/SignalGenerationEngine.js:174-175` | LIVE RUNTIME | `onTick` fallback. |
| `broker/backtest/SignalGenerationEngine.js:28` | LIVE RUNTIME (stale duplicate path) | Calls `entry.instance.generateSignal(...)` — the 53-line stale duplicate; not imported anywhere (see §3.4). |
| `broker/base/BaseBroker.js:125-130` | LIVE RUNTIME (contract) | `BrokerContract.onBar/onTick` abstract methods. |
| `packages/corex-broker-contract/src/drivers/*` | LIVE RUNTIME | BacktestDriver, MetaApiDriver, CoreXPaperDriver implement `onBar`/`onTick`. |
| Tests (20+ matches across `test/*.test.js`, `packages/corex-strategy-engine/test/*.test.js`, `broker-contract test`) | TEST ONLY | `onBar`/`onTick` strategy hooks used in strategy tests; broker-contract contract tests assert `onBar` must be implemented / `onTick` no-op default. |
| `packages/corex-market-data/src/MarketFeed.js:176-177` | LIVE RUNTIME | `broker.onTick(tick)` — broker receives ticks from the feed. |

**OBSERVED:** `onBar`/`onTick` are core execution hooks of BOTH the legacy `BaseStrategy` and the new package `Strategy`, and are also broker-contract methods. They are definitely live, not legacy.

### 1.6 `StrategyContract`

| Line / Location | Classification | Notes |
|---|---|---|
| `packages/corex-strategy-engine/src/Strategy.js:5,516` | LIVE RUNTIME | `Strategy` imports `@core/core/strategy/StrategyContract` and calls `StrategyContract.adapt(Strategy.prototype)`. |
| `engine/core/strategy/StrategyContract.js` (whole file) | LIVE RUNTIME | The canonical contract: `validateAndAdapt`, `adapt` (incl. `next`/`onBar`/`onTick` → `generateSignal` mapping at lines 113-115 and `StrategyIntrospection` call at line 151), `validate`. |
| `engine/core/pipeline/SignalGenerationEngine.js` | LIVE RUNTIME | Uses `StrategyContract`. |
| `engine/backtestManager.js:31,144` | LIVE RUNTIME | `StrategyContract.validateAndAdapt(strategy)` at boot. |
| `engine/strategyLoader.js:32,420` | LIVE RUNTIME | `StrategyContract` import + `adapt` at startup. |
| `engine/services/strategyCompiler.js:29,124,127,203,205` | LIVE RUNTIME | Compile-time validation + adapt. |
| `utils/BaseStrategy.js:15,474` | LIVE RUNTIME | Legacy base class also calls `StrategyContract.adapt(BaseStrategy.prototype)`. |
| `utils/strategy/StrategyValidator.js:10` | MIGRATION/SHIM | JSDoc comment only; file re-exports the package validator. |
| `schema.sql:459`, `migrations/024_strategy_runtime_state.sql:2,15` | DEAD/UNREFERENCED | Comment text only. |

**OBSERVED:** `StrategyContract` lives in `engine/core/strategy/StrategyContract.js` and is imported by BOTH `packages/corex-strategy-engine/src/Strategy.js` and multiple engine files. It is the central strategy gate and is live on the hot path (compile + boot + runtime).

### 1.7 `RuleChain`

| Line / Location | Classification | Notes |
|---|---|---|
| `utils/BaseStrategy.js:24,401` | LIVE RUNTIME | Imported from `./strategy/RuleChain`; `rule()` returns `new RuleChain(this, ctx)` inside BaseStrategy. |
| `utils/strategy/RuleChain.js` | LIVE RUNTIME (owned by BaseStrategy only) | 150-line fluent DSL implementation. |
| `utils/strategy/index.js:11` | MIGRATION/SHIM | Barrel export re-exporting `RuleChain`. |
| `AGENTS.md:67`, `plans/Audit/*.md` | DEAD/UNREFERENCED | Planning/doc mentions only. |

**OBSERVED:** `RuleChain` is used **only** inside `utils/BaseStrategy.js`. No file outside `BaseStrategy` and the `utils/strategy` barrel imports it.

### 1.8 `utils/strategy/StrategyManifest`

| Line / Location | Classification | Notes |
|---|---|---|
| `utils/strategy/StrategyManifest.js` | MIGRATION/SHIM | 10-line shim re-exporting all `StrategyManifest` members from `corex-strategy-engine`; explicitly documents removal condition: "safe to delete once no module requires '@utils/strategy/StrategyManifest'". |
| `engine/routes/strategyController.js:14,87` | LIVE RUNTIME (HTTP API) | Serves `/api/strategies/manifest` — **returns this payload to the frontend Monaco editor**. Re-pointed to `require("corex-strategy-engine")` already. |
| `scripts/sync-strategy-manifest.js:9,13` | LIVE RUNTIME (script) | Manifest generator script, re-pointed to `corex-strategy-engine`. |
| `packages/corex-strategy-engine/test/ctxFlatParamsManifest.test.js:5` | TEST ONLY | Test imports from the package directly. |
| `test/DeclarativeStrategy.test.js:100` (inline) | TEST ONLY | `validateStrategyCode` — imports from `../utils/security`, not the manifest. |

**OBSERVED:** No live module imports the legacy path `@utils/strategy/StrategyManifest` anymore. The legacy shim itself states its removal condition and that condition is now met. The *functionality* (manifest payload) is LIVE in the package and consumed by the UI, but no importer remains at the old path.

### 1.9 `utils/strategy/StrategyValidator`

| Line / Location | Classification | Notes |
|---|---|---|
| `utils/strategy/StrategyValidator.js` | MIGRATION/SHIM | Re-exports `require("corex-strategy-engine").StrategyValidator`. |
| `scripts/validate-strategy.js:22,43` | LIVE RUNTIME (script) | CLI validator script. Still imports the legacy shim path. |

**OBSERVED:** One live consumer remains at the legacy path: `scripts/validate-strategy.js`. It is a development script, not production runtime.

### 1.10 `utils/strategy/IncrementalIndicators`

| Line / Location | Classification | Notes |
|---|---|---|
| `utils/strategy/IncrementalIndicators.js` | DEAD/UNREFERENCED (code) | 199-line file defining `IncrementalEMA`, `IncrementalRSI`, `IncrementalATR`. No module imports it — `IndicatorManager.js` no longer imports it (Decision 2026-09-13 §3 confirms the import was removed). |
| `test/IncrementalIndicators.test.js:4,13,35,69,88,100,120,124` | TEST ONLY | Test file importing the legacy path and testing those three classes. |
| `plans/Audit/*.md`, `plans/decisions.md`, `plans/KNOWN_ISSUES.md` | MIGRATION/SHIM (doc) | Docs record the deletion. |

**OBSERVED:** The *code* is unreachable (no imports), but a test file directly depends on the path. The *functionality* is re-implemented in `packages/corex-strategy-engine/src/indicators/ema.js`, `rsi.js`, `atr.js` as `IncrementalEMA/RSI/ATR` classes registered in `IndicatorRegistry`.

---

## 2. Saved Strategy Compatibility Investigation

### 2.1 Persistence model (OBSERVED)

Strategies are persisted as **source-code + JSONB metadata**, not as class handles:

| Location | Column / Field | Type | Depends on legacy artifact? |
|---|---|---|---|
| PostgreSQL `strategies` table (`schema.sql:2-13`, `db/migrations/003_strategy_scripts.sql`) | `script_body` | TEXT | **NO** — raw JS source string. |
| PostgreSQL `strategies` | `schema` | JSONB | **NO** — parameter schema (`static params`). |
| PostgreSQL `strategies` | `runtime_params` | JSONB | **NO** — current param values. |
| PostgreSQL `strategies` | `runtime_state_data` | JSONB (GIN-indexed, migration `024_strategy_runtime_state.sql`) | **NO** — generic key-value store restored by `instance.state.restore(stored)`. |
| PostgreSQL `strategies` | `compiled_hash`, `compiled_metadata` | TEXT / JSONB (migration `022_strategy_compile_cache.sql`) | **NO** — hash of source + metadata. |

The DB has **no column or foreign key encoding `BaseStrategy`, `DeclarativeStrategy`, `next`, `onBar`, `onTick`, `StrategyContract`, or the old manifest/validator formats**.

### 2.2 Load path (OBSERVED)

`engine/strategyLoader.js:443-452`:

```js
if (instance.state && typeof instance.state.restore === "function" && db.hasDbConfig()) {
    const { rows: stateRows } = await db.query(
        `SELECT runtime_state_data FROM strategies WHERE name = $1 LIMIT 1`, [id]);
    const stored = stateRows?.[0]?.runtime_state_data;
    if (stored && typeof stored === "object") {
        instance.state.restore(stored);
    }
}
```

- The load uses **duck typing** (`instance.state` and `instance.state.restore` — a function). It works with both `BaseStrategy` (which has `StrategyStateStore`) and `packages/corex-strategy-engine/src/Strategy` (which has `StrategyStateStore` too).
- `_attachRuntime` and `updateParams` are also duck-typed (`if (typeof strategyInstance._attachRuntime === "function")` — `engine/strategyLoader.js:170`; `engine/backtestManager.js:170`).
- **Conclusion:** persistence is format-agnostic with respect to the base class. A saved strategy's *source* is what must be loadable, and the source is stored verbatim.

### 2.3 Saved sources in Git (OBSERVED)

- **No `strategies/` directory exists** on disk (`Test-Path strategies` → false). The directory alias `@strategies` → `./strategies` in `package.json` points at a non-existent folder.
- **No seed data, fixtures, or sample JSON contain legacy strategy code.** Full-text search across all `*.json`, `*.sql`, `*.txt` in the repo (excluding `node_modules`) found zero matches for `BaseStrategy`, `DeclarativeStrategy`, `.next()`, `.onBar()`, `.onTick()`, `IncrementalIndicators`, `StrategyContract`, `RuleChain` except comment-only strings in `db/migrations/024_strategy_runtime_state.sql` (which reference `BaseStrategy.this.state` only as documentation of the JSONB column's purpose).
- `test/round7.comprehensive.test.js` builds `next()`-style strategy code **inline via `eval`** for testing the security scanner — synthetic, not persisted.

### 2.4 DB content from Git history (OPEN DECISION)

`plans/decisions.md:398-402` records an executed decision (2026-09-12 20:55):

> Queried the `strategies` table in `corex_engine` database and deleted all 7 legacy strategies that relied on the old `utils/BaseStrategy.js` path (`Demo`, `PairTrading`, `ADXFilteredTSLCoreX`, `Test`, `test_strategy`, `rapid`, `ema_crossover`), pursuant to Owen's explicit decision to execute a full cutover to `corex-strategy-engine`.

**OBSERVED:** The committed Git history records that 7 legacy `utils/BaseStrategy` strategies were deleted from the *development* `corex_engine` database as of 2026-09-12.

**OPEN DECISION — repository cannot prove absence of external persisted data.**
- This deletion is recorded only in `plans/decisions.md` and in the development database. The repository contains no migration, seed, or data file that enumerates the *current* contents of the production `strategies` table for any environment other than this development database.
- No artifact in the repo can answer: does a deployed production `strategies` table currently contain rows whose `script_body` imports `@utils/BaseStrategy`, defines `next()`, or extends a legacy base class?
- **I do not claim production data does not exist merely because it is absent from Git.** Absence of evidence in Git ≠ evidence of absence in a live database.

### 2.5 Backtest records / fixtures (OBSERVED)

- Backtest results are computed from live `script_body` + `schema` + `runtime_params` pulled from the DB at runtime (`engine/backtestManager.js`, `engine/routes/strategyController.js:111-113, 138-140`). No separate "saved backtest" payload encodes legacy strategy formats in the repo.
- `engine/routes/strategyController.js:72-73, 112-113, 139-140` returns `{ code, schema, params }` from `script_body / schema / runtime_params` — three fields, none legacy-format specific.

**Summary for §2:**
- `next`, `onBar`, `onTick` — **NO persistence dependency**. They are hook names in verbatim source; the persistence layer stores source unchanged and restores state via duck-typed `restore()`.
- `BaseStrategy`, `DeclarativeStrategy` — **NO persistence dependency**. Not stored anywhere. A saved strategy could not *reference* a base class it doesn't import at the top of `script_body`.
- Old manifest / old validator formats — **NO persistence dependency**. Never persisted; only emitted by the current `StrategyManifest.getStrategyManifestPayload()` and validated by the current `StrategyValidator`.

---

## 3. Deletion Dependency Graph

Format per artifact: **legacy item / current path / known importers / runtime consumers / test consumers / replacement / replacement path / safe to delete? / reason / remaining blocker.**

### 3.1 `broker/` (legacy tree) — root folder

- **Current path:** `broker/`
- **Known importers:** `package.json _moduleAliases` (`"@broker": "./broker"`) — alias resolution only; **zero modules** `require("@broker/...")` except `@broker/twelvedata` (live) and `@broker/modes/*` (live).
- **Runtime consumers:**
  - `@broker/twelvedata` → singleton used by `engine/core/engine.js:5`, `engine/routes/systemController.js:9`, `engine/routes/dataController.js:263`, `engine/services/marketStatus.js:3`, `engine/services/integrationRuntime.js:52`, `packages/corex-market-data/src/providers/TwelveDataProvider.js:24`. **LIVE.**
  - `@broker/modes/BacktestBroker` → `engine/backtestManager.js:26`, `test/backtestBroker.events.test.js`, `test/round7.comprehensive.test.js:21`. **LIVE.**
  - `@broker/modes/PaperBroker` → `test/paperBroker.events.test.js`, `test/brokerPersistence.integration.test.js`, `test/round7.comprehensive.test.js:107`, `scripts/reset-paper-account.js:21`, `engine/services/marketStatus.js`, test scripts. **LIVE.**
  - `@broker/modes/LiveBroker` — no runtime importers found; exported by shim only.
  - `@broker/paperStore` → `engine/routes/systemController.js:7`, `scripts/reset-paper-account.js:21`. **LIVE.**
  - `@broker/liveStore` → `engine/routes/systemController.js:8`. **LIVE.**
  - `@broker/corex-broker-contract` — Jest alias only; alias resolves to package.
- **Replacement path:** `packages/corex-broker-contract/` (the package).
- **safe to delete? NO.**
- **Reason:** The folder is a shim layer, but the *shims are the only public entry points* (`broker/modes/*`, `broker/base/*`, `broker/connectors/*`, `broker/liveStore.js`, `broker/paperStore.js`, `broker/twelvedata.js`) and those entry points are imported by live engine and test code. Deleting the folder breaks all those imports until every importer is repointed — i.e., this is a **migratable dependency**, not a deletable one.
- **Remaining blocker:** Repoint every `@broker/*` importer to `corex-broker-contract` / `corex-market-data` paths, then delete the shim folder.

### 3.2 `@broker` (legacy alias → `broker/`)

- **Current path:** alias `@broker` → `./broker` (root `package.json:40`, Jest `package.json:99`)
- **Known importers:** `engine/core/engine.js:5` (`@broker/twelvedata`), `engine/routes/systemController.js:7-9`, `engine/routes/dataController.js:263`, `engine/services/marketStatus.js:3`, `engine/services/integrationRuntime.js:52`, `packages/corex-market-data/src/providers/TwelveDataProvider.js:24`, test files.
- **Replacement path:** `packages/corex-market-data/src/legacy/twelvedata` or provider abstractions; `packages/corex-broker-contract/src/modes/*` for broker modes.
- **safe to delete? NO.**
- **Reason:** The alias is the resolution target for live imports above. Remove only after repointing every importer.
- **Remaining blocker:** Confirm intended new import target for each `@broker/twelvedata` consumer (market-data package already has `TwelveDataProvider`; engine's direct `@broker/twelvedata` consumers need a decision).

### 3.3 `@strategies` (alias → non-existent `strategies/`)

- **Current path:** alias `@strategies` → `./strategies` in `package.json:38` + Jest `package.json:94` `^@strategies/(.*)$`.
- **Known importers:** **NONE** — zero `require("@strategies` or `from "@strategies` matches found.
- **Runtime consumers:** none.
- **Test consumers:** none.
- **Replacement:** n/a — dead alias.
- **safe to delete? YES (alias only).**
- **Reason:** Alias target directory does not exist; zero importers. Deleting the two alias lines is a pure cleanup.
- **Remaining blocker:** None, provided no external user config or deployment sets an env var / module-alias entry for `@strategies`. (Recorded here as the one unverified external-configuration surface.)

### 3.4 `broker/backtest/SignalGenerationEngine.js`

- **Current path:** `broker/backtest/SignalGenerationEngine.js` (53 lines)
- **Known importers:** **NONE** — the only references in the repo are in `plans/Audit/engine-architecture-inventory.md` (my own audit note).
- **Runtime consumers:** none.
- **Test consumers:** none.
- **Replacement:** `engine/core/pipeline/SignalGenerationEngine.js` (212 lines) — the canonical pipeline engine.
- **safe to delete? YES.**
- **Reason:** Orphaned duplicate with zero importers. The active backtest path (`engine/backtestManager.js`) uses `@broker/modes/BacktestBroker` → `packages/corex-broker-contract/src/modes/BacktestBroker`, not this file.
- **Remaining blocker:** None.

### 3.5 `broker/backtest/BacktestFeed.js`

- **Current path:** `broker/backtest/BacktestFeed.js` (99 lines)
- **Known importers:** **NONE** found.
- **Runtime consumers:** none.
- **Test consumers:** none.
- **safe to delete? YES (candidate).**
- **Reason:** Orphaned backtest-simulation path. The active path is `engine/backtestManager.js` + `@broker/modes/BacktestBroker`.
- **Remaining blocker:** Verify `backtestController.js` does not reference `BacktestFeed` (search returned no matches; classification holds).

### 3.6 `BaseStrategy` (`utils/BaseStrategy.js`)

- **Current path:** `utils/BaseStrategy.js` (476 lines)
- **Known importers (runtime):**
  - `utils/security.js:122` — the security scanner's allowlist logic (LIVE, production gate on strategy source loading).
- **Known importers (tests):** `test/runtimeExclusivity.test.js:5`, `test/DeclarativeStrategy.test.js:114`, `scripts/bench/engine-micro-bench.js:5`.
- **Runtime consumers:** All legacy `next()`-style strategies compiled from `script_body` that `require('@utils/BaseStrategy')` or `require("BaseStrategy")` and `extends BaseStrategy` will execute through `utils/BaseStrategy.js` on the hot path (compile via `strategyCompiler.js`, adapt via `StrategyContract.adapt` at line 124/203/420, dispatch `next` via `strategyWorker.js:51` and `SignalGenerationEngine.js:173`).
- **Replacement:** `packages/corex-strategy-engine/src/Strategy.js`.
- **safe to delete? NO.**
- **Reason:** It is executed by live legacy-formatted strategy source. The security scanner explicitly permits `BaseStrategy` imports precisely so legacy strategies can run. Deleting it would break any persisted or deployed strategy written against the legacy API (hook name `next`, `this.entryLong`, `this.series`, `this.rule()`, `this.state`, `this.math`).
- **Remaining blocker:** **Decision required** — confirm whether external persisted `script_body` referencing `@utils/BaseStrategy` can exist. `plans/decisions.md` records deletion of 7 legacy rows from the *development* DB, but I cannot prove the *production* DB is clean (see §2.4 OPEN DECISION). If no legacy `next()`-style strategies exist anywhere, delete and update `security.js:122`, `strategyCompiler.js:38`, `strategyWorker.js:51`, `SignalGenerationEngine.js:173`, `StrategyContract.js:113`, and the `next`/legacy entries in `StrategyManifest.js`.

### 3.7 `DeclarativeStrategy` (`utils/DeclarativeStrategy.js`)

- **Current path:** `utils/DeclarativeStrategy.js` (4 lines — shim)
- **Known importers:** `test/DeclarativeStrategy.test.js:3, 100` only.
- **Runtime consumers:** none.
- **Replacement:** `packages/corex-strategy-engine/src/Strategy.js` (exported as `Strategy`).
- **safe to delete? Conditionally YES.**
- **Reason:** The shim's only consumer is its own test file. The shim already re-exports the package `Strategy`.
- **Remaining blocker:** **Importer migration** — repoint `test/DeclarativeStrategy.test.js` to `corex-strategy-engine` before deleting the shim. If the test should instead assert the new `Strategy` API, update the test content (this task does not touch tests).

### 3.8 `RuleChain` (`utils/strategy/RuleChain.js`)

- **Current path:** `utils/strategy/RuleChain.js` (150 lines)
- **Known importers:** `utils/BaseStrategy.js:24` only (plus `utils/strategy/index.js:11` barrel).
- **Runtime consumers:** only inside `BaseStrategy.rule()` at line 401.
- **Replacement:** none currently; the declarative model uses idiomatic JS. `StrategyManifest.js:145-157` documents `safeRule`/`describe`/`logDecision` helpers instead.
- **safe to delete? Conditionally YES — but BLOCKED by BaseStrategy.**
- **Reason:** Dead to the rest of the repo; sole producer is `utils/BaseStrategy.js`. Cannot delete while `BaseStrategy` exists.
- **Remaining blocker:** Deletion of `BaseStrategy` (see §3.6).

### 3.9 Old `StrategyManifest` (`utils/strategy/StrategyManifest.js`)

- **Current path:** `utils/strategy/StrategyManifest.js` (shim)
- **Known importers:** NONE (verified: zero `require("@utils/strategy/StrategyManifest")` or `require("../utils/strategy/StrategyManifest")` matches).
- **Runtime consumers:** none. The live producer is `packages/corex-strategy-engine/src/validation/StrategyManifest.js`.
- **Replacement:** `packages/corex-strategy-engine/src/validation/StrategyManifest.js`.
- **safe to delete? YES.**
- **Reason:** Its own removal-condition comment ("safe to delete once no module requires '@utils/strategy/StrategyManifest'") is satisfied. Consumers (`engine/routes/strategyController.js`, `scripts/sync-strategy-manifest.js`) already import from `corex-strategy-engine`.
- **Remaining blocker:** None.

### 3.10 Old `StrategyValidator` (`utils/strategy/StrategyValidator.js`)

- **Current path:** `utils/strategy/StrategyValidator.js` (shim)
- **Known importers:** `scripts/validate-strategy.js:22` (and `:43` via the same import).
- **Runtime consumers:** development CLI script only (`node scripts/validate-strategy.js <file>` / `--all`).
- **Replacement:** `packages/corex-strategy-engine/src/validation/StrategyValidator.js`.
- **safe to delete? Conditionally YES.**
- **Reason:** Single consumer is a non-production script.
- **Remaining blocker:** **Importer migration** — repoint `scripts/validate-strategy.js:22` to `require("corex-strategy-engine")`.

---

## 4. StrategyContract Cycle Verification

### 4.1 Actual import edges

| Edge | Source → Target | Alias resolution |
|---|---|---|
| E1 | `packages/corex-strategy-engine/src/Strategy.js:5` → `@core/core/strategy/StrategyContract` | `@core` → `./engine`; resolves to `engine/core/strategy/StrategyContract.js` |
| E2 | `engine/core/strategy/StrategyContract.js:151` → `@utils/strategy/StrategyIntrospection` | `@utils` → `./utils`; resolves to `utils/strategy/StrategyIntrospection.js` |
| E3 | `utils/strategy/StrategyIntrospection.js:2` → `../../packages/corex-strategy-engine/src/StrategyIntrospection.js` | raw relative; **direct reference to the strategy package** |

### 4.2 Cycle graph

```
packages/corex-strategy-engine/src/Strategy.js          (package)
        | E1: require("@core/core/strategy/StrategyContract")
        v
engine/core/strategy/StrategyContract.js                (engine)
        | E2: require("@utils/strategy/StrategyIntrospection")
        v
utils/strategy/StrategyIntrospection.js                 (utils shim)
        | E3: require("../../packages/corex-strategy-engine/src/StrategyIntrospection")
        v
packages/corex-strategy-engine/src/StrategyIntrospection.js   (package)  ← cycle closed
```

### 4.3 What creates the cycle

**E3 is the sole cycle creator.** `StrategyIntrospection.js` is a 23-line pure function module (`getStrategyApi`) with **no dependencies of its own**, but it is physically located in `packages/corex-strategy-engine/src/` while being imported by the engine's `StrategyContract` through the `utils/` shim. `StrategyContract` also imports nothing from the strategy package directly.

### 4.4 Who is the owner of `StrategyContract`

`StrategyContract` (validation + adaptation gate) is imported by **six engine-side consumers** (`strategyLoader.js:32`, `strategyCompiler.js:29`, `engine.js:18`, `backtestManager.js:31`, `SignalGenerationEngine.js`) and by **one package-side consumer** (`Strategy.js:5`). It is used to gate *every* strategy at compile, boot, and runtime.

### 4.5 Target ownership

**Target: `corex-strategy-engine` package.**
- The contract defines the strategy *interface* (`generateSignal`, `symbols`), which is strategy-domain, not engine-orchestration.
- Every engine consumer already treats it as a strategy artifact (compile-time validator).
- Moving it to `packages/corex-strategy-engine/src/StrategyContract.js` removes E1 (breaking the cycle at its source) and eliminates E2/E3 entirely (the engine would import `StrategyContract` the same way it imports `StrategyValidator` — already done).
- **This does not change behavior.** `@core/core/strategy/StrategyContract` would continue to resolve (via alias if needed) or all six engine importers would be repointed to the new location. The module-alias layer (`@core`) can keep pointing to the file for a transition, but the canonical location should be the strategy package.

### 4.6 Can the cycle be removed by moving the contract into `corex-strategy-engine`?

**YES.** Moving `engine/core/strategy/StrategyContract.js` → `packages/corex-strategy-engine/src/StrategyContract.js`:
1. Removes E1 (strategy package no longer imports engine).
2. Removes E2/E3 (engine no longer imports `utils/strategy/StrategyIntrospection`; `StrategyIntrospection.js` can then be moved into the package as strategy-domain utility, or left in `utils/` since it has no more engine consumers — actually it *would* remain an engine consumer until repointed, so it moves too, or the engine repoints to the package).
3. All six engine importers repoint to `corex-strategy-engine` (already a pattern the engine uses: `StrategyManifest`, `ParamSchema`).

**Remaining blocker for this move:** zero — it is a pure import relocation with no behavioral change. This is an **implementation action**, not a decision; flagged here so it is not confused with the `BaseStrategy` deletion decision.

---

## 5. Package → engine/legacy Import Violations

Scanned all `packages/*/*.js` for imports using `@core`, `@utils`, `@config`, `@events`, `@broker`, `@strategies`, `packages/` prefix, and legacy relative paths. Classification below. (Cross-package `@broker`/`@gateway` aliases defined *inside* package `package.json` are package-local and excluded as legitimate.)

| File | Import | Classification | Justification |
|---|---|---|---|
| `packages/corex-strategy-engine/src/Strategy.js:3` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Domain-neutral logger in `foundation`-equivalent (`utils/logger.js`); used by every package. |
| `packages/corex-strategy-engine/src/Strategy.js:4` | `@config/constants` | LEGITIMATE SHARED FOUNDATION | Immutable constants (MODES, PERFORMANCE, etc.) — config-layer constant. |
| `packages/corex-strategy-engine/src/Strategy.js:5` | `@core/core/strategy/StrategyContract` | **DOMAIN LEAKAGE (the cycle)** | Strategy package depends on `engine/core/strategy/StrategyContract` — the artifact under investigation (§4). |
| `packages/corex-strategy-engine/src/Strategy.js:6` | `@utils/strategy/StrategyStateStore` | **LEGACY DEPENDENCY** | Domain module living in root `utils/` while a copy exists in the package. See §5.1. |
| `packages/corex-strategy-engine/src/Strategy.js:7` | `@utils/strategy/StrategyDataManager` | **LEGACY DEPENDENCY** | Same pattern — duplicated in package. See §5.1. |
| `packages/corex-strategy-engine/src/ParamSchema.js:3` | `@utils/strategy/StrategyParamUtils` | **LEGACY DEPENDENCY** | Duplicated in package (`packages/.../src/StrategyParamUtils.js`); package code still imports the legacy copy. See §5.1. |
| `packages/corex-broker-contract/src/base/BaseBroker.js:6` | `@utils/strategy/StrategyPositionManager` | **DOMAIN LEAKAGE** | Broker-contract package depends on a **strategy-domain** module (`StrategyPositionManager`, position/lot math). This is the cleanest evidence that the broker-contract package is not yet self-contained. |
| `packages/corex-broker-contract/src/drivers/BacktestDriver.js:7` | `@utils/metrics` | LEGITIMATE SHARED FOUNDATION | `MetricsAccumulator` is domain-neutral metrics. |
| `packages/corex-broker-contract/src/drivers/MetaApiDriver.js:6` | `@utils/metrics` | LEGITIMATE SHARED FOUNDATION | Same. |
| `packages/corex-market-data/src/backtestDataResolver.js:18` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/DataProviderFactory.js:19` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/legacy/twelvedata.js:8` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/MarketFeed.js:26` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/providers/FileDataProvider.js:30` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/providers/TwelveDataProvider.js:26` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/providers/YahooFinanceProvider.js:26` | `@utils/logger` | LEGITIMATE SHARED FOUNDATION | Logger. |
| `packages/corex-market-data/src/legacy/twelvedata.js:7-9` | `@events/bus`, `@utils/logger`, `@core/services/configService` | LEGITIMATE SHARED FOUNDATION + LEGACY DEPENDENCY | `bus`/`logger` legitimate; `@core/services/configService` is an engine service injected into a provider. |
| `packages/corex-broker-contract/src/mt5Bridge.js:6` | `@core/services/postgres` | **LEGACY DEPENDENCY** | Broker package directly imports the DB service. |
| `packages/corex-accounts/src/brokerPersistenceService.js:3-5` | `@events/bus`, `@core/services/pgStore`, `@utils/logger` | LEGITIMATE + LEGACY DEPENDENCY | `pgStore` is an engine service. |
| `packages/corex-accounts/src/connectionsService.js:4-5` | `@core/services/secretsVault`, `@utils/logger` | LEGACY DEPENDENCY | `secretsVault` is an engine service. |
| `packages/corex-broker-contract/test/mt5Bridge.test.js:127` | `@core/services/postgres` | TEST ONLY | Test dependency. |
| `packages/corex-gateway/package.json` (alias `@broker`) | package-local alias | NOT A VIOLATION | Alias defined inside the package's own `package.json` for its Jest env — internal, not a cross-repo violation. |
| `packages/corex-market-data/package.json` (alias `@broker`) | package-local alias | NOT A VIOLATION | See above. |

### 5.1 Duplicated strategy-domain modules (`@utils/strategy/*` imported by the strategy package)

OBSERVED duplicates:

| Legacy path | Package copy | Consumer still pointing at legacy |
|---|---|---|
| `utils/strategy/StrategyStateStore.js` | `packages/corex-strategy-engine/src/StrategyStateStore.js` | `packages/corex-strategy-engine/src/Strategy.js:6` |
| `utils/strategy/StrategyDataManager.js` | `packages/corex-strategy-engine/src/StrategyDataManager.js` | `packages/corex-strategy-engine/src/Strategy.js:7` |
| `utils/strategy/StrategyParamUtils.js` | `packages/corex-strategy-engine/src/StrategyParamUtils.js` | `packages/corex-strategy-engine/src/ParamSchema.js:3` |

**OBSERVED:** These three files are duplicated (`plans/Audit/package-ownership.md` confirms code-identical with comments stripped). The package's own `Strategy.js` and `ParamSchema.js` still import the `@utils/strategy` copies. This is a **migration dependency in progress**, not a finished split — the package partially owns these modules but the imports are stale.

**Impact on deletion:** These are *imports*, not deletable artifacts by themselves (the `utils/strategy` copies remain needed by `BaseStrategy`). They must be repointed to the package copies (`./StrategyStateStore`, `./StrategyDataManager`, `./StrategyParamUtils`) to complete the package's self-containment, but this is independent of the `BaseStrategy` decision.

### 5.2 Summary classification

- **Legitimate shared foundation:** `@utils/logger`, `@config/constants`, `@utils/metrics`, `@events/bus` (used by broker-contract, market-data).
- **Domain leakage:** `packages/corex-strategy-engine/src/Strategy.js:5` (→ engine `StrategyContract`); `packages/corex-broker-contract/src/base/BaseBroker.js:6` (→ strategy `StrategyPositionManager`).
- **Legacy dependency:** `Strategy.js:6-7`, `ParamSchema.js:3` (→ duplicated strategy modules); `mt5Bridge.js:6`, `brokerPersistenceService.js:4`, `connectionsService.js:4`, `twelvedata.js:9` (→ engine services).
- **Unknown:** `twelvedata.js:9` (`@core/services/configService`) — an engine service used inside a market-data provider; purpose of the injection is documented in `plans/` as config resolution; not a strategy-domain violation but worth recording.

---

## 6. Files Requiring No Change (Explicitly Excluded)

- `utils/security.js:122` — leave as the legacy allowlist until `BaseStrategy` is deleted and legacy `next()` strategies are confirmed absent.
- `engine/core/strategy/StrategyContract.js` — leave (decision: move to package in a follow-up PR).
- `broker/modes/*`, `broker/base/*`, `broker/connectors/*`, `broker/liveStore.js`, `broker/paperStore.js`, `broker/twelvedata.js` — leave (shims whose targets are imported by live code).
- All `test/` files — leave (evidence shows which tests consume legacy artifacts; migration of tests is out of scope for this task).
- `utils/strategy/index.js` — leave (barrel; only referenced indirectly through the shim exports that remain live).

---

## 7. Final Report

### 7.1 Files that are safe to delete immediately

1. `broker/backtest/SignalGenerationEngine.js` — orphaned duplicate, zero importers (replacement: `engine/core/pipeline/SignalGenerationEngine.js`).
2. `broker/backtest/BacktestFeed.js` — orphaned backtest path, zero importers (replacement: `engine/backtestManager.js` + `@broker/modes/BacktestBroker`).
3. `utils/strategy/StrategyManifest.js` — shim whose removal condition is satisfied (no module requires `@utils/strategy/StrategyManifest`).
4. `package.json` alias lines for `@strategies` (`"@strategies": "./strategies"` + Jest mapper) — alias target does not exist, zero importers.
5. `utils/strategy/index.js` — **candidate only** after all its exports are confirmed unused (currently only referenced as a barrel; verify one more time before deleting).

### 7.2 Files requiring importer migration before deletion

1. `utils/strategy/StrategyValidator.js` — migrate `scripts/validate-strategy.js:22` → `require("corex-strategy-engine")`, then delete shim.
2. `utils/DeclarativeStrategy.js` — migrate `test/DeclarativeStrategy.test.js:3, 100` → `corex-strategy-engine` (or update test to target `Strategy`), then delete shim.
3. `utils/strategy/IncrementalIndicators.js` — migrate `test/IncrementalIndicators.test.js:4` → package indicators (`corex-strategy-engine` indicators), then delete file.

### 7.3 Files requiring an architectural decision

1. **`utils/BaseStrategy.js` — BLOCKED; requires explicit decision.**
   - It is LIVE runtime code (security scanner allowlist, 2 unit tests, 1 benchmark) and is the execution target for any persisted `script_body` strategy that extends it.
   - `plans/decisions.md` records 7 legacy rows deleted from the *development* DB on 2026-09-12.
   - **OPEN DECISION:** Does any production or other-environment `strategies` table contain rows whose `script_body` imports `@utils/BaseStrategy` / defines `next()`? The repository cannot prove absence of external persisted data. Deletion requires confirmation (a verified audit of the production DB, or Owen's explicit go-ahead).
2. **`utils/strategy/RuleChain.js`** — deletable only after `BaseStrategy` is gone (sole importer).
3. **`utils/strategy/StrategyParamUtils.js` / `StrategyStateStore.js` / `StrategyDataManager.js`** — duplicate strategy-domain modules that must be repointed inside the package (`Strategy.js:6-7`, `ParamSchema.js:3`) before `BaseStrategy` deletion; ownership should settle on `packages/corex-strategy-engine/`.
4. **`broker/` legacy tree** — keep shims while live imports exist (`@broker/twelvedata`, `@broker/modes/*`, `@broker/paperStore`, `@broker/liveStore`); deletion requires full repointing to `corex-broker-contract` / `corex-market-data`.
5. **`@broker/twelvedata`** — a live singleton used by engine + TwelveDataProvider; decide new import target before deleting the shim.

### 7.4 Evidence of persisted old strategy formats

- **Source-based persistence:** `strategies.script_body` stores verbatim JS; `schema`/`runtime_params`/`runtime_state_data` are JSONB; `compiled_hash`/`compiled_metadata` store hashes. **No column encodes `BaseStrategy`, `DeclarativeStrategy`, `next`, `onBar`, `onTick`, `StrategyContract`, or old manifest/validator formats.**
- **Duck-typed load:** `strategyLoader.js:443-452` restores `runtime_state_data` via `instance.state.restore` (duck-typed); `_attachRuntime` is duck-typed. The persistence layer is format-agnostic with respect to the base class.
- **No legacy code in repo fixtures:** zero `*.json`/`*.sql`/`*.txt` files outside `node_modules` contain legacy strategy code; the only match is a documentation comment on the `runtime_state_data` column.
- **Development DB:** `plans/decisions.md:398-402` records 7 legacy strategies deleted from the dev `corex_engine` DB on 2026-09-12.
- **OPEN DECISION:** Repository cannot prove absence of legacy `script_body` rows in any *production* or other-environment `strategies` table. Absence in Git is not evidence of absence in a live database.

### 7.5 Remaining blockers to deleting the legacy layer

1. **External data uncertainty** (Open Decision, §7.4) — cannot delete `BaseStrategy` / `next()` support without DB confirmation.
2. **`BaseStrategy` deletion cascade** — removing it requires updating `utils/security.js:122`, `engine/services/strategyCompiler.js:38`, `engine/workers/strategyWorker.js:51`, `engine/core/pipeline/SignalGenerationEngine.js:173`, `engine/core/strategy/StrategyContract.js:113-115`, and legacy entries in `packages/corex-strategy-engine/src/validation/StrategyManifest.js:6`.
3. **Strategy package self-containment** — repoint `Strategy.js:6-7`, `ParamSchema.js:3` from `@utils/strategy/*` to package copies.
4. **`StrategyContract` ownership** — decide the move to `corex-strategy-engine` (§4.5); resolves the cycle but is a separate change from legacy deletion.
5. **Broker package domain leakage** — `BaseBroker.js:6` imports strategy `StrategyPositionManager`; owner decision required (broker-contract vs strategy package) before finalizing either package.
6. **`twelvedata` singleton** — decide the new import target for engine consumers.

### 7.6 Can the StrategyContract cycle be removed by moving the contract into `corex-strategy-engine`?

**YES.** The cycle consists of exactly three edges: E1 (`Strategy.js` → engine `StrategyContract`), E2 (engine `StrategyContract` → `utils/strategy/StrategyIntrospection`), E3 (`StrategyIntrospection` → strategy package). Moving `engine/core/strategy/StrategyContract.js` to `packages/corex-strategy-engine/src/StrategyContract.js` and repointing its six engine consumers removes E1 at its source; then `utils/strategy/StrategyIntrospection` has no engine consumers and can move with it (or stay in `utils/` as a pure utility). Result: strategy package imports nothing from engine; `utils/strategy/` imports nothing back into the strategy package. No behavioral change — this is a pure relocation. The `next`/`onBar`/`onTick` legacy-mapping logic in `StrategyContract.adapt()` should be preserved as long as `BaseStrategy` and `next()`-style strategies remain supported.

### 7.7 Do any packages still depend on `engine/` or legacy folders?

**Yes — three confirmed violations (OBSERVED):**

1. `packages/corex-strategy-engine/src/Strategy.js:5` → `@core/core/strategy/StrategyContract` (engine) — the cycle source.
2. `packages/corex-strategy-engine/src/Strategy.js:6-7` → `@utils/strategy/StrategyStateStore`, `StrategyDataManager` (legacy strategy-domain duplicates).
3. `packages/corex-strategy-engine/src/ParamSchema.js:3` → `@utils/strategy/StrategyParamUtils` (legacy strategy-domain duplicate).
4. `packages/corex-broker-contract/src/base/BaseBroker.js:6` → `@utils/strategy/StrategyPositionManager` (strategy-domain leakage into broker package).
5. `packages/corex-market-data/src/legacy/twelvedata.js:9` → `@core/services/configService` (engine service).
6. `packages/corex-accounts/src/brokerPersistenceService.js:4` → `@core/services/pgStore`; `connectionsService.js:4` → `@core/services/secretsVault`.
7. `packages/corex-broker-contract/src/mt5Bridge.js:6` → `@core/services/postgres`.

**No package imports `broker/` directly** (all `@broker` usage resolves to `packages/...` via package-local or root aliases). **No package imports `@strategies`** (alias target does not exist).

---

**End of evidence.** Decisions recorded here are for Owen's review; no production code was modified.
