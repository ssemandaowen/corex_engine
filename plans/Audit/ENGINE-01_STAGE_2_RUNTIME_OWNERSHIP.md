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
two ledgers:

- `_runtimes` — live runtimes (`set` / `delete` / queries).
- `_reservations` — ownership claims for creations in flight.

Ownership API (no timers used as concurrency protection):

| Method | Purpose |
|---|---|
| `reserve({runtimeId,userId,accountId,strategyName,symbol,mode,owner})` | Claims the identity. Rejects: already registered, already reserved, or same account/symbol/mode already ACTIVE or reserved. Returns an unguessable token. Throws `code: RUNTIME_ALREADY_OWNED` / `RUNTIME_EXCLUSIVITY_VIOLATION`. |
| `commitReservation(token, entry)` | Atomically converts the claim into a registered runtime (reservation released first, then `set`). Throws `RUNTIME_RESERVATION_LOST` if the claim is gone. |
| `releaseReservation(token)` | Rolls the claim back (token-scoped, so a stale boot cannot release someone else's claim). |
| `requestAbortReservation(token)` / `isAbortRequested(token)` | Lets `terminate()` abandon an in-flight creation; `boot()` observes it before registering. |
| `transition(runtimeId, fromStates, toState)` | Compare-and-set lifecycle transition; returns false when the entry is not in an expected state. |
| `isOwned` / `isReserved` / `getReservation` | Ownership queries used by creation and deletion paths. |
| `findOwnedByStrategy(strategyName)` | Deletion gate: registered (any phase) + reserved runtimes of a strategy. |
| `pruneStaleReservations(now)` | Recovers claims whose boot never returned (crash/hang). Called from `reserve()`; TTL `COREX_RUNTIME_RESERVATION_TTL_MS`, default 120000 ms, validated and clamped (1 s … 1 h). |
| `registeredEntries()` | Lifecycle operations (includes entries still tearing down). |
| `set()` | Now refuses to overwrite a live entry and refuses to register over a pending reservation. |

**Creation (one controlled operation):** `reserve` → load settings → create broker →
`initialize` → reconcile → abort check → `commitReservation` → wire instance → warmup →
`stateManager`/`bus`. Any failure runs `_rollbackBoot()`: release claim, remove any
registered entry, unsubscribe from the feed, destroy the broker, destroy the instance
(when it had been registered), then rethrow the original error.

**Termination:** one operation per identity at a time via an in-flight promise map
(no timers/locks). Unregistered + reserved → request abort, return false. Unregistered +
unreserved → false. Otherwise CAS `ACTIVE|PAUSED|WARMING_UP → STOPPING`, then unsubscribe,
destroy instance, destroy broker. Cleanup failures are collected in
`entry.cleanupFailures`, the entry stays registered (marked STOPPING) and `terminate()`
returns false, so no caller can report success. A later call retries the steps that still
hold resources.

**Deletion:** `DELETE /api/strategies/:id` resolves the user-scoped id, refuses (403,
unchanged message) when `findOwnedByStrategy()` returns anything owned by that user, deletes
the row, then re-checks ownership; if a creation landed during the delete it stops those
runtimes and returns 500 `DELETE_FAILED` instead of reporting a clean purge.

## 3. Changed files

| File | Change |
|---|---|
| `engine/core/runtime/RuntimeRegistry.js` | Reservation ledger, ownership API, CAS transition, duplicate-registration guard, stale-reservation pruning, live-entry queries, `registeredEntries()`, `findOwnedByStrategy()`, `pendingSize`. |
| `engine/core/runtime/RuntimeLifecycle.js` | Reserve/commit/rollback in `boot()`, abort-aware boot, `_rollbackBoot()`, `destroyQuietly()`, serialized + idempotent `terminate()` with `cleanupFailures`. |
| `engine/strategyLoader.js` | Ownership-based start gate (`has` → already running, `isReserved` → `START_IN_PROGRESS`), race reasons mapped to `START_IN_PROGRESS` (HTTP 409), stop targets from `registeredEntries()`, cleanup-failure logging, `getActiveSymbols()` fixed to `all()`. |
| `engine/routes/strategyController.js` | Registry-authoritative `isStrategyBusy`, ownership-filtered delete gate, delete-race detection, async handler with unchanged response shapes. |
| `test/runtimeOwnership.test.js` | New: 13 tests (see below). |

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
| 11 | Stale reservation | cannot block creation past the TTL |
| 12 | Non-live entry | excluded from `all()`/`forSymbol()`/exclusivity, still registered |

### Commands and results (exact)

| Command | Suites | Tests | Result | Time |
|---|---|---|---|---|
| `node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js` | 1 | 13 | 13 passed | ~16 s |
| `node node_modules/jest/bin/jest.js --runInBand --forceExit test/runtimeOwnership.test.js test/runtimeExclusivity.test.js` | 2 | 17 | 17 passed | ~16 s |
| `npm test` (run 1) | 60 | 639 | 638 passed, 1 failed | 95.209 s |
| `npm test` (run 2) | 60 | 639 | 639 passed | 76.067 s |

Baseline before this task: 59 suites / 626 tests (PR #62). Delta: +1 suite, +13 tests,
exactly the new file.

Run-1 failure: `packages/corex-gateway/test/socketx.test.js` — passes in isolation
(1 suite / 22 tests) and on run 2; timing/port-sensitive under parallel workers, unrelated
to this change (no gateway file is touched here). Same class of flake as
`test/IncrementalIndicators.test.js` recorded in the P0 baseline.

`--runInBand` is used for targeted runs; `npm test` runs the default configuration and is
the recorded baseline. Jest leaves open handles in some suites, hence `--forceExit` on
targeted runs.

## 5. Remaining limitations

1. **Per-process ownership.** Reservations are in-memory. Two engine processes sharing one
   database could each start the same runtime. A cross-process lease (DB row or advisory
   lock) was not added: there is no evidence the deployment runs multiple engine instances,
   and the task forbids new schema/locking without that evidence.
2. **Delete-race handling is corrective, not preventive.** A creation that reserves the
   identity between the ownership check and the DB delete is stopped and reported as
   `DELETE_FAILED` (HTTP 500) rather than blocked up front. Preventing it would need a
   per-strategy creation guard held across the DB call.
3. **`strategyLoader.startStrategy` has no unit coverage.** It needs the compiler and the DB;
   the ownership gate inside it (`has`/`isReserved` → `alreadyRunning`/`START_IN_PROGRESS`)
   is verified indirectly through the registry and lifecycle tests only.
4. **`stateController` remains a second status source.** The deletion and stop paths now treat
   the registry as authoritative, but the UI status path still reads `stateController`
   (`runtimeService.getStatus`/`getAllStatus`). Reconciling that is out of scope here.
5. **No real PAPER/LIVE boot.** The broker factory is mocked in the new tests; no credentials
   exist in this checkout, so end-to-end creation with a real broker is unverified
   (synthetic/mocked I/O only).
6. **`terminate()` returns a boolean.** Cleanup failure is reported as `false` plus
   `entry.cleanupFailures`; the stop route maps `false` to 404 `STRATEGY_NOT_RUNNING`, which
   is less precise than the underlying cause. Changing that response shape was out of scope.
7. **Reservation TTL is a recovery bound, not a timeout on initialization.** A boot that
   hangs longer than `COREX_RUNTIME_RESERVATION_TTL_MS` loses its claim and can no longer
   register (it fails with `RUNTIME_RESERVATION_LOST`); that is intentional — the alternative
   is a permanently blocked identity.

## 6. Pre-existing issues observed but not changed

- `test/runtime-lifecycle-provider.test.js` (Stage 1 WIP) reads `entry.strategyInstance`
  while the registry stores `entry.instance`.
- `SignalProcessingEngine` risk limits (`maxDailyLossLimit` unused, `maxDrawdownThresholdPct`
  hardcoded) — untouched here.
- `engine/core/runtime/RuntimeRegistry.js` still creates a per-runtime `plotInterval`
  (unref'd); unchanged.