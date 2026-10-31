# Backtest Path Audit (read-only)

## Part A — Claim verification

### 1. `run` vs `runBacktest`
- `engine/workers/jobs/backtestRun.js:54` calls `backtestManager.run(instance, options)`.
- `engine/services/backtestService.js:14` calls `backtestManager.runBacktest(options)`.
- `engine/backtestManager.js` defines `async run(strategy, options = {})` at line 120. There is **no** `runBacktest` method in that file (grep for `runBacktest` in `engine/backtestManager.js` returns zero matches).
- Result: **PARTIAL** — `run` exists and is the only one the worker reaches; `runBacktest` does not exist, so `BacktestService.runBacktest` would throw `TypeError: backtestManager.runBacktest is not a function`. The HTTP route `POST /api/backtest/:id` (`engine/routes/backtestController.js:641`) enqueues a `backtest.run` job (`:847`), so it reaches `run`, not `runBacktest`. No HTTP route reaches `runBacktest` in this codebase (grep shows only `backtestService.js:14` and its caller references).

### 2. CSV parsing in FileDataProvider
`packages/corex-market-data/src/providers/FileDataProvider.js:43-56`:
```js
function parseCsv(content) {
    const lines = content.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(",");
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] ? values[j].trim() : "";
        }
        rows.push(row);
    }
    return rows;
}
```
CONFIRMED — naive `split(",")`, no quote handling, no escaped quotes, no embedded newlines.

### 3. Imports in packages/corex-market-data pointing at broker/legacy aliases
- `src/providers/FileDataProvider.js:22`: `const SymbolNormalizer = require("../../../corex-broker-contract/src/utils/SymbolNormalizer");` (relative into broker package)
- `src/providers/TwelveDataProvider.js:24`: `const twelvedata = require("@broker/twelvedata");`
- `src/legacy/twelvedata.js:8`: `const logger = require("@utils/logger");`
- `src/legacy/twelvedata.js:9`: `const configService = require("@core/services/configService");`
- `src/MarketFeed.js:26`: `const logger = require("@utils/logger");`
- `src/providers/YahooFinanceProvider.js:26`: `const logger = require("@utils/logger");`
- `src/backtestDataResolver.js:18`: `const logger = require("@utils/logger").createModuleLogger(...);`
- `src/DataProviderFactory.js:19`: `const logger = require("@utils/logger");`
- `src/providers/FileDataProvider.js:30`: `const logger = require("@utils/logger");`

### 4. Aliases still used in engine/backtestManager.js
- `@utils/logger` (line 24) → `./utils/logger`
- `@data/src/DataProviderFactory` (line 25) → `./packages/corex-market-data/src/DataProviderFactory`
- `@broker/modes/BacktestBroker` (line 26) → `./broker/modes/BacktestBroker` (shim → packages/.../src/modes/BacktestBroker → src/drivers/BacktestDriver)
- `@core/core/backtestDataResolver` (line 27) → `./engine/core/backtestDataResolver` (shim → packages/.../src/backtestDataResolver)
- `@core/services/postgres` (line 28) → `./engine/services/postgres`
- `@core/services/pgStore` (line 29) → `./engine/services/pgStore`
- `@utils/storageManager` (line 30) → `./utils/storageManager`
- `@core/core/strategy/StrategyContract` (line 31) → `./engine/core/strategy/StrategyContract`
- `@config/constants` (line 32) → `./config/constants`
- `@core/services/userScope` (line 33) → `./engine/services/userScope`
- `@utils/analytics` (line 34) → `./utils/analytics`
- `@events/bus` (line 35) → `./events/bus`

### 5. Wrapper check
`engine/core/backtestDataResolver.js` (3 lines) is only `module.exports = require("../../packages/corex-market-data/src/backtestDataResolver");` — pure shim. Consumers: `engine/backtestManager.js:27` (via `@core/core/backtestDataResolver`) and `engine/routes/backtestController.js:13` (via `@core/core/backtestDataResolver`). The package path is also consumed directly by `packages/corex-market-data/index.js:20` and `packages/corex-market-data/test/backtestDataResolver.test.js:3`. So both old and new paths are in use.

