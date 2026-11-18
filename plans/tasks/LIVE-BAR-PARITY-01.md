# LIVE-BAR-PARITY-01 — Live closed-candle and indicator parity

**Status:** IN PROGRESS — implementation locally complete; awaiting commit and publication
**Owner:** Owen
**Implementation worktree:** C:\Users\SBUM\Desktop\corex_diag_livebar
**Branch:** diag/live-bar-parity (local only; no remote branch)
**Last verified HEAD:** 6d35335b81caaee538b7997b6106d10b276b8995 (B9 baseline; implementation changes remain uncommitted)
**Current main at handoff:** 574fa7b45650805c303c95a47be510353acf199c (B10)

## 1. Outcome

Restore live strategy candle semantics so a tick that closes a candle dispatches the closed candle to onBar, live indicators consume that same closed candle as backtesting, and MarketFeed does not allocate a timeout timer on every tick.

## 2. Implementation recorded from local verification

- packages/corex-strategy-engine/src/Strategy.js: closed-candle dispatch; package-owned StrategyDataManager import.
- packages/corex-strategy-engine/src/StrategyDataManager.js: updateTick returns { closed, candle }.
- utils/strategy/StrategyDataManager.js: legacy implementation retains the same contract for the remaining utils/BaseStrategy.js consumer.
- packages/corex-market-data/src/MarketFeed.js: removed per-tick Promise.race timeout allocation; direct strategy await and elapsed-time warning remain.
- packages/corex-strategy-engine/test/live-bar-parity.test.js: T1–T6 regression coverage.
- Documentation: diagnosis report, decision entry, known-issues entry, and task tracking.

## 3. Acceptance evidence reported

- [x] Closing tick dispatches onBar once with the closed candle.
- [x] Mid-bar ticks do not dispatch onBar.
- [x] OHLCV and timestamp are taken from the closed candle.
- [x] Live indicator values match backtest values across the tested bars, including EMA warmup.
- [x] Tick aggregation is called once per tick.
- [x] MarketFeed does not call setTimeout during 1,000 tested _feedRuntime iterations.
- [x] Strategy execution-duration warning remains.
- [x] Package-owned StrategyDataManager is authoritative for corex-strategy-engine.
- [x] Targeted tests reported: parity 6/6, Strategy 7/7, SoACandleStore 4/4.
- [x] git diff --check clean.
- [x] Independent review verdict: APPROVE WITH CONDITIONS; the sole encoding/line-ending condition was corrected and independently rechecked.
- [x] Final change-set audit recommendation: READY FOR COMMIT.
- [ ] Local commit created.
- [ ] Branch pushed and PR opened against current main.
- [ ] Required CI checks and PR integration verification completed.
- [ ] Merge approved and completed; roadmap row updated with merge SHA.

## 4. Known limitations / follow-ups

- Full project test suite was not run; do not claim full-suite green.
- utils/BaseStrategy.js still consumes the legacy StrategyDataManager and retains old lifecycle behavior. This is intentionally deferred to P3/P4/P5; do not expand this bug-fix task to remove it.
- SignalGenerationEngine.js dead-code bar gate and duplicated SoACandleStore remain separate cleanup/ownership work.
- Removing the per-tick timeout guard means a never-settling async strategy promise can stall the feed path. Strategy package contract requires synchronous hooks; this remains a documented risk.
- onTick-only strategies with candleBased: true follow the corrected candle contract and no longer receive every tick; the constructor warning documents this behavior.

## 5. Exact next action

On the existing local worktree only: stage the exact task files, inspect the complete staged diff, create the local commit after Owen authorization, then push the existing branch and open one PR. Do not create a duplicate branch or PR.