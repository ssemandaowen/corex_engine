# ENGINE-01 — P0 Baseline

> Task: ENGINE-01 P0 baseline (controlled baseline operation)
> Date: 2026-11-14
> Author: Kilo Code
> Scope: branch isolation, WIP inventory, the confirmed `_saveToFile` defect,
> and characterization tests for backtest persistence, live/paper market-data
> delivery, and engine warmup. No architecture changes.

---

## 1. Branch and base commit

| Item | Value |
|---|---|
| Branch | `engine-01/p0-baseline` |
| Based on | `origin/main` @ `36316b1325f82cd6efb7b200a0490434b58e700e` ("refactor(broker): retire legacy broker shims and route consumers through package APIs (#61)") |
| Pre-existing branch check | `git branch -a --list "*engine-01*"` → empty; `git ls-remote origin "refs/heads/engine-01/*"` → empty. Branch created new, nothing overwritten. |
| Worktree | `C:\Users\SBUM\Desktop\corex-engine-01-p0-baseline` (separate worktree; the Stage 1 checkout at `C:\Users\SBUM\Desktop\corex` was not touched) |
| `node_modules` | Directory junction to the main checkout's `node_modules` (gitignored; no install performed) |
| Stage 1 branch | `fix/upload-multipart-transport` @ `7401e35` — untouched, still checked out in the main working directory with its WIP intact |

The branch was created with `git worktree add -b engine-01/p0-baseline <path> origin/main`
so that the Stage 1 working tree (9 modified files + 8 untracked paths, uncommitted)
could not be disturbed.

## 2. Current commit SHA

| Commit | SHA | Content |
|---|---|---|
| Base (`origin/main`) | `36316b1325f82cd6efb7b200a0490434b58e700e` | upstream baseline |
| P0 code + tests | `e04b579` | `fix(backtest): return the real report path and surface write failures` — `_saveToFile` fix + 3 characterization suites |
| P0 baseline record | (this commit) | this file |

## 3. Runtime and package-manager versions

| Tool | Version |
|---|---|
| Node.js | v22.20.0 |
| npm | 10.9.3 |
| OS | Windows (win32), PowerShell 5.1 |
| Jest | 29.7.0 (repo devDependency) |

## 4. WIP inventory (report only — nothing copied, reconciled, or discarded)

Measured against `origin/main` from the Stage 1 checkout.

