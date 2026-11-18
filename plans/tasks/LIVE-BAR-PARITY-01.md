# LIVE-BAR-PARITY-01 — Live/backtest bar-pipeline parity (BUG-1 + BUG-2 + PERF-1/F-1)

**Worktree:** `C:\Users\SBUM\Desktop\corex_diag_livebar`
**Branch:** `diag/live-bar-parity` (pushed to `origin/diag/live-bar-parity`)
**Commit:** `1617bbd` — `fix(strategy): restore live closed-bar parity`
**Base:** `6d35335b81caaee538b7997b6106d10b276b8995` (B9: recovery must not restart a runtime the user stopped)
**Status:** committed and pushed; PR #74 open (draft); awaiting review
**Origin:** read-only investigation (LIVE-BAR-PARITY-01) confirmed three bugs on baseline; this task resolves ownership and verification gaps.

---

## 1. Problem

Three defects in the live/paper bar pipeline diverge from backtest behavior:

| ID | Defect | Impact |
|----|--------|--------|
| BUG-1 | `Strategy.js:_processData` processes a bar-closing tick with `isBar=false`, so `onBar` is never dispatched in the live/tick path. | Strategies defining only `onBar` never trade in live/paper. |
| BUG-2 | On a bar-closing tick, `updateTick` returns only `{ closed }` (no candle), so indicators receive the new bar's first tick instead of the closed candle. | Live EMA/RSI/ATR diverge from backtest on bar close. |
| PERF-1 / roadmap F-1 | `MarketFeed._feedRuntime` allocates one `setTimeout` per tick via `Promise.race`, never cleared when the strategy resolves first. | Pending timers grow with tick count (timer leak). |

## 2. Root cause and fix

**BUG-1 + BUG-2:** `utils/strategy/StrategyDataManager.js:updateTick` returned `{ closed: hadPrevious }` without the closed candle object. `Strategy.js:_processData` had no path to dispatch `onBar` with the closed candle on a closing tick.

**Fix:** `updateTick` now returns `{ closed, candle }` where `candle` is the just-closed candle (null when no close). `_processData` sets `dispatchPacket = result.candle` and `dispatchIsBar = true` when a tick closes a bar, so `onBar(ctx, closedCandle)` fires with the same input backtest provides via `ingestBar`.

**PERF-1:** `MarketFeed._feedRuntime` used `Promise.race([strategy(), new Promise(setTimeout(reject))])`. The timer could never win for synchronous strategy code but leaked one pending timer per tick. **Fixed:** the strategy promise is now raced against a timeout with `clearTimer` called via `then(clearTimer, clearTimer)` on settle, so a compliant strategy never leaks a pending timer and a never-settling strategy is rejected with `STRATEGY_TIMEOUT` instead of wedging the tick loop. Rejection-safe cleanup prevents an unhandled rejection from the cleanup promise. **Contract:** strategy hooks must resolve synchronously; the timeout prevents the feed from hanging but does not cancel the original promise.

## 3. Package ownership resolution (P0)

**Discovery:** Two independently maintained `StrategyDataManager` implementations existed:

| Path | Owner | Fixed? | Used by package Strategy.js? |
|------|-------|--------|------------------------------|
| `utils/strategy/StrategyDataManager.js` | Legacy root utils | YES | No (after this change) |
| `packages/corex-strategy-engine/src/StrategyDataManager.js` | Package-owned | No (before fix) | Yes (before fix) |

**Resolution:** Package-owned `packages/corex-strategy-engine/src/StrategyDataManager.js` updated to match the fixed `{ closed, candle }` contract. `Strategy.js` import changed from `@utils/strategy/StrategyDataManager` to `./StrategyDataManager`. Both implementations are now functionally identical.

**Not deleted:** `utils/strategy/StrategyDataManager.js` retained — `utils/BaseStrategy.js` (legacy `next()` base, out of scope) still imports it. Not modified per task boundaries.

**Not exported publicly:** `packages/corex-strategy-engine/index.js` does not export `StrategyDataManager` — internal package detail only.

**SoACandleStore duplication (reported, not refactored):** Two implementations exist (`utils/strategy/SoACandleStore.js` and `packages/corex-strategy-engine/src/SoACandleStore.js`), functionally identical. Not refactored — StrategyDataManager migration does not require SoACandleStore changes.

## 4. Scope

**In scope**

- `packages/corex-strategy-engine/src/StrategyDataManager.js`: `{ closed, candle }` return contract.
- `packages/corex-strategy-engine/src/Strategy.js`: `_processData` closed-candle dispatch; import change.
- `packages/corex-market-data/src/MarketFeed.js`: per-tick timer leak fix (race + `then(clearTimer, clearTimer)` on settle; async-hook guard with STRATEGY_TIMEOUT rejection).
- `packages/corex-strategy-engine/test/live-bar-parity.test.js`: 10 regression tests (T1–T10), strengthened (T3 full parity, T5 awaits all feed operations and verifies setTimeout/clearTimeout parity, T7 never-settling promise triggers onStrategyCrash, T8 rejected promise triggers onStrategyCrash, T9 late-settling promise does not wedge subsequent ticks, T10 closed candle carries its symbol for multi-symbol parity).
- `plans/Audit/live-bar-parity-diagnosis.md`: corrected baseline, duplicate discovery documentation.
- `plans/decisions.md`: architectural decision entry.
- `plans/KNOWN_ISSUES.md`: deferred `BaseStrategy.js` equivalents.
- `plans/tasks/LIVE-BAR-PARITY-01.md`: this task file.

