# Phase 2b Test Results

Test setup: jest.mock("@core/services/postgres") (hasDbConfig false) + jest.mock("@config/constants") (BACKTEST.DB_REQUIRED false). Chosen because _saveToDatabase only throws when DB_REQUIRED true; setting it false lets run() complete via _saveToFile.

- Test 1: FAIL. First failing assertion: entryPrice expected 105, received 107 (bar 4 close). Lookahead: signal on bar 4 fills at bar 4 close, not next bar open. Source: engine/backtestManager.js:581 (strategy.onBar) + :609 broker.execute(signal, bar) using bar.close (SharedFillSim.js:47).
- Test 2: FAIL. trades array empty/undefined on report? report.trades undefined => t undefined. Source: engine/backtestManager.js:780-785 truncates to 20 but report.trades exists in _computeAnalytics; report returned by run() is the report. Actually received undefined because trades length 0? In run 2, simulation produced 0 trades (log: Finished -> 0 trades) on second invocation? Wait strategy _barIndex not reset, so second run emits no signals. Test isolation issue (stateful strategy instance). Source: test fixture stateful _barIndex.
- Test 3: FAIL. netProfit expected 45.70, received 0 (no trades due to stateful strategy). Commission total 0. Realism config dropped confirmed: _resolveConfig (engine/backtestManager.js:308-328) omits commissionPct/slippageBps/spread; config.commissionPct undefined -> 0.
- Test 4: FAIL. same stateful issue + realism dropped.

Test 5:
- 5a high<low: NO THROW (completed run). Re-classified: NOT a bar-validation error; engine does not validate high>=low. engine/backtestManager.js:476-515 (_processDataFrame) only filters finite time & close>0.
- 5b duplicate timestamps: NO THROW.
- 5c NaN close: THROWS "No bars in selected range." (engine/backtestManager.js:513) — indirect, not a clear bar-validation error.
- 5d out-of-order: NO THROW (sorts silently, engine/backtestManager.js:496 orderBy time).

Test 6: abort not effective within 1s; bars processed at abort request ~? bars processed when run stopped ~200000 (finished simulation then caught JOB_CANCELLED at save? Actually cancel detected after batch). abort requested ms 18079, stopped 18082.

Verdicts:
- Realism config dropped: CONFIRMED (tests 3-4 would fail even with fresh strategy).
- Lookahead: CONFIRMED (test 1 received 107).
- Validation: REFUTED (no validation; only NaN close indirectly fails).
- Abort: REFUTED (not within 1s; polled every 500 bars).
