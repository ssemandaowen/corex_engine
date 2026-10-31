# Phase 3a Results

Branch: fix/backtest-correctness

Files changed: engine/backtestManager.js

Fixes:
1. Realism config: _resolveConfig now carries commissionPct/slippageBps/spread/fillMode; _computeAnalytics sets totalCommission from broker trades (commissionPaid). All 9 tests pass including Test 3.
2. Lookahead: next-open fills via pending signal; Test 1/2/4 pass.
3. Bar validation: validateBars in _processDataFrame throws BACKTEST_INVALID_BARS; Tests 5a-5d pass.

Tests: handVerified 9/9 pass. Test 6 abort still slow (out of scope).

Surprising: removing silent orderBy in _processDataFrame required to reject out-of-order; run() still sorts bars before simulation (line 220), so simulation unaffected.
