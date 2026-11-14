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
- [x] Registry mutations that could destroy another owner's work are fenced by the
      claim token (`ownerToken`, `delete(id, {token})`, token-scoped
      `releaseReservation`, `isOwnedBy`).
- [x] Claims do not expire: an in-process claim is released by its owner or by
      process exit, so a slow boot is never treated as dead.
- [x] Rollback of a committed boot keeps exclusive ownership through cleanup
      (STOPPING → strip collaborators → destroy → remove own entry → release claim)
      and stays retryable afterwards.
- [x] Strategy deletion is mutually exclusive with creation via
      `claimStrategyDeletion()` / `releaseStrategyDeletion()`; a concurrent delete
      gets 409, a failed DB delete releases the claim.
- [x] Concurrent operations are covered by regression tests (19 tests).
- [x] Existing tests remain green — full suite 60 suites / 645 tests.
- [x] No unrelated work in the diff (5 source files + 1 test file, no engine
      reorganization, no schema change).

## Verification commands

```powershell
node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js test/runtimeExclusivity.test.js
npm test
```

Results are recorded in the implementation record
(`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`).

## Handoff — 2026-11-14 (review corrections, PR #63)

Owner / agent: Kilo Code
Status: REVIEW
Branch: `engine-01/stage-2-runtime-ownership`
Last verified commit: see `git log -1` on the branch (corrections commit).
Files changed: `engine/core/runtime/RuntimeRegistry.js`,
`engine/core/runtime/RuntimeLifecycle.js`, `engine/strategyLoader.js`,
`engine/routes/strategyController.js`, `engine/routes/executionController.js`,
`test/runtimeOwnership.test.js`, plus this file, `plans/STATUS.md`,
`plans/KNOWN_ISSUES.md`, `plans/decisions.md` and
`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.
Completed: the two review defects — (1) reservation TTL expiry replaced by
never-expiring claims plus token-fenced commit/release/delete and an ordered
rollback that holds ownership until cleanup finishes; (2) deletion claim taken
before the DB delete and released on every outcome. Six new regression tests
(13–19) plus the rewritten slow-boot/fencing tests.
Commands and test results:
- targeted: `test/runtimeOwnership.test.js` + `test/runtimeExclusivity.test.js`
  → 2 suites / 23 tests pass (17.036 s).
- `npm test` → 60 suites / 645 tests pass (55.106 s).
Unverified items / limitations: no real broker/PAPER/LIVE end-to-end boot (no
credentials, broker factory mocked in tests); ownership is per-process and
deletion claims are per-process; no crash reconciliation of a runtime persisted
as ACTIVE after a process death; `strategyLoader.startStrategy` is not
unit-covered (needs compiler + DB).
Decisions needed: whether cross-process runtime ownership is ever required
(that would need a DB-backed lease, not implemented here).
Blockers: none.
Exact next action: review the corrections diff and the implementation record; if
accepted, merge PR #63.
May another agent continue? YES — resume this file and the implementation record.