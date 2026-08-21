# Known Issues

Cross-cutting or unassigned issues affecting the corex-engine repo. Package-specific
issues belong in that package's own `AGENTS.md`.

## Pre-existing test failures (2026-08-21)

**11 tests fail on `main` and on `feature/corex-market-data` — no regressions introduced by Packages 1 or 2.**

Confirmed by running `jest --passWithNoTests` on both branches:
- `main`: 230 passed, 11 failed (16 suites, 241 total)
- `feature/corex-market-data`: 300 passed, 11 failed (22 suites, 311 total — 70 new tests added by Package 2, all passing)

### Failing suites

1. **`test/liveBroker.events.test.js`** (4 failures)
   - MetaApiDriver live-mode behavior requires real MetaAPI token + MT5 terminal.
   - Tests expect live market state that cannot be simulated without credentials.
   - Human verification required — see AGENTS.md §Human verification (#1, #8).

2. **`test/round7.comprehensive.test.js`** (7 failures)
   - PaperBroker commission getter: `TypeError: Cannot read properties of undefined (reading 'map')`
   - Security loop-guard tests: syntax errors / logic assumptions broken pre-Package 1.
   - Not introduced by Packages 1 or 2.

### Status
- These failures pre-date all Package work. Not blocking merge of Package 2.
- Fixing them is out of scope until MetaApiDriver or PaperBroker are actively worked on.
