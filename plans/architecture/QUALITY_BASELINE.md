# Quality Baseline — P0-06 (Corrected)

## Verified commit

- Commit: `435127546087f9d40486ea272cb337363ce0724e` (origin/main)
- Branch: `review/p0-06-quality-baseline`
- Date: 2026-10-31

## Node/tooling environment

- Node.js: v (not captured; environment) — see limitations
- npm: (not captured)

## Command matrix

| Command | Result | Suites | Tests | Duration | Notes |
|---|---|---|---|---|---|
| `npm test` (jest --passWithNoTests) | PASS | 51 | 572 | 85.07s | Run on 2026-10-31 against 4351275. Worker process did not exit gracefully (open-handle warning). Raw output not persisted to a log file. |
| `npm run test:auth` (root) | NOT RUN (script broken) | — | — | — | Script points to `test/auth.service.test.js` and `test/auth.integration.test.js`, which do not exist. Would report "No tests found". |
| `front_end` `npm run lint` (`tsc --noEmit`) | NOT COMPLETED | — | — | timed out (>120s) | Command started but did not finish within timeout; no pass/fail conclusion. |
| `front_end` `npm run build` | NOT RUN | — | — | — | Not executed. |
| `npm run db:migrate` | NOT RUN | — | — | — | Protected migration path. |
| lint (root) | NOT CONFIGURED | — | — | — | No lint script in root package.json. |
| typecheck (root) | NOT CONFIGURED | — | — | — | No typecheck script at root. |

## Test inventory

51 suites / 572 tests, all passed in the full run. Includes `packages/corex-auth` (AuthService, SecretsVault) and `test/round7.comprehensive.test.js`.

## Known issues reconciliation (plans/KNOWN_ISSUES.md)

1. `test/round7.comprehensive.test.js` — `eval`, `require('fs')`, `process` access tests:
   - The `wrap` helper produces `next(bar) { ${code}; return null; }` (semicolon present).
   - Earlier full run reported all 572 tests passing, which includes these cases.
   - KNOWN_ISSUES entry describing a missing-semicolon Acorn syntax error appears stale relative to the current code; evidence supports reclassification, but the entry was not modified here. Requires a fresh run to confirm (node_modules currently broken).
2. corex-strategy-engine extraction incomplete tasks: unchanged, still applicable.

## Authentication findings

- Root `test:auth` script (`jest --runInBand test/auth.service.test.js test/auth.integration.test.js`) references files that do not exist → script is broken and would find no tests.
- Actual auth tests: `packages/corex-auth/test/AuthService.test.js` and `packages/corex-auth/test/SecretsVault.test.js`, both pure-logic (Node crypto only), no PostgreSQL or external service required. They were included in the full `npm test` run.
- No PostgreSQL dependency verified in these tests.

## Frontend checks

- `front_end/package.json` `lint` = `tsc --noEmit` (typecheck is configured via lint, contrary to earlier "not configured" claim).
- Execution: started but did not complete within 120s; result unknown. Not claimed as pass.

## Jest diagnostic

- Shutdown warning: "A worker process has failed to exit gracefully..." (open handles / timers). Not confirmed as a timer leak; diagnostic (`--detectOpenHandles`) not yet run. Raw warning text preserved above.

## Environment limitations

- node_modules partially broken (`@jest/core` missing) prevented re-running tests during this correction pass.
- Raw full-run output was not persisted to a log file; only summary captured.
- Auth integration and frontend build not executed.

## Coverage gaps

- Auth integration tests: root script broken (target files absent).
- Frontend typecheck: not completed.
- DB migrations: not run (protected).
- Known-issue reclassification not re-verified by a fresh run.

## Recommendations

- Repair root `test:auth` script to target `packages/corex-auth/test/`.
- Re-run full suite and persist raw log.
- Run `--detectOpenHandles` to diagnose shutdown warning.
- Complete frontend `tsc --noEmit` and build.
- Reconcile KNOWN_ISSUES.md round7 entry with fresh evidence.