| Path | Differs from `origin/main`? | Tracked? | Change appears related to |
|---|---|---|---|
| `engine/backtestManager.js` | Yes — 140 lines changed | tracked (modified) | **Convergent P0 work + Stage 1**: adds `safeFilename`/`_safeReportFilename`, atomic tmp+rename write, `BACKTEST_PERSISTENCE_FAILED`, `savedPath` from `_saveToFile`. Contains the **duplicate `_saveToFile`** (old + new definitions) that the ENGINE-01A audit reported. |
| `engine/strategyLoader.js` | Yes — 53 lines changed | tracked (modified) | **Other task**: boot-time runtime restore reconciliation — drops stale `strategy_runtimes` rows whose strategy no longer exists, marks them `STOPPED`, restores runtimes in parallel. |
| `engine/services/strategyCompiler.js` | Yes — 147 lines added | tracked (modified) | **Other task**: `_loadModuleFromString` hardening — resolves `_moduleAliases` from `package.json` and `node_modules` for DB-loaded strategy code (alias/`corex-strategy-engine` resolution). |
| `engine/services/userScope.js` | Yes — 36 lines added | tracked (modified) | **Stage 1 (uploads/report retrieval)**: new `safeFilename(id)` helper for filesystem-safe report stems (`:` `/` `\` `?` `*` `"` `<` `>` `|`). |
| `engine/workers/jobWorker.js` | Yes — 30 lines added | tracked (modified) | **Stage 1 adjacent**: new `isNonRetryableError(msg)` classification (upload-file-missing, compile/security failures) used to stop retrying deterministic failures. |
| `utils/security.js` | Yes — 11 lines changed | tracked (modified) | **Other task**: allow exact `corex-strategy-engine` import; restrict subpaths to `mathjs`/`technicalindicators`; keeps the `basestrategy` allowance. |
| `test/runtime-lifecycle-provider.test.js` | Yes — untracked | **untracked** | **Other task** (runtime lifecycle): 8 tests for PAPER/LIVE/BACKTEST cold start, provider-warmup recovery, `reattemptWarmup`. Per the ENGINE-01A audit it fails against current `RuntimeLifecycle` (`entry.strategyInstance` vs `entry.instance`); not run or modified in P0. |

Additional uncommitted paths present in the Stage 1 checkout but outside the audit's
inventory (also untouched): `engine/core/runtime/RuntimeLifecycle.js`,
`engine/core/runtime/RuntimeRegistry.js`, `engine/routes/backtestController.js`,
`front_end/package-lock.json`, plus untracked `data/uploads/`, `engine/core/repomix.xml`,
`repomix.xml`, `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`,
`plans/architecture/QUALITY_BASELINE.md`, `test/job-worker-non-retryable.test.js`,
`test/security-exact-package-allow.test.js`, `test/strategy-compiler-backtest-regression.test.js`,
`test/strategy-loader-stale-reconciliation.test.js`.

**Convergence note:** the uncommitted `engine/backtestManager.js` WIP already contains a fix
for the same persistence defect (sanitized name + atomic write + explicit error code), and the
uncommitted `userScope.safeFilename()` is the intended shared helper. P0 deliberately does
**not** import or copy that WIP (it is not on `origin/main`); the P0 fix is an independent,
minimal variant. Consolidating the two is a follow-up task, not P0 work.

## 5. Exact test commands

Working directory: `C:\Users\SBUM\Desktop\corex-engine-01-p0-baseline`

```bash
# Targeted P0 suites
node node_modules/jest/bin/jest.js --runInBand --forceExit \
  test/backtest-report-path.test.js \
  test/marketfeed-dispatch-timeout.test.js \
  test/engine-warmup-dispatch.test.js

# Documented full-suite command (package.json "test": "jest --passWithNoTests")
npm test
```

`--forceExit` is used on the targeted runs because `engine/core/engine.js` (required by the
warmup suite) leaves open handles after the tests complete; without it Jest does not exit.
The documented `npm test` run below did not need it.

## 6. Actual test results

| Command | Suites | Tests | Passed | Failed | Skipped | Time |
|---|---|---|---|---|---|---|
| `node node_modules/jest/bin/jest.js --runInBand --forceExit <3 P0 suites>` | 3 | 23 | 23 | 0 | 0 | 17.483 s |
| `node ... <3 P0 suites>` (re-run at finalize) | 3 | 23 | 23 | 0 | 0 | 18.686 s |
| `npm test` (full suite, run 1) | 59 | 626 | 625 | 1 | 0 | 60.081 s |
| `npm test` (full suite, run 2) | 59 | 626 | 626 | 0 | 0 | 60.640 s |
| `npm test` (full suite, run 3 — at finalize) | 59 | 626 | 626 | 0 | 0 | 69.801 s |

Derived (subtraction, not measured separately): the full suite without the three P0 suites is
**56 suites / 603 tests**.

The single failure in run 1 was `test/IncrementalIndicators.test.js`, whose timing-sensitive
benchmark assertions (test/IncrementalIndicators.test.js:109-110) fail under parallel workers.
It passes in isolation (`--runInBand`: 5/5) and passed on runs 2 and 3, so it is a **pre-existing
intermittent (timing) failure, not a P0 regression** — no P0 file is imported by it. Runs 2 and 3
are green; the recorded baseline is **59 suites / 626 tests**.
No suite was skipped and no test was marked `.skip`.

Environment limitations that shape these numbers:

- The worktree has no `.env`, so `postgres.hasDbConfig()` is false in tests; the backtest
  characterization stubs `hasDbConfig`/`query` so no DB row is written (P0 performs no DB writes).
- `TWELVE_DATA_KEY` is absent, so the live market socket is not started
  ("Broker running without live market socket").
- All market data in the new suites is **synthetic** (generated OHLCV, no provider, no network).
  This is unit-level evidence, not real-market verification.

## 7. P0 changes

### 7.1 `engine/backtestManager.js` (only production file changed)

Investigation answers (all on `origin/main`, not on the WIP):

| Question | Answer |
|---|---|
| Do two `_saveToFile` definitions exist on `origin/main`? | **No.** Exactly one (line 901 before the change). The duplicate exists only in the uncommitted Stage 1 WIP. |
| Which definition is effective? | The single definition — a plain `fsp.writeFile` that returns `undefined` and swallows errors with `logger.warn`. |
| Is atomic-write behavior present? | **No.** No temp file, no rename, no fsync. |
| Which callers depend on the return value? | On `main`, none: `_saveReport` ignored the return and `run()` recomputed the path from `meta.id`. |
| Why was `savedPath` reported as `undefined`? | In the WIP, `run()` assigns `const reportPath = await this._saveToFile(report)` while the new `_saveToFile` returns nothing. On `main` `savedPath` is not `undefined` — it is *recomputed*, which is the actual defect (see next row). |
| Is report / trade persistence affected? | **Yes, both.** Any `runtimeId` containing `/` (i.e. every symbol like `BTC/USD`) produced the path `.../BTC/USD::BACKTEST.json`; `writeFile` failed with `ENOENT` and the failure was swallowed, so `REPORT_SAVED` advertised a file that did not exist. The trades CSV had the same defect. |

Changes (2 code sites):

| Site | Change |
|---|---|
| `_saveToFile(report)` | Writes the raw file name (report id + `.json`) under `storagePath`, returns the absolute path it wrote, and **propagates** write failures instead of swallowing them. |
| `_saveReport(report, fullTrades)` | Returns the path resolved by `_saveToFile` so callers cannot recompute a different one. |
| `run()` | `const savedPath = await this._saveReport(report, fullTrades);` (was: ignore result + `path.join(this.storagePath, ...)`). |
| `_saveTradesToCsv`, `getTradesCsvPath` | **Unchanged.** Still derive raw `${id}.trades.csv` names and still swallow write failures. |

File naming is deliberately **out of scope** for P0. `engine/routes/backtestController.js` reads
and deletes report files using the raw id (`${scopedReportId}.json`, `${reportId}.json`), so any
name rewriting done here would produce files the API can neither find nor delete. A shared
`safeFilename` helper in `engine/services/userScope.js`, applied by writer **and** readers, is
Stage 1 work.

Behavior change (intentional, documented): a failed report write now fails the backtest run
instead of emitting `REPORT_SAVED` for a non-existent file.

### 7.2 Tests added (3 files, 23 tests)

| File | Tests | Covers |
|---|---|---|
| `test/backtest-report-path.test.js` | 5 | Test A — representative offline backtest executes; `REPORT_SAVED.reportPath` exists and parses; `_saveToFile` returns the written path; write failure propagates; report structure (`meta`/`performance`/`trades`). |
| `test/marketfeed-dispatch-timeout.test.js` | 9 | Test B — live/paper dispatch: invocation, signal → `broker.handle`, no-intent result, position-snapshot push, timeout outcome, no cancellation, overlap, late rejection, unknown runtime. |
| `test/engine-warmup-dispatch.test.js` | 9 | Test C — warmup dispatch: onBar preference, `onTick(bar, true)` fallback, neither-hook, throwing bar, insufficient data, async-not-awaited, remote `warmupBar` path, remote failure, invalid timeframe. |

Test C mocks only I/O collaborators of `engine/core/engine.js` (providers, gateway, auth,
broker contract, strategy runtime, lifecycle); the `warmupStrategy` body and its helpers
(`_normalizeCachedBars`, `_normalizeTimeframe`, `_timeframeToMs`, `_mergeBarsByTime`,
`_readWarmupCacheAsync`, `_writeWarmupCacheAsync`) are the real implementations.

## 8. Characterization findings (observed, not changed)

### Test A — backtest persistence

| # | Finding | Tag |
|---|---|---|
| A1 | A representative offline backtest runs end-to-end (120 synthetic 1m bars → 11 trades) and returns a report. | CONFIRMED |
| A2 | `REPORT_SAVED.reportPath` is absolute, exists, and parses to the report structure. | CONFIRMED |
| A3 | Ids containing `:` or `/` produce file names that are **unwritable** (`/` becomes a non-existent directory segment → ENOENT; `:` is illegal on Windows) or **mismatched with the readers**: `backtestController` looks up and unlinks `${scopedReportId}.json` / `${reportId}.json`. Deferred to Stage 1's shared `safeFilename` helper in `userScope` (writer **and** readers). Not exercised here: the suite uses a filename-safe id. | INFERRED (the real API `runtimeId` is scoped `userId::jobId`, so it always contains `:`; no live API run was performed) |
| A4 | Trades-CSV failures are still swallowed (`logger.warn` at `_saveTradesToCsv`); only the report path is now authoritative. | CONFIRMED |
| A5 | `_saveToDatabase` throws `BACKTEST_DB_REQUIRED` when no DB is configured — **after** the report file has been written — so `run()` rejects even though a report exists. | CONFIRMED (code path; not executed with a real DB) |
| A6 | Report and trades-CSV file names are the raw `meta.id`; the id stored inside the report is unchanged. | CONFIRMED |

### Test B — live/paper market-data delivery (`MarketFeed._feedRuntime`)

| # | Finding | Tag |
|---|---|---|
| B1 | `onMarketData(packet, {source:"bar"})` is invoked once per bar; the broker position snapshot is pushed first (`_syncPositionSnapshot`). | CONFIRMED |
| B2 | A returned signal goes to `broker.handle`; a result without `intent` is dropped. | CONFIRMED |
| B3 | When the 2 s (configurable) timeout wins, `feedBar` resolves, **no order is sent**, and `onStrategyCrash(runtimeId, STRATEGY_TIMEOUT)` is called — i.e. a slow tick is accounted as a strategy crash. | CONFIRMED |
| B4 | The strategy operation is **not cancelled**: `Promise.race` only abandons the result; the strategy keeps running after the timeout. | CONFIRMED |
| B5 | Subsequent market data **overlaps** with the outstanding operation (two `onMarketData` calls in flight simultaneously); there is no serialization, deduplication or exactly-once guarantee. | CONFIRMED |
| B6 | A late rejection from the timed-out call is swallowed (the race already settled) and produces no second crash report. | CONFIRMED |
| B7 | Dependencies are resolved lazily inside the catch block, so a stale timeout is reported against whatever deps are injected at that moment (test-only artifact; production deps are stable). | CONFIRMED |

### Test C — engine warmup (`CoreXEngine#warmupStrategy`)

| # | Finding | Tag |
|---|---|---|
| C1 | Dispatch order is: `onBar(bar)` if present, else `onTick(bar, true)`. When both exist, `onTick` is never called. | CONFIRMED |
| C2 | Only the trailing `lookback` bars of the fetched window are replayed (30 fetched → 20 replayed with `lookback: 20`). | CONFIRMED |
| C3 | `onBar`/`onTick` are invoked **without `await`**: an async strategy is not awaited and warmup resolves while its work is still pending. | CONFIRMED |
| C4 | `strategy._warmedUp = true` is set even when a bar threw and the loop `break`-ed, and even when the strategy has neither `onBar` nor `onTick`. | CONFIRMED |
| C5 | Insufficient data (`< min(lookback, 10)` bars) returns `false` and leaves `_warmedUp` unset. | CONFIRMED |
| C6 | Remote runtimes bypass local dispatch and go through `strategyRuntime.warmupBar({strategyId, bar})`; a `{ok:false}` result aborts the loop and still reports failure. | CONFIRMED |
| C7 | An invalid timeframe aborts before any provider fetch. | CONFIRMED |

## 9. Known defects intentionally left unresolved

| Defect | Location | Why left |
|---|---|---|
| Silent trades-CSV write failures | `engine/backtestManager.js` `_saveTradesToCsv` | Outside the confirmed `_saveToFile` defect; would change report semantics beyond P0. |
| Report and CSV names are raw ids (`:` / `/` are unwritable and reader-mismatched) | `engine/backtestManager.js` `_saveToFile` / `getTradesCsvPath` vs `engine/routes/backtestController.js` | Naming is Stage 1's shared `safeFilename` helper in `userScope` (writer **and** readers). A writer-only sanitizer would produce files the API cannot find or delete. |
| `BACKTEST_DB_REQUIRED` thrown after the file write | `_saveToDatabase` / `run()` ordering | Needs a decision on report-vs-DB precedence. |
| Market-data timeout does not cancel, and does not serialize per runtime | `packages/corex-market-data/src/MarketFeed.js:196-218` | P0 is characterization only; cancellation/serialization is a design change. |
| Warmup does not await `onBar`/`onTick`; `_warmedUp` set on failure | `engine/core/engine.js:542-565` | P0 must not redesign warmup. |
| Duplicate `_saveToFile` in the Stage 1 WIP | Stage 1 working tree | Unrelated WIP; must not be modified or reconciled in P0. |
| `SignalProcessingEngine.maxDailyLossLimit` unused; `maxDrawdownThresholdPct` hardcoded at `10.0` | `engine/core/pipeline/SignalProcessingEngine.js:15-16` | Risk policy — prohibited in P0. |
| `runPipeline` has no callers; `SignalGenerationEngine._callStrategy` requires `next()` | `engine/core/pipeline/*` | Prohibited in P0 (no pipeline changes). |
| `getTradesCsvPath` has no consumers | `engine/backtestManager.js` | Dead API; deletion is a separate task. |
| `test/runtime-lifecycle-provider.test.js` fails against current `RuntimeLifecycle` | Stage 1 WIP | Unrelated WIP; not run or modified. |

## 10. Remaining baseline limitations

1. **No live/paper execution verification** — no broker credentials, no live market socket
   (`TWELVE_DATA_KEY` absent). Paper/Live behavior is characterized from code and unit tests only.
2. **No database verification** — the worktree has no `.env`; `postgres.hasDbConfig()` is false and
   the DB driver is stubbed in Test A. No migration, constraint or real `backtests` insert was exercised.
3. **Synthetic data only** — all bars in Test A are generated in the test file. This is not real-market
   verification and must not be read as such.
4. **Three full-suite runs** — 59/626 was measured three times on one machine (Windows, Node 22); the
   first run hit a known timing flake in `test/IncrementalIndicators.test.js`, runs 2 and 3 were green.
   No repeat-stability or CI comparison beyond that was performed.
5. **No lint/type step** — the repo has no `lint` or `typecheck` script (no ESLint config installed),
   so style/typing was reviewed manually only.
6. **Worktree-only dependency link** — `node_modules` is a junction to the main checkout; a clean CI
   checkout will run `npm ci` and may produce different timings (not different results).
7. **`--forceExit` on targeted runs** — the engine module leaves open handles; the full suite ran
   without it, but targeted runs need it to terminate.