### 6. Abort handling
- Worker passes `shouldAbort: () => ctx.isAbortRequested()` at `backtestRun.js:51`.
- In `backtestManager.js`, `shouldAbort` is read at line 127 and invoked only inside `abortIfRequested()` (line 133). `abortIfRequested()` is called at discrete points: after compile (line 150), after data load (line 217), before simulation (line 225), inside `_runSimulation` only every `BATCH_SIZE` bars (line 560, default 500), before analytics (line 235 implicit via `_computeAnalytics` at 756), before save (lines 244, 250). It is **not** checked per bar.
- There is no timeout that terminates the work itself; the only "budget" is `BAR_BUDGET_MS` (line 533, default 100ms) which only throws `STRATEGY_QUOTA_EXCEEDED` after 5 consecutive slow bars (line 586). Cancellation relies on the worker/job-queue abort flag.

## Part B — End-to-end trace (upload → saved report)

Route entry: `POST /api/backtest/:id` in `engine/routes/backtestController.js:641`.

1. `backtestController.js:641` `router.post("/:id", upload.single("dataset"), ...)` — receives HTTP request with strategy id + optional CSV + params. Returns 202 with `jobId`.
2. `loader.get(scopedStrategyId)` (`:647`) / DB fallback (`:651`).
3. If CSV uploaded: `buildUploadRecord` (`:680`, defined `:304`) hashes file, dedups, scans bar range, stores meta in PG/filesystem. `resolvedFile = { path: symbolPath|dedupPath }` (`:798`/`:800`).
4. `jobQueue.enqueue({ type: "backtest.run", ... })` (`:847`).
5. Worker `backtestRun.js:10` `run(job, ctx)` — loads strategy row from DB, compiles via `loaderFacade.instantiateFromSource` (`:36`), sets params, calls `backtestManager.run(instance, options)` (`:54`).
6. `backtestManager.js:120` `run(strategy, options)`:
   - `validateOptions` (`:72`)
   - `StrategyContract.validateAndAdapt` (`:144`)
   - `new BacktestBroker(...)` (`:156`) → shim → `packages/.../src/drivers/BacktestDriver` (uses `SharedFillSim`)
   - `_loadAndNormalizeData` (`:214`):
     - offline: `_readCsvAsDataFrame` (`:355`) → `dataForge.fromCSV` (CSV parsed by data-forge, not FileDataProvider)
     - online: `_fetchFromBroker` (`:397`) → `fetchGuardedHistory(DataProviderFactory, ...)` (TwelveData provider)
   - `_processDataFrame` (`:476`) normalizes columns, filters `close > 0`, sorts by time, applies range.
   - `_runSimulation` (`:523`) loops bars, calls `strategy.onBar`, executes via broker.
   - `_computeAnalytics` (`:751`) → `format.buildReport` (`@utils/analytics`).
   - `_saveReport` (`:815`):
     - `_saveToFile` (`:901`) writes `data/backtests/<id>.json`
     - `_saveTradesToCsv` (`:831`)
     - `_saveToDatabase` (`:860`) upserts `backtests` table.

Data provider used for uploaded file: **data-forge's `fromCSV`** (not FileDataProvider). FileDataProvider (`packages/corex-market-data/src/providers/FileDataProvider.js`) is NOT on this path.

