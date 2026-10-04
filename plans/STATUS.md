# CoreX — Modularization Status

> Last refreshed: 2026-10-04 (J1). Source of truth for task state.
> Test baseline on `origin/main` (dfb1b24): 51 suites, 572 tests — 50 suites / 569 tests pass, 1 suite (`test/round7.comprehensive.test.js`) fails with 3 failures. That legacy test depends on the deleted-on-branch `utils/BaseStrategy` and is intentionally removed by PR #16 (`chore/legacy-deletion`, still OPEN).

## Task board

| Task | Owner agent | Branch | State | Last update |
|------|-------------|--------|-------|-------------|
| J1 — Tracking refresh (docs only) | Jules | `jules/j1-status-refresh` | in-progress | 2026-10-04 |
| J2 — Scanner characterization tests | Jules | `jules/j2-scanner-tests` | todo | 2026-10-04 |
| J3 — Package dependency and README sweep | Jules | `jules/j3-package-deps-docs` | todo | 2026-10-04 |
| J4 — Dependency-direction ratchet test and size report | Jules | `jules/j4-ratchet-test` | todo | 2026-10-04 |
| J5 — corex-accounts: inject DB and secrets | Jules | `jules/j5-accounts-injection` | todo | 2026-10-04 |
| J6 — corex-broker-contract: inject DB in mt5Bridge | Jules | `jules/j6-broker-db-injection` | todo | 2026-10-04 |
| J7 — TwelveData: remove the self-import loop | Jules | `jules/j7-twelvedata-boundary` | todo | 2026-10-04 |
| J8 — Retire the legacy broker/ tree | Jules | `jules/j8-retire-broker-tree` | todo | 2026-10-04 |
| J9 — "Stuck in queued" backtest bug: investigation first | Jules | `jules/j9-queued-bug` | todo | 2026-10-04 |
| J10 — Engine singleton inventory (evidence only) | Jules | `jules/j10-engine-singletons` | todo | 2026-10-04 |

## Run order

- Independent (can run in parallel): J1, J2, J3, J4, J9, J10
- Sequential pairs: J5 then J6, and J7 then J8 (they touch the same wiring files)

## Prerequisites (Owen, before starting)

- [ ] PR #16 (`chore/legacy-deletion`) merged into main — deletes legacy `BaseStrategy` cascade, `round7.comprehensive.test.js`, and legacy shims; turns main's failing suite green
- [ ] Lean `AGENTS.md` and `plans/decisions.md` committed (done in dfb1b24)
- [ ] `npm start` boots on main

## Held for Owen or Kilo Code (not for unattended Jules)

- Position/Order/Signal type ownership (`BaseBroker` → `StrategyPositionManager` coupling)
- corex-risk consolidation (issue #4): touches risk enforcement, a protected boundary
- Broadcaster extraction (issue #7): 787 lines, tied to the frontend event contract
- Engine kernel/boot/runtime design (issue #9): design comparison with ChatGPT pending
- Frontend modularization (issue #10)

## GitHub issue map (created 2026-08-18)

| Issue | Title | State | Note |
|-------|-------|-------|------|
| #4 | corex-risk | OPEN | held for Owen/Kilo (protected boundary) |
| #5 | corex-strategy-engine | OPEN | **complete** — package extracted and self-contained; issue not closed |
| #6 | corex-state | OPEN | **superseded** — `StrategyStateStore` now lives in `corex-strategy-engine` |
| #7 | corex-realtime (broadcaster) | OPEN | held for Owen/Kilo |
| #8 | corex-jobs | OPEN | J9 investigates the stuck-in-queued bug |
| #9 | corex-engine (orchestrator) | OPEN | held for Owen/Kilo (kernel/boot design) |
| #10 | Frontend modularization | OPEN | held for Owen/Kilo |