**Out of scope**

- `plans/STATUS.md`: deliberately NOT modified — file is superseded by `plans/ROADMAP.md` (header says "do not update").
- `utils/BaseStrategy.js` legacy equivalents (deferred, documented in KNOWN_ISSUES.md).
- `engine/core/pipeline/SignalGenerationEngine.js` dead-code duplicate (0 callers, slated for removal).
- No new public package API exports.
- No database migrations.

## 5. Acceptance

- [x] `utils/strategy/StrategyDataManager.js:updateTick` returns `{ closed, candle }` (verified by source inspection).
- [x] `packages/corex-strategy-engine/src/StrategyDataManager.js` matches fixed contract (verified by source inspection).
- [x] `Strategy.js` imports `./StrategyDataManager` (package-owned), not `@utils/strategy/StrategyDataManager` (verified by source inspection).
- [x] No remaining `@utils/strategy/StrategyDataManager` imports inside `packages/corex-strategy-engine/` (verified by grep).
- [x] T1: `onBar` fires once per closed bar on bar-closing tick (10/10 pass).
- [x] T2: `onBar` receives complete closed candle OHLC, never raw tick (10/10 pass).
- [x] T3: Live EMA matches backtest EMA at every bar, full parity (10/10 pass).
- [x] T4: Each tick aggregated exactly once via `updateTick` (10/10 pass).
- [x] T5: every `setTimeout` call is matched by a `clearTimeout` call across 1,000 awaited feed operations (10/10 pass).
- [x] T6: `candleBased: true` → `onBar` only; `candleBased: false` → `onTick` every tick (10/10 pass).
- [x] T7: never-settling strategy promise triggers `onStrategyCrash` with `STRATEGY_TIMEOUT` (10/10 pass).
- [x] T8: rejected strategy promise triggers `onStrategyCrash` with the rejection reason (10/10 pass).
- [x] T9: late-settling promise does not wedge subsequent ticks (10/10 pass).
- [x] T10: closed candle carries its `symbol`; multi-symbol parity holds (10/10 pass).
- [x] Existing `Strategy.test.js`: 7/7 pass, no regressions.
- [x] `git diff --check` clean (no whitespace errors).
- [x] Committed as `1617bbd` on `diag/live-bar-parity`; pushed to `origin/diag/live-bar-parity`; PR #74 open (draft).

## 6. Verification evidence

| Command | Result |
|---------|--------|
| `jest --runTestsByPath packages/corex-strategy-engine/test/live-bar-parity.test.js --runInBand --forceExit` | 10 suites / 10 tests pass |
| `jest --runTestsByPath packages/corex-strategy-engine/test/Strategy.test.js --runInBand --forceExit` | 1 suite / 7 tests pass (no regressions) |
| `node --check utils/strategy/StrategyDataManager.js` | pass |
| `node --check packages/corex-strategy-engine/src/StrategyDataManager.js` | pass |
| `node --check packages/corex-strategy-engine/src/Strategy.js` | pass |
| `node --check packages/corex-market-data/src/MarketFeed.js` | pass |
| `git diff --check` | clean (no whitespace errors) |

Not run: full project suite (targeted tests only); SoACandleStore benchmark test has a pre-existing performance failure unrelated to this change (100k ticks >500ms on this machine).

## 7. Remaining risks

- Behaviour change: strategies defining only `onTick` with default `candleBased: true` stop being called. Mitigated by one-time cold-path `log.warn`. Zero DB strategies affected (`Rapid` = `onBar`, `demo` = legacy `next()`).
- PERF-1: the strategy promise is now raced against a timeout with `clearTimer` called via `then(clearTimer, clearTimer)` on settle. A never-settling strategy promise triggers `onStrategyCrash` with `STRATEGY_TIMEOUT` instead of wedging the tick loop. Rejection-safe cleanup prevents an unhandled rejection from the cleanup promise. Acceptable because strategies are synchronous by contract (package `AGENTS.md`). The timeout prevents the feed from hanging but does not cancel the original promise.
- `utils/BaseStrategy.js` retains the same BUG-1/BUG-2 defects (deferred, documented in KNOWN_ISSUES.md).
- `SignalGenerationEngine.js` retains the dead-code duplicate (0 callers, slated for removal).

## 8. Handoff

Commit `1617bbd` pushed to `origin/diag/live-bar-parity`. PR #74 open (draft). Awaiting review verdict.
