# Quality Baseline — P0-06

## Verified commit

- Commit: `435127546087f9d40486ea272cb337363ce0724e` (origin/main)
- Branch: worktree from origin/main (detached HEAD)
- Date: 2026-10-31

## Command matrix

| Command | Result | Suites | Tests | Duration | Notes |
|---|---|---|---|---|---|
| `npm test` (jest --passWithNoTests) | PASS | 51 | 572 | 85.07s | Worker process did not exit gracefully (timer leak); tests still passed |
| `npm run test:auth` | NOT RUN | — | — | — | Requires PostgreSQL + auth integration env; not executed to avoid DB side effects |
| `npm run ui:build` | NOT RUN | — | — | — | Frontend not in scope of this audit |
| `npm run db:migrate` | NOT RUN | — | — | — | Protected migration path; not executed |
| lint | NOT CONFIGURED | — | — | — | No lint script in package.json |
| typecheck | NOT CONFIGURED | — | — | — | No typecheck script; frontend uses TS but no root script |

## Test inventory (51 suites)

Unit/contract suites under `packages/` (corex-auth, corex-broker-contract, corex-accounts, corex-gateway, corex-market-data, corex-portfolio, corex-strategy-engine) plus engine and root `test/` suites. All 572 tests passed.

## Environment limitations

- node_modules sourced via junction from the working tree's installed dependencies (original tree has installed deps; worktree did not).
- PostgreSQL not verified available; auth integration tests not run.
- One worker-process graceful-exit warning (timer leak) observed but does not fail the suite.

## Known-issue reconciliation

- No test failures to reconcile; baseline is green on verified main commit.
- Existing `/KNOWN_ISSUES.md` not modified; entries remain as documented.

## Coverage gaps

- Auth integration tests not executed (environment).
- Frontend build/typecheck not executed.
- DB migrations not executed (protected).

## Recommended next verification steps

- Run `npm run test:auth` against a disposable database.
- Run `npm run ui:build`.
- Investigate the worker-process timer leak with `--detectOpenHandles`.
