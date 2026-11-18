# Baseline Test Results

Date: $(date)
Branch: jules/strategy-engine-finalize
Base commit: dfb1b24be9821c48fe234125c5d6f511de518ffc

## Package Tests: `packages/corex-strategy-engine`
- Total Test Suites: 10 passed, 10 total
- Total Tests: 87 passed, 87 total

## Full Test Suite: `npm test` / `npx jest --runInBand --forceExit`
- Total Test Suites: 50 passed, 1 failed, 51 total
- Total Tests: 569 passed, 3 failed, 572 total

### Failing Tests (3 total in 1 test suite):
File: `test/round7.comprehensive.test.js`
1. `security.js — loop guards › eval is blocked` (Syntax error expected pattern /eval/i, received "Strategy code has a syntax error: Unexpected token (5:36)")
2. `security.js — loop guards › require('fs') is blocked` (Syntax error expected pattern /fs/i, received "Strategy code has a syntax error: Unexpected token (5:38)")
3. `security.js — loop guards › process access is blocked` (Syntax error expected pattern /process/i, received "Strategy code has a syntax error: Unexpected token (5:39)")