Mock/synthetic data: none in the traced live path; but `_computeAnalytics` passes `commissionPercent: 0, slippageBps: 0` to `format.buildReport` (`:775-776`) even though broker was configured with realism — analytics layer is told zero costs (inconsistency). Also `initialCapital` fallback `|| 10000` (`_resolveConfig:317`) and `_resolveConfig` does not carry `commissionPct/slippageBps/spread` (they're read from `config` directly in `run` via `config.commissionPct`, but `_resolveConfig` omits them — however `run` reads `config` returned by `_resolveConfig` which lacks them → `undefined ?? 0` → 0). So configured realism is silently dropped. [See Top 5.]

Silent fallbacks:
- `backtestController.js:912-934`: DB read fails → falls back to filesystem report.
- `backtestController.js:799-806`: symbol path missing → dedup path fallback with self-heal copy.
- `backtestManager._saveToDatabase:896-898`: DB save failure swallowed (warn only).
- `backtestManager._saveToFile:905-907`: file save failure swallowed.
- `backtestManager._readCsvAsDataFrame:383-386`: stat errors other than ENOENT rethrown only if not "too large".
- `backtestController` `getDefaultBacktestSettings:277-284`: PG failure returns defaults.
- `migrateLegacyUploadsIndexToDb:198-201`: missing table returns false (silent fallback to file index).
- Dynamic require: `backtestRun.js:11` and `:35` require modules inside run(); `backtestManager` requires via aliases.

Files in chain NOT used by any route/job: `packages/corex-market-data/src/providers/FileDataProvider.js` is not on the backtest path (used elsewhere for paper replay, UNCONFIRMED by routes in this audit). `engine/services/backtestService.js` is not imported by `backtestController.js` (grep: no require of backtestService in controller) — UNCONFIRMED whether any route uses it; appears orphaned for backtest runs.

## Part C — Dead-code candidates

- `engine/services/backtestService.js` (`runBacktest`): DEAD for HTTP backtest run path (controller enqueues job directly). Referenced only internally; no route imports it in controller. Mark UNSURE whether other callers exist outside scanned files.
- `engine/backtestManager.js` `runBacktest`: DEAD (method doesn't exist).
- `packages/corex-market-data/src/providers/FileDataProvider.js` `parseCsv`: DEAD on backtest path; LIVE elsewhere (paper replay) — UNSURE scope.
- `engine/core/backtestDataResolver.js`: LIVE (shim, 2 consumers) but transitional.

## Part D — Simulator correctness

- Lookahead: signal generated on bar N is executed on the same bar N via `broker.execute(signal, bar)` at `backtestManager.js:609` (ENTER) and `:623` (EXIT), using `bar.close` as ref price in `SharedFillSim.fillMarketOrder` (`:47`). So a signal on bar N fills at bar N's close → **lookahead possible** (strategy sees full bar including close, then fills at close). CONFIRMED.
- Spread/slippage/commission: defined in `SharedFillSim.js` (calculateCommission `:12`, calculateSlippage `:17`, calculateSpread `:28`, applySpreadToPrice `:33`) and applied in `fillMarketOrder` (`:48`, `:58`, `:59`, `:62`). BUT `backtestManager._computeAnalytics` passes `commissionPercent: 0, slippageBps: 0` (`:775-776`), and `_resolveConfig` does not propagate `commissionPct/slippageBps/spread` (config in `run` reads `config.commissionPct` which is `undefined` → 0). So configured values never reach the broker. CONFIRMED as applied in code but effectively dead at runtime.
- Bar validation: `_processDataFrame` (`backtestManager.js:476`) only filters `Number.isFinite(b.time) && b.close > 0` and sorts by time. No high>=low, no duplicate-timestamp, no sortedness enforcement beyond sort, no NaN guards on OHLC. CONFIRMED: not validated.

## Step 0 — UNSURE resolutions

- `engine/services/backtestService.js`: zero importers in the codebase (grep for `backtestService` returns only self, audit docs, and plans). Status: DEAD for backtest runs; any future caller of `runBacktest` crashes because `backtestManager.runBacktest` does not exist.
- `FileDataProvider`: used outside the market-data package by `packages/corex-broker-contract/src/drivers/CoreXPaperDriver.js:209` (`require("@data/providers/FileDataProvider")`) for paper-mode file replay. So `parseCsv` is LIVE for paper replay, not dead — but the naive CSV parsing (no quotes/newlines) still applies there.

## Top 5 problems, ranked by risk

1. Realism config (commission/slippage/spread) silently dropped — `_resolveConfig` omits these fields and analytics passes zeros; reported P&L is gross, overstating performance. (engine/backtestManager.js:308-328, 775-776)
2. Lookahead bias: strategy.onBar receives the full bar (including close) and the broker fills at the same bar's close (backtestManager.js:581, 609; SharedFillSim.js:47).
3. No bar validation (high>=low, duplicates, NaN) before simulation (backtestManager.js:476-515).
4. Abort only polled every 500 bars (backtestManager.js:557-565) — runaway/cancelled jobs can run long; no hard timeout.
5. `BacktestService.runBacktest` references a non-existent `backtestManager.runBacktest` method (engine/services/backtestService.js:14) — any caller crashes. (UNSURE if called anywhere.)
