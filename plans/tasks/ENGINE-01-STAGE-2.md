# ENGINE-01 — Stage 2: Atomic Runtime Ownership

Status: REVIEW
Suggested owner: Kilo Code
Risk: Medium (touches runtime lifecycle and the strategy deletion route)
Dependencies: ENGINE-01 P0 baseline (merged in PR #62)
Branch: `engine-01/stage-2-runtime-ownership`
Implementation record: `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`

## Objective

One authoritative, concurrency-safe runtime ownership mechanism: a runtime
identity cannot acquire competing active instances, and creation, activation,
termination and deletion have deterministic ownership and ordering.

## Scope

- `engine/core/runtime/RuntimeRegistry.js` — reservations, atomic commit,
  transition compare-and-set, stale-reservation recovery, ownership queries.
- `engine/core/runtime/RuntimeLifecycle.js` — reserve → initialize → register,
  rollback on failure, abort-aware boot, serialized and idempotent terminate
  with explicit cleanup-failure recording.
- `engine/strategyLoader.js` — ownership-based start gate, stop targeting that
  includes still-tearing-down entries, concurrency reasons mapped to 409.
- `engine/routes/strategyController.js` — registry-authoritative deletion gate,
  ownership check before delete, race detection around the delete.
- `test/runtimeOwnership.test.js` — 13 regression tests.

## Non-goals

- No change to the strategy lifecycle contract (`onBar`/`onTick`/`_attachRuntime`).
- No P1 prototype-pollution work, no P2 `StrategyContract` retirement.
- No backtest/risk redesign, no new DB schema, no distributed locking.
- No rewrite of boot reconciliation beyond reservation/entry staleness.

## Acceptance criteria and status

- [x] One runtime identity cannot acquire competing active instances
      (`reserve()` + `set()` duplicate guard + `commitReservation()`).
- [x] Creation, activation, termination and deletion have deterministic ownership
      (`reserve → initialize → commit`, CAS transition, registry-owned deletion gate).
- [x] Failed operations leave no misleading registry state
      (rollback releases reservation and destroys the partial broker; cleanup
      failures keep the entry STOPPING with `cleanupFailures` and return false).
- [x] Concurrent operations are covered by regression tests (13 tests).
- [x] Existing tests remain green — full suite 60 suites / 639 tests.
- [x] No unrelated Stage 1 work in the diff (4 source files + 1 test file).

## Verification commands

```powershell
node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js test/runtimeExclusivity.test.js
npm test
```

Results are recorded in the implementation record
(`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`).

## Handoff — 2026-11-14

Owner / agent: Kilo Code
Status: REVIEW
Branch: `engine-01/stage-2-runtime-ownership`
Last verified commit: see `git log -1` on the branch (implementation commit).
Files changed: 4 source files (`engine/core/runtime/RuntimeRegistry.js`,
`engine/core/runtime/RuntimeLifecycle.js`, `engine/strategyLoader.js`,
`engine/routes/strategyController.js`) + `test/runtimeOwnership.test.js` +
this file, `plans/STATUS.md`, `plans/KNOWN_ISSUES.md`, `plans/decisions.md` and
`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.
Completed: ownership reservation, atomic creation with rollback, abort-aware
boot, serialized/idempotent termination with cleanup accounting, registry-
authoritative deletion gate, stale-reservation and non-live-entry protection,
13 regression tests, documentation.
Commands and test results:
- targeted: `test/runtimeOwnership.test.js` + `test/runtimeExclusivity.test.js`
  → 2 suites / 17 tests pass.
- `npm test` → 60 suites / 639 tests pass (run 2; run 1 had one unrelated
  flake in `packages/corex-gateway/test/socketx.test.js`, which passes in
  isolation and on rerun).
Unverified items / limitations: no real broker/PAPER/LIVE end-to-end boot (no
credentials, broker factory mocked in tests); no multi-process/multi-instance
deployment (ownership is per-process; reservations are in-memory by design);
`strategyLoader.startStrategy` is not unit-covered (needs compiler + DB);
deletion race handling stops the runtime and returns 500 rather than
preventing the race with a lock.
Decisions needed: whether cross-process runtime ownership is ever required
(that would need a DB-backed lease, not implemented here).
Blockers: none.
Exact next action: review the diff and the implementation record; if accepted,
merge the PR. Follow-ups: cross-process ownership (if required),
`strategyLoader.startStrategy` coverage, `stateController` vs registry
reconciliation for the UI status path.
May another agent continue? YES — resume this file and the implementation record.