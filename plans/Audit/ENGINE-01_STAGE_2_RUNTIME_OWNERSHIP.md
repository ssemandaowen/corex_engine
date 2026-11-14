# ENGINE-01 Stage 2 — Atomic Runtime Ownership: Implementation Record

Date: 2026-11-14
Branch: `engine-01/stage-2-runtime-ownership` (base `origin/main` @ `8dd6048`, includes PR #62)
Task record: `plans/tasks/ENGINE-01-STAGE-2.md`

## 1. What the code actually did (implementation-relevant findings)

| # | Finding | Evidence |
|---|---|---|
| F1 | The registry had no concept of "being created": `RuntimeLifecycle.boot()` ran the whole asynchronous initialization (settings load, broker create/initialize, position reconciliation) with no claim on the identity, and registered only at the end. Two concurrent boots of the same runtimeId both passed `has()` and the second `set()` silently overwrote the first, orphaning a live instance and broker. | `RuntimeRegistry.set()` cleared the previous `plotInterval` and overwrote the entry; `boot()` checked `has()` once at entry. |
| F2 | `boot()`'s exclusivity check ran before initialization but nothing prevented a *second* identity for the same account/symbol/mode from starting while the first was still initializing (both see no ACTIVE entry). | `hasActiveForAccountSymbolMode()` only inspected `actualState === "ACTIVE"`. |
| F3 | A failed boot called `runtimeRegistry.delete()` but never destroyed the broker it had already created/initialized → broker leak on every failed start. | `boot()` catch block: only `runtimeRegistry.delete(runtimeId)`. |
| F4 | `terminate()` was not guarded: two concurrent calls both ran destroy/cleanup (double destroy, double `unsubscribe`), and `entry.actualState = "STOPPING"` was a plain assignment that a second caller could not detect as "already in progress". | `terminate()` set `entry.actualState` directly; no CAS. |
| F5 | Cleanup failures were swallowed (`logger.warn` only) and the entry was deleted regardless, so a runtime whose broker failed to destroy was reported as stopped. | `terminate()` catch blocks + unconditional `runtimeRegistry.delete()`. |
| F6 | The deletion route decided "busy" from `stateController` alone, a separate ledger keyed by strategy id that can say `ACTIVE` with no runtime and `STOPPED` while a runtime still runs. Nothing consulted the registry. | `engine/routes/strategyController.js` `isStrategyBusy()`. |
| F7 | After `terminate()` nulled `instance`/`broker`, `all()` still returned the entry, so status queries could report a half-torn-down runtime as active. | `all()` returned every map value; `forSymbol()`/`hasActiveForAccountSymbolMode()` only checked `actualState`. |
| F8 | `strategyLoader.getActiveSymbols()` called `runtimeRegistry.list()`, which does not exist → any caller threw `TypeError`. | `engine/strategyLoader.js:339`; registry exports `all()`. |
| F9 | `MarketFeed._feedRuntime` already refuses entries without `instance`/`broker` (`packages/corex-market-data/src/MarketFeed.js:174`), so a "live entry" definition based on holding both collaborators matches the dispatch contract. | `_feedRuntime` guard. |

No second registry was found: `stateController` is a state ledger (strategy-scoped,
UI-facing), not a runtime owner. It is kept, but demoted to a corroborating signal.

## 2. Mechanism

**Authoritative owner:** `engine/core/runtime/RuntimeRegistry.js`, one module,
three ledgers:

- `_runtimes` — live runtimes (`set` / `delete` / queries).
- `_reservations` — ownership claims for creations in flight.
- `_deletionClaims` — in-progress strategy deletions.

Ownership API (no timers used as concurrency protection):

| Method | Purpose |
|---|---|
| `reserve({runtimeId,userId,accountId,strategyName,symbol,mode,owner})` | Claims the identity. Rejects: already registered, already reserved, a strategy whose deletion is in progress, or same account/symbol/mode already ACTIVE or reserved. Returns an unguessable token. Throws `code: RUNTIME_ALREADY_OWNED` / `RUNTIME_EXCLUSIVITY_VIOLATION` / `RUNTIME_DELETION_IN_PROGRESS`. |
| `commitReservation(token, entry)` | Atomically converts the claim into a registered runtime (reservation released first, then `set`) and stamps the entry with the caller's `ownerToken`. Throws `RUNTIME_RESERVATION_LOST` if the claim is gone. |
| `releaseReservation(token)` | Rolls the claim back (token-scoped, so a stale boot cannot release someone else's claim). |
| `requestAbortReservation(token)` / `isAbortRequested(token)` | Lets `terminate()` abandon an in-flight creation; `boot()` observes it before registering. |
| `transition(runtimeId, fromStates, toState)` | Compare-and-set lifecycle transition; returns false when the entry is not in an expected state. |
| `isOwned` / `isReserved` / `getReservation` | Ownership queries used by creation and deletion paths. |
| `isOwnedBy(runtimeId, token)` | Fencing check: does this token still own the registration? |
| `findOwnedByStrategy(strategyName)` | Deletion gate: registered (any phase) + reserved runtimes of a strategy. |
| `claimStrategyDeletion({strategyName,userId})` | Exclusive deletion claim taken *before* the DB delete. Rejects when the strategy owns a runtime/reservation (`STRATEGY_OWNED_BY_RUNTIME`) or is already being deleted (`STRATEGY_DELETE_IN_PROGRESS`). |
| `releaseStrategyDeletion(token)` | Releases the deletion claim (token-scoped) — success, DB failure or 404. |
| `delete(runtimeId, {token})` | Removes an entry; with a token it refuses unless the token still owns it. |
| `registeredEntries()` | Lifecycle operations (includes entries still tearing down). |
| `set()` | Refuses to overwrite a live entry and refuses to register over a pending reservation. |

**Claims do not expire.** A reservation lives in this process's memory and
disappears with the process, so a fixed TTL could only ever mistake a slow boot for
a dead one. Every claim is released by its owner (commit, rollback, abort, explicit
release) or by process exit.

**Fencing.** Every claim carries a token and every committed entry records
`ownerToken`. `delete(id, {token})` and `releaseReservation(token)` only act when
the token still matches, so a boot that lost its claim cannot delete or release a
newer owner's state.

**Creation (one controlled operation):** `reserve` → load settings → create broker →
`initialize` → reconcile → abort check → `commitReservation` → wire instance → warmup →
`stateManager`/`bus`. Any failure runs `_rollbackBoot()`: if the boot committed, the
entry is CAS-moved to STOPPING and stripped of its collaborators (so it cannot be
dispatched to) while the registry still refuses new creations for the identity; then
the broker and instance are destroyed, the entry is removed with the boot's token
(only if that token still owns it), and finally the claim is released. A failed boot
therefore never exposes a half-initialized runtime and never blocks a later retry.

**Termination:** one operation per identity at a time via an in-flight promise map
(no timers/locks). Unregistered + reserved → request abort, return false. Unregistered +
unreserved → false. Otherwise CAS `ACTIVE|PAUSED|WARMING_UP → STOPPING`, then unsubscribe,
destroy instance, destroy broker. Cleanup failures are collected in
`entry.cleanupFailures`, the entry stays registered (marked STOPPING) and `terminate()`
returns false, so no caller can report success. Removal is fenced by the entry's
`ownerToken`; if the entry is no longer owned the stop is reported as unconfirmed. A
later call retries the steps that still hold resources.

**Deletion:** `DELETE /api/strategies/:id` resolves the user-scoped id, refuses (403,
unchanged message) when `findOwnedByStrategy()` returns anything owned by that user or the
state ledger says the strategy is busy, then takes `claimStrategyDeletion()` (409
`DELETE_IN_PROGRESS` if another delete holds it) and only then deletes the row. While the
claim is held, `reserve()` refuses new runtimes for that strategy, so no creation can land
between the check and the DELETE. The claim is released on success, on 404 and on DB
failure, so a failed delete never blocks a later delete or start. Response shapes are
unchanged apart from the new 409 conflict.

## 3. Changed files

| File | Change |
|---|---|
| `engine/core/runtime/RuntimeRegistry.js` | Reservation ledger, ownership API, fencing tokens (`ownerToken`, `isOwnedBy`, token-checked `delete`), CAS transition, duplicate-registration guard, deletion claims (`claimStrategyDeletion`/`releaseStrategyDeletion`), live-entry queries, `registeredEntries()`, `findOwnedByStrategy()`, `pendingSize`, `deletionClaimCount`. |
| `engine/core/runtime/RuntimeLifecycle.js` | Reserve/commit/rollback in `boot()`, abort-aware boot, ownership-fenced `_rollbackBoot()` (STOPPING → strip collaborators → destroy → remove own entry → release claim), `destroyQuietly()`, serialized + idempotent `terminate()` with `cleanupFailures` and fenced removal. |
| `engine/strategyLoader.js` | Ownership-based start gate (`has` → already running, `isReserved` → `START_IN_PROGRESS`), race reasons mapped to `START_IN_PROGRESS`/`STRATEGY_BEING_DELETED`, stop targets from `registeredEntries()`, cleanup-failure logging, `getActiveSymbols()` fixed to `all()`. |
| `engine/routes/strategyController.js` | Registry-authoritative `isStrategyBusy`, ownership-filtered delete gate, deletion claim taken before the DELETE and released on every outcome, 409 on claim contention. |
| `engine/routes/executionController.js` | `STRATEGY_BEING_DELETED` mapped to HTTP 409 alongside `START_IN_PROGRESS`. |
| `test/runtimeOwnership.test.js` | New: 19 tests (see below). |

## 4. Tests

`test/runtimeOwnership.test.js` exercises the real registry, lifecycle and DELETE
handler; only the broker factory (`corex-broker-contract`), the market-data feed/provider
(`@data`), the DB facade and the loader facade are mocked. The ownership mechanism is never
mocked.

| # | Scenario | Result |
|---|---|---|
| 1 | Two simultaneous creations of one runtimeId | one owner, loser rejected `already owned`, one broker created |
| 2 | Failed initialization | reservation released, broker destroyed, same identity immediately reusable |
| 3 | Successful creation/activation | registered ACTIVE, instance attached, feed subscribed, no reservation left |
| 4a | Terminate during creation | boot aborted, nothing registered, broker destroyed |
| 4b | Two concurrent terminates | one shared cleanup, identical outcome, single destroy |
| 5 | Repeated termination | true, then false, then false; one destroy/unsubscribe |
| 6 | Delete during creation and during run | 403 both times, no DELETE issued |
| 7 | Failed termination then delete | entry stays STOPPING with `cleanupFailures`, delete 403, retry succeeds |
| 8 | Delete with no runtime | purge + `invalidate`, registry untouched |
| 9 | User isolation | foreign delete is 404 and cannot see u1's runtime; same symbol/mode still free for another account |
| 10 | Recreate after failed creation and after deletion | both succeed with a new instance |
| 13 | Slow boot vs competing boot | claim survives an arbitrarily aged `createdAt`; competitor rejected `already owned`; the slow boot still commits |
| 14 | Stale boot vs newer boot | `delete(id, {token: stale})` returns false and the newer entry/instance survive; the owner's token removes it |
| 15 | Post-registration failure | during rollback cleanup the entry is owned but not dispatchable (STOPPING, excluded from `forSymbol`); afterwards nothing is owned and the instance was destroyed |
| 16 | Deletion claim vs creation | `reserve()` rejects with `RUNTIME_DELETION_IN_PROGRESS`; nothing registered; release lifts the block |
| 17 | Creation reservation vs deletion claim | `claimStrategyDeletion()` rejects `STRATEGY_OWNED_BY_RUNTIME`; no claim left behind |
| 18 | DB delete failure | 500 `DELETE_FAILED`, claim released, a later start succeeds |
| 19 | Two concurrent deletions | second gets 409 `DELETE_IN_PROGRESS`; first succeeds; claim released; later request 404 |
| 20 | Non-live entry | excluded from `all()`/`forSymbol()`/exclusivity, still registered |

### Commands and results (exact)

| Command | Suites | Tests | Result | Time |
|---|---|---|---|---|
| `node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js` | 1 | 19 | 19 passed | ~16 s |
| `node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js test/runtimeExclusivity.test.js` | 2 | 23 | 23 passed | 17.036 s |
| `npm test` (after corrections) | 60 | 645 | 645 passed | 55.106 s |

Baseline before this task: 59 suites / 626 tests (PR #62). Delta: +1 suite, +19 tests,
exactly the new file.

Earlier runs on the first revision of this branch (kept for history): targeted 2 suites /
17 tests; `npm test` 60 suites / 639 tests (one unrelated `packages/corex-gateway/test/socketx.test.js`
flake in run 1, green in isolation and on rerun).

`--runInBand` is used for targeted runs; `npm test` runs the default configuration and is
the recorded baseline. Jest leaves open handles in some suites, hence `--forceExit` on
targeted runs.

## 5. Remaining limitations

1. **Per-process ownership.** Reservations are in-memory. Two engine processes sharing one
   database could each start the same runtime. A cross-process lease (DB row or advisory
   lock) was not added: there is no evidence the deployment runs multiple engine instances,
   and the task forbids new schema/locking without that evidence.
2. **`strategyLoader.startStrategy` has no unit coverage.** It needs the compiler and the DB;
   the ownership gate inside it (`has`/`isReserved` → `alreadyRunning`/`START_IN_PROGRESS`,
   deletion claim → `STRATEGY_BEING_DELETED`) is verified indirectly through the registry and
   lifecycle tests only.
3. **`stateController` remains a second status source.** The deletion and stop paths now treat
   the registry as authoritative, but the UI status path still reads `stateController`
   (`runtimeService.getStatus`/`getAllStatus`). Reconciling that is out of scope here.
4. **No real PAPER/LIVE boot.** The broker factory is mocked in the new tests; no credentials
   exist in this checkout, so end-to-end creation with a real broker is unverified
   (synthetic/mocked I/O only).
5. **`terminate()` returns a boolean.** Cleanup failure is reported as `false` plus
   `entry.cleanupFailures`; the stop route maps `false` to 404 `STRATEGY_NOT_RUNNING`, which
   is less precise than the underlying cause. Changing that response shape was out of scope.
6. **Claims have no expiry and no crash recovery.** A claim is released by its owner or by
   process exit, so an in-process claim can never be stale, and a crashed process leaves no
   claim behind. What is *not* handled yet: a runtime persisted as ACTIVE whose process died
   is not reconciled on restart (that belongs to the state-recovery stage, not to ownership).
7. **Deletion claims are per-process only.** Two engine instances can each delete the same
   strategy row; the DB delete is idempotent there, but a cross-process delete lock would be
   needed for a hard guarantee.

## 6. Pre-existing issues observed but not changed

- `test/runtime-lifecycle-provider.test.js` (Stage 1 WIP) reads `entry.strategyInstance`
  while the registry stores `entry.instance`.
- `SignalProcessingEngine` risk limits (`maxDailyLossLimit` unused, `maxDrawdownThresholdPct`
  hardcoded) — untouched here.
- `engine/core/runtime/RuntimeRegistry.js` still creates a per-runtime `plotInterval`
  (unref'd); unchanged.