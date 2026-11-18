# Live vs Backtest Bar-Pipeline Parity — Fix Confirmation

> Branch: `diag/live-bar-parity` (worktree `corex_diag_livebar`)
> Date: 2026-11-18
> Baseline: `6d35335b81caaee538b7997b6106d10b276b8995` (B9: recovery must not restart a runtime the user stopped).
> `origin/main` is `574fa7b` (B10), one commit ahead of the baseline.
> Status: All three bugs fixed and verified. Changes are **uncommitted** on the local worktree branch only — not pushed, not merged.

## Summary

All three parity bugs are **fixed and verified**. `packages/corex-strategy-engine/test/live-bar-parity.test.js`
goes from **failing pre-fix** (T1 and T2 confirmed failing on baseline) to **6 / 6 pass** post-fix. The existing
`packages/corex-strategy-engine/test/Strategy.test.js` (7 tests) also passes — no regressions.

| ID | Bug | Verdict | Fix |
|----|-----|---------|-----|
| BUG-1 | `onBar` never fires on a bar-closing tick (live/tick path) | **FIXED** | `Strategy.js:_processData` dispatches closed candle as bar event |
| BUG-2 | Indicators fed the new bar's first tick, not the closed candle | **FIXED** | `updateTick` returns closed candle; `_processData` feeds it to indicators |
| PERF-1 (roadmap **F-1**) | Per-tick `setTimeout` leak in `MarketFeed._feedRuntime` | **FIXED** | Timer removed; elapsed time measured instead |

## Files changed

- `utils/strategy/StrategyDataManager.js` — `updateTick` now returns `{ closed, candle }` where
  `candle` is the just-closed candle (null when no close). No new allocation. **Legacy root utils copy.**
- `packages/corex-strategy-engine/src/StrategyDataManager.js` — Package-owned duplicate, previously unfixed.
  Updated to match the fixed `{ closed, candle }` contract. Now the authoritative implementation.
- `packages/corex-strategy-engine/src/Strategy.js` — `_processData` resolves the dispatch packet:
  a bar-closing tick now dispatches `buildContext(closedCandle, true)` → `onBar(ctx, closedCandle)`.
  Mid-bar ticks return early (no indicator update). Added cold-path `log.warn` when a strategy
  defines only `onTick` while `candleBased` is true (the default). Import changed from
  `@utils/strategy/StrategyDataManager` to `./StrategyDataManager` (package-owned).
- `packages/corex-market-data/src/MarketFeed.js` — `_feedRuntime` no longer schedules a
  `setTimeout` per tick via `Promise.race`; calls the strategy directly and measures elapsed time,
  logging a warning if it exceeds `COREX_STRATEGY_TIMEOUT_MS`.
- `packages/corex-strategy-engine/test/live-bar-parity.test.js` (new) — 6 regression tests (T1–T6).

## Duplicate StrategyDataManager discovery and resolution

**Discovery:** Two independently maintained `StrategyDataManager` implementations existed:

| Path | Owner | Fixed? | Imported by package Strategy.js? |
|------|-------|--------|----------------------------------|
| `utils/strategy/StrategyDataManager.js` | Legacy root utils | **YES** | No (after this change) |
| `packages/corex-strategy-engine/src/StrategyDataManager.js` | Package-owned | **No** (before this change) | Yes (before this change) |

**Resolution:** The package-owned `packages/corex-strategy-engine/src/StrategyDataManager.js` was updated to match
the fixed `{ closed, candle }` contract from the legacy copy. `Strategy.js` now imports `./StrategyDataManager`
(package-owned) instead of `@utils/strategy/StrategyDataManager` (root utils). Both implementations are now
functionally identical.

**Not deleted:** `utils/strategy/StrategyDataManager.js` is retained because `utils/BaseStrategy.js` (legacy
`next()`-based strategy base class, not in scope for this task) still imports it. Per task boundaries, `BaseStrategy.js`
was not modified.

**Not exported publicly:** `packages/corex-strategy-engine/index.js` does not export `StrategyDataManager` — it is
an internal implementation detail used only by `Strategy.js` within the package. No external package API requirement
exists for it.

## SoACandleStore duplication (reported, not refactored)

Two `SoACandleStore` implementations exist:
- `utils/strategy/SoACandleStore.js` — legacy root utils, used by legacy `StrategyDataManager` and `BaseStrategy.js`
- `packages/corex-strategy-engine/src/SoACandleStore.js` — package-owned, used by package `StrategyDataManager`

Both are functionally identical. Not refactored in this task per scope boundaries (StrategyDataManager migration
does not require SoACandleStore changes).

## Contract (matches existing README documentation)

- `candleBased` defaults to **true** (`Strategy.js:150`).
- With `candleBased: true`: only `onBar` runs, once per closed candle, with the closed candle.
  `onTick` runs only when `candleBased: false`, on every tick.
- `README.md:20-21` already documented this; the implementation now conforms.

## Residual risks (recorded in `plans/decisions.md`)

1. **Behaviour change:** a strategy that defines `onTick` and relies on the default
   `candleBased: true` stops being called (today it was called once per bar close with the raw
   tick). Zero such strategies in the DB (`Rapid` = `onBar`, `demo` = legacy `next()`), but
   user-supplied strategies may be affected. Mitigated by a one-time cold-path warning.
2. **Re-tuning:** indicators now receive the closed candle's `close` once per bar, matching
   backtest. Strategies tuned against the buggy live values will behave differently.
3. **PERF-1 trade-off:** removing the timer removes the guard against a strategy returning a
   never-settling promise (today: `STRATEGY_TIMEOUT` → `onStrategyCrash`; after: the tick loop
   would hang). Acceptable because strategies are synchronous by contract (package `AGENTS.md`).
   Unrelated unguarded awaits (`broker.onTick`, `broker.handle`) are unchanged.

## Explicitly NOT in scope

- `utils/BaseStrategy.js` (legacy `next()`-based) has the same two defects but is a separate base
  class. Deferred and documented in `plans/KNOWN_ISSUES.md`.
- `engine/core/pipeline/SignalGenerationEngine.js:157-176` contains a duplicate copy of the gate
  and a `next(packet)`/`onTick()` dispatch. It is **dead code with 0 callers** and already slated
  for removal. Not "fixed" here to avoid a second implementation.

## Tests

Run from the repo root (root `moduleNameMapper` is required for the `@data` alias):

```
node node_modules/jest/bin/jest.js --runTestsByPath \
  packages/corex-strategy-engine/test/live-bar-parity.test.js --runInBand --forceExit
```

Result: **6 / 6 pass**. Existing `Strategy.test.js`: **7 / 7 pass** (no regressions).
