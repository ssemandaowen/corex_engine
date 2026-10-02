# Baseline Test Results

Date: 2026-10-02
Branch: chore/strategy-engine-closure
Base commit: dfb1b24be9821c48fe234125c5d6f511de518ffc

## Package Tests: `packages/corex-strategy-engine`
- Total Test Suites: 10 passed, 10 total
- Total Tests: 87 passed, 87 total

## Full Test Suite: `npm test` / `npx jest`
- Total Test Suites: 51 passed, 51 total
- Total Tests: 572 passed, 572 total

### Previously Failing Tests (3 total in 1 test suite)
File: `test/round7.comprehensive.test.js`
1. `security.js — loop guards › eval is blocked` — syntax error, expected `/eval/i`
2. `security.js — loop guards › require('fs') is blocked` — syntax error, expected `/fs/i`
3. `security.js — loop guards › process access is blocked` — syntax error, expected `/process/i`

All three failed for the same reason and all three now pass. The cause was in the test
helper, not the scanner: `wrap()` spliced each case into `next(bar) { <code> return null; }`
without a statement terminator, producing `next(bar) { eval('1+1') return null; }`. Acorn
throws `SyntaxError` on adjacent statements, so `validateStrategyCode` bailed at the parse
step in `utils/security.js:89` and the scanner's blocklists were never reached. The loop
cases passed only because `while(true){}` is self-terminating.

`utils/security.js` is unchanged. All three cases remain blocked, now genuinely
exercising the scanner rather than failing at parse time.

## Changes Verified

- `engine/routes/strategyController.js` and `scripts/sync-strategy-manifest.js` now consume
  the package-owned manifest via the `corex-strategy-engine` public API.
- `utils/strategy/StrategyManifest.js` is a shim over the package implementation.
- `utils/strategy/StrategyValidator.js` is a shim over the package implementation.
- Indicator validation checks the IndicatorRegistry first, so the 34 registry-only
  indicators (KAMA, SuperTrend, Ichimoku, TSI, ...) are no longer reported as unknown.