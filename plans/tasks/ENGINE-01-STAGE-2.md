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

- `engine/core/runtime/RuntimeRegistry.js` — reservations (no expiry), atomic commit,
  transition compare-and-set, token fencing, deletion claims, parked-reservation
  queries, ownership queries.
- `engine/core/runtime/RuntimeLifecycle.js` — reserve → initialize → register,
  rollback on failure as a success/failure operation, abort-aware boot, serialized
  and idempotent terminate with explicit cleanup-failure recording, cleanup that a
  concurrent terminate can join.
- `engine/strategyLoader.js` — ownership-based start gate (including
  `START_BLOCKED_CLEANUP_PENDING`), stop targeting that includes parked
  reservations, concurrency reasons mapped to 409.
- `engine/routes/strategyController.js` — registry-authoritative deletion gate,
  ownership check before delete, deletion claim held across the delete.
- `test/runtimeOwnership.test.js` — 30 regression tests.

## Non-goals

- No change to the strategy lifecycle contract (`onBar`/`onTick`/`_attachRuntime`).
- No P1 prototype-pollution work, no P2 `StrategyContract` retirement.
- No backtest/risk redesign, no new DB schema, no distributed locking.
- No rewrite of boot reconciliation beyond reservation/entry ownership (claims do
  not expire; crash reconciliation of persisted ACTIVE runtimes stays out of scope).

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
- [x] Token fencing: a stale boot can never commit, release, delete or destroy another
      boot's state (`ownerToken`, `delete(id, {token})`, token-scoped release, `isOwnedBy`).
- [x] Rollback cleanup is serialized with terminate: the in-flight cleanup is published on
      the holder, so a concurrent `terminate()` joins it (one destroy per collaborator,
      one outcome for both callers).
- [x] Parked cleanup is retryable from the routes: `stopStrategy(id)` targets parked
      reservations, and `startStrategy` reports `START_BLOCKED_CLEANUP_PENDING` (409)
      while a cleanup is still owed.
- [x] `commitReservation` restores the claim when registration throws, and a rollback
      with no holder destroys only the objects that boot created (never the registry's).
- [x] Rollback of a committed boot keeps ownership through cleanup
      (STOPPING → destroy → remove own entry → release claim) and stays retryable.
- [x] Strategy deletion is mutually exclusive with creation via
      `claimStrategyDeletion()` / `releaseStrategyDeletion()`; a concurrent delete
      gets 409, a failed DB delete releases the claim.
- [x] Concurrent operations are covered by regression tests (30 tests).
- [x] Existing tests remain green — full suite 60 suites / 656 tests.
- [x] No unrelated work in the diff (5 source files + 1 test file, no engine
      reorganization, no schema change).

## Verification commands

```powershell
node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js test/runtimeExclusivity.test.js
npm test
```

Results are recorded in the implementation record
(`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`).

## Handoff — 2026-11-14 (S2-FIX-2 ownership gaps, PR #63)

Owner / agent: Kilo Code
Status: REVIEW
Branch: `engine-01/stage-2-runtime-ownership`
Last verified commit: see `git log -1` on the branch (S2-FIX-2 commit).
Files changed: `engine/core/runtime/RuntimeLifecycle.js` (rollback operation published on
the holder and joinable by terminate, `_destroyOrphaned` for lost-claim/no-holder rollbacks,
`_joinHolderCleanup`), `engine/core/runtime/RuntimeRegistry.js` (`commitReservation` restores
the claim when `set()` throws, `parkedReservations()`), `engine/strategyLoader.js`
(parked reservations in stop targets, `START_BLOCKED_CLEANUP_PENDING`),
`engine/routes/executionController.js` (409 for that reason), `test/runtimeOwnership.test.js`,
plus this file, `plans/STATUS.md`, `plans/KNOWN_ISSUES.md`, `plans/decisions.md` and
`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.
Completed: (1) rollback cleanup serialized with terminate — the in-flight operation is
published on the holder, so a concurrent terminate joins it and both see one destroy per
collaborator; (2) parked cleanup reachable from the routes — `stopStrategy(id)` targets parked
reservations and a later start reports `START_BLOCKED_CLEANUP_PENDING`; (3a) a failed
`commitReservation` restores the claim so the boot can roll back and release it; (3b) a
lost-claim or holder-less rollback destroys only the objects it created, never the registry's;
(3c) unfenced `delete()`/`clear()` callers inventoried in the implementation record.
Commands and test results:
- targeted: `test/runtimeOwnership.test.js` + `test/runtimeExclusivity.test.js`
  → 2 suites / 34 tests pass (17.708 s).
- `npm test` → 60 suites / 656 tests pass (68.523 s).
Unverified items / limitations: no real broker/PAPER/LIVE end-to-end boot (no
credentials, broker factory mocked in tests); ownership and deletion claims are
per-process; no crash reconciliation of a runtime persisted as ACTIVE after a process
death; `strategyLoader.startStrategy` is not unit-covered end to end (needs compiler + DB),
its gates are covered through the registry/lifecycle suites; a boot that lost its claim
destroys its own objects only when the registry entry does not reference them, so a shared
object is never destroyed.
Decisions needed: whether cross-process runtime ownership is ever required
(that would need a DB-backed lease, not implemented here).
Blockers: none.
Exact next action: review the S2-FIX-2 diff and the implementation record; if accepted,
merge PR #63.
May another agent continue? YES — resume this file and the implementation record.

Owner / agent: Kilo Code
Status: REVIEW
Branch: `engine-01/stage-2-runtime-ownership`
Last verified commit: see `git log -1` on the branch (rollback-cleanup commit).
Files changed: `engine/core/runtime/RuntimeLifecycle.js` (rollback + terminate now share
`_runCleanup`, with per-step completion records, deferred-cleanup parking and retry),
`engine/core/runtime/RuntimeRegistry.js` (reservation shape documents the deferred-cleanup
fields), `test/runtimeOwnership.test.js`, plus this file, `plans/STATUS.md`,
`plans/KNOWN_ISSUES.md`, `plans/decisions.md` and
`plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.
Completed: rollback cleanup is now success/failure — failed broker or strategy destroy
retains the reference and ownership, the holder stays STOPPING, nothing is released until a
later `terminate()` completes the remaining steps exactly once, and a stale boot still cannot
touch another owner's entry. Obsolete reservation-TTL wording removed.
Commands and test results:
- targeted: `test/runtimeOwnership.test.js` + `test/runtimeExclusivity.test.js`
  → 2 suites / 28 tests pass (19.216 s).
- `test/runtimeOwnership.test.js test/runtimeExclusivity.test.js engine/test`
  → 17 suites / 140 tests pass (47.566 s).
- `npm test` → 60 suites / 650 tests pass (73.298 s).
Unverified items / limitations: no real broker/PAPER/LIVE end-to-end boot (no
credentials, broker factory mocked in tests); ownership and deletion claims are
per-process; no crash reconciliation of a runtime persisted as ACTIVE after a process
death; `strategyLoader.startStrategy` is not unit-covered (needs compiler + DB); a stale
boot that lost its claim drops its own broker/instance instead of destroying them (only
reachable if claims ever expire or go cross-process).
Decisions needed: whether cross-process runtime ownership is ever required
(that would need a DB-backed lease, not implemented here).
Blockers: none.
Exact next action: review the rollback-cleanup diff and the implementation record; if
accepted, merge PR #63.
May another agent continue? YES — resume this file and the implementation record.

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