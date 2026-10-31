# Phase 2 Test Results

Suite: test/backtest/handVerified.test.js

- Test 1 (gross next-bar-open fills): FAIL — BACKTEST_DB_REQUIRED at engine/backtestManager.js:862 (_saveToDatabase). Simulation produced 1 trade but save requires DB.
- Test 2 (no lookahead): FAIL — same DB_REQUIRED at :862.
- Test 3 (commission 0.2%): FAIL — same DB_REQUIRED at :862.
- Test 4 (slippage 10 bps): FAIL — same DB_REQUIRED at :862.
- Test 5a (high<low rejected): PASS (threw).
- Test 6 (abort on 200k bars): FAIL — completed in 17895ms, not <1000ms; abort polled only every 500 bars and check occurs after batch yield; no hard timeout. Also DB_REQUIRED would block save but simulation finished first.

Root cause common to Tests 1-4: `_saveToDatabase` throws `BACKTEST_DB_REQUIRED` when `db.hasDbConfig()` is false and `BACKTEST.DB_REQUIRED` is true (engine/backtestManager.js:860-863), even though `_saveToFile` already succeeded. Realism config also never reaches broker (commissionPct/slippageBps/spread omitted in `_resolveConfig`, engine/backtestManager.js:308-328), so Tests 3/4 expected values would not match even with DB.
