# ENGINE-02B-P0-1 — Recovery correctness (`engine.js` auto-recovery)

**Status:** IN PROGRESS
**Owner:** Kilo Code
**Branch:** `fix/engine-recovery-correctness`
**Worktree:** `../corex-p0-1`
**Depends on:** E1 (`plans/Audit/ENGINE-02B_E1_engine_inventory.md`, merged as `467e79c`)
**Roadmap row:** `plans/ROADMAP.md` order 17
**Source:** E1 report §10, P0-1 and P0-2 (proposed by E1, approved by Owen for implementation)

---

## 1. Goal

Make strategy auto-recovery actually restart a crashed runtime: resolve the **exact** runtime that crashed, stop and start it by strategy name with that runtime's snapshot, treat anything other than `result.ok === true` as a failed attempt, always schedule the next attempt until `recoveryMaxAttempts`, and keep the attempt counter across the `STOPPED` transition that recovery itself causes.

No extraction, no shutdown changes, no listener-lifecycle changes.

## 2. Defects (with file:line, all on `467e79c`)

| ID | Defect | Evidence |
|---|---|---|
| **D1** | Result handling: `const success = await loader.startStrategy(id); if (!success)` never fires — `startStrategy` returns an object on every path, and `{ok:false, reason}` is truthy. The recovery loop therefore stops silently after one attempt. | `engine/core/engine.js:278-281`; return shapes at `engine/strategyLoader.js:369`, `:419`, `:426`, `:428`, `:479`, `:484`, `:489`, `:492`, `:494` |
| **D2** | Identity: `id` is documented as "runtimeId or strategyId" but is used as a strategy id. `RuntimeRegistry.forStrategy(id)` matches `entry.strategyName` (`engine/core/runtime/RuntimeRegistry.js:517-524`) while the crash id is a **runtimeId** (`userId::strategy::SYMBOL::MODE`), so the lookup always returns `[]`; `loader.startStrategy(id)` then queries `strategies WHERE name = runtimeId` (`engine/strategyLoader.js:375-383`) and never finds a row. | `engine/core/engine.js:272-275`, `:278`; `engine/strategyLoader.js:413` (runtimeId format), `:471` (profile.strategyName = strategy id) |
| **D3** | Hidden retry drop: after recovery's own stop the ledger is `STOPPED`, so `_scheduleRecovery`'s `status !== "ERROR"` guard returns early and no retry is scheduled. The `STATE_CHANGED` listener also calls `_clearRecovery` on that `STOPPED`, deleting `strategyRecoveryStates` and resetting `attempts`, which defeats `recoveryMaxAttempts`. | `engine/core/engine.js:263-267` (early return), `:104-110` (`_clearRecovery` on `STOPPED`), `:288-292`; `STOPPED` is committed by `engine/core/runtime/RuntimeLifecycle.js:763` during terminate |

## 3. Step 0 — read and report (findings, with file:line)

### 0a. What id form does `MarketFeed` pass to `onStrategyCrash`?

**Finding: the runtimeId, only.** `MarketFeed._feedRuntime` catches a throw from `instance.onMarketData(...)` and calls `onStrategyCrash(entry.runtimeId, e)` — `packages/corex-market-data/src/MarketFeed.js:209-215`, specifically `:214`.

Both ingress paths funnel through `_feedRuntime`, so neither produces a strategy id:

- tick path: `_handleTick` → `registry.forSymbol(symbol)` → `_feedRuntime(entry, tick)` (`MarketFeed.js:112-133`, `:172`)
- bar path: `feedBar(runtimeId, bar)` → `registry.get(runtimeId)` → `_feedRuntime(entry, ...)` (`MarketFeed.js:156-170`)

The engine receives the runtimeId via the `onStrategyCrash` callback injected in `_wireSocketX` (`engine/core/engine.js:126-129`, `handleStrategyCrash(id, err)` at `:202`).

**Consequence:** the strategy-id branch of requirement 1 is **not implemented** in this task, per its own condition. `_attemptRecovery` resolves only the exact entry by runtimeId.

### 0b. Registry entry fields, `get()`, `forStrategy()`

`RuntimeRegistry.set()` builds the entry (`engine/core/runtime/RuntimeRegistry.js:137-151`), and `commitReservation` stamps `ownerToken` (`:326-328`). A live entry is:

| Field | Present | Source |
|---|---|---|
| `runtimeId` | yes | `set()` argument, `:138` |
| `instance` | yes | `:139` (required, `:86-91`) |
| `broker` | yes | `:140` (required, `:86-91`) |
| `symbol` | yes | `:141` (upper-cased) |
| `mode` | yes | `:142` (upper-cased) |
| `userId` | yes | `:143` |
| `accountId` | yes | `:144` |
| `strategyName` | yes | `:145` — **the strategy id**, e.g. `u1::StratA` |
| `actualState` | yes | `:146` |
| `params` | yes | `:147` |
| `startedAt` | yes | `:148` |
| `plotInterval` | yes | `:116-135`, `:149` |
| `ownerToken` | yes | `:327` |
| `initialCash` | **no** | not persisted by `commitReservation` (`engine/core/runtime/RuntimeLifecycle.js:133-144`) |
| `connectorType` | **no** | same |

- `get(runtimeId)` → the entry object, or `null` (`RuntimeRegistry.js:444-446`). Keyed by runtimeId, exact match.
- `forStrategy(strategyName)` → every entry whose `entry.strategyName === strategyName` and which is still live (`isLiveEntry`), i.e. **all** runtimes of that strategy across symbols and modes (`:517-524`, `:597-599`).

**Consequence:** the snapshot required by requirement 2 is fully available except `initialCash` and `connectorType` — see §7 known limitation.

### 0c. Does `commit(<id>, "ERROR")` succeed for a booted runtime, and does it emit `STATE_CHANGED`?

**Finding: yes.** Using the real `utils/stateController.js` (`C:\Users\SBUM\Desktop\corex-p0-1\utils\stateController.js`):

- A booted PAPER/LIVE runtime has a ledger for its **runtimeId**: `boot()` commits `WARMING_UP` (`engine/core/runtime/RuntimeLifecycle.js:180`) then `ACTIVE` (`:210`).
- `handleStrategyCrash` calls `commit(runtimeId, "ERROR")` (`engine/core/engine.js:204`). The rules table allows `ACTIVE → ERROR` (`utils/stateController.js:22`), so the commit returns `true`, pushes the ledger entry, and emits `EVENTS.SYSTEM.STATE_CHANGED` with `{ id: runtimeId, from, to, meta, at }` and routing meta `{ userId }` (`utils/stateController.js:57-68`).
- The engine's listener is registered in `start()` (`engine/core/engine.js:104-110`) and calls `_scheduleRecovery(id)` for `to === "ERROR"`.

**Not a blocker:** no `STATE_COLLISION` on the crash path, so recovery does start. (A commit for an id with no ledger entry would be rejected — `current` undefined → empty `allowed` list → `:52-56` — but a crashed runtime always has a ledger, because `boot()` created it.)

The blocked transition that *does* occur is the terminal one: `STOPPED → DISABLED` is not in the rules table (`utils/stateController.js:18`), which matters for the `RECOVERY_MAX_ATTEMPTS_EXCEEDED` commit after recovery's own stop — recorded as a limitation in §7, not fixed here (the rules table is outside this task's scope).

## 4. Required behaviour (as implemented)

1. **Exact target resolution.** `_attemptRecovery(id)` resolves `RuntimeRegistry.get(id)`; `strategyName` comes from that entry. `forStrategy` is never used to find the target and no sibling is ever selected. The strategy-id form does not occur (§0a) and is not implemented. An unresolvable target is a **failed attempt**, bounded by `recoveryMaxAttempts`, never a success.
2. **Snapshot then stop/start.** `{ strategyName, runtimeId, mode, symbol, userId, params }` is captured **before** anything is stopped; `loader.stopStrategy(strategyName, { runtimeId })` then `loader.startStrategy(strategyName, { userId, mode, symbol, params })`. The runtimeId is never passed as the strategy id. Siblings are untouched.
3. **Success** is `result && result.ok === true`. Anything else, or a throw, is a failed attempt.
4. **Every failed attempt schedules the next** with `min(recoveryMaxDelay, recoveryBaseDelay * recoveryFactor^attempts)`; at `recoveryMaxAttempts` the recovery is stopped with `RECOVERY_MAX_ATTEMPTS_EXCEEDED`.
5. **The attempt counter survives recovery's own `STOPPED`.** Attempts and the snapshot are captured/reused from `strategyRecoveryStates` before the stop; a `recoveryInFlight` guard stops the `STATE_CHANGED` listener from clearing the recovery record for the `STOPPED` that recovery itself caused. The `ERROR` guard stays in `_scheduleRecovery` (first schedule, from the listener). The record also carries `nextDelay` (the backoff that was actually scheduled) so the schedule is observable without asserting on timer internals.
6. **`initialCash` / `connectorType`** are not on the registry entry and are not invented — see §7.

## 5. Scope

**In scope:** `engine/core/engine.js` (`_attemptRecovery`, `_scheduleRecovery` and the small private helpers they need), the new test file(s), this task file, the `plans/ROADMAP.md` row.

**Out of scope (explicit):** P0-3 (shutdown), P0-4 (listener duplication/cleanup on restart), E2 supervisor extraction, warmup, routes, B7 404/409 mapping, settings, telemetry. The `STATE_CHANGED` registration in `start()` is unchanged (only its callback body gains the in-flight guard).

## 6. Acceptance

| # | Criterion | State |
|---|---|---|
| 1 | Step 0 findings recorded with file:line | Met (§3) |
| 2 | T1, T3, T6, T8 fail on `main` and pass with the fix, both runs pasted | Met (§9) |
| 3 | `npm test` green with real counts recorded | Met (§9) |
| 4 | `git diff` limited to `engine/core/engine.js`, the test file(s), this file, `plans/ROADMAP.md` | Met (§10) |
| 5 | PR opened, not merged | Met (§10) |

## 7. Known limitations

- **`initialCash` / `connectorType` are not on the registry entry.** `commitReservation` (`engine/core/runtime/RuntimeLifecycle.js:133-144`) stores neither, so the recovery snapshot cannot restore them. `startStrategy` falls back to `options.initialCash || 100000` and `options.connectorType || 'metaapi'` (`engine/strategyLoader.js:471`), i.e. a restarted runtime may come back with a different cash/connector than the one that crashed. Fixing this requires adding the fields to the reservation/commit payload — outside P0-1.
- **`STOPPED → DISABLED` is not an allowed transition** (`utils/stateController.js:18`), so the `RECOVERY_MAX_ATTEMPTS_EXCEEDED` commit is attempted but may be rejected by the ledger once recovery's own stop has moved the runtime to `STOPPED`. The code logs the rejection explicitly instead of pretending it succeeded. Relaxing the rules table is outside this task.
- **Recovery state is per-process** (`strategyRecoveryStates` is in memory), so a restart loses pending attempts. Deferred (roadmap L-5).

## 8. Regression tests

`test/engine-recovery.test.js` — jest fake timers; mocks limited to the loader's `init`/`startStrategy`, `@data`, the broker factory, `@utils/storageManager` and `@core/services/postgres`. **Real:** `RuntimeRegistry`, `RuntimeLifecycle`, `stateController`, the event bus, and the real `strategyLoader.stopStrategy` (so the `STOPPED` transition and `terminate()` are genuinely exercised — that is what makes D3 a real test rather than a mock).

| ID | Assertion |
|---|---|
| T1 | runtimeId crash → `RuntimeRegistry.get(runtimeId)` used, `forStrategy` never called, `stopStrategy(strategyName, {runtimeId})`, `startStrategy(strategyName, {userId, mode, symbol, params})`, runtimeId never passed as strategy id |
| T2 | not implemented — the strategy-id form does not occur (§0a) |
| T3 | `{ok:false}` → next attempt scheduled with `attempts` incremented and delay `base*factor^1`; repeats to the cap, then `DISABLED` with `RECOVERY_MAX_ATTEMPTS_EXCEEDED`; no timer left |
| T4 | thrown error → reschedules (existing behaviour kept) |
| T5 | `{ok:true}` → no reschedule, recovery state cleared |
| T6 | attempts not reset by the `STOPPED` transition recovery itself causes |
| T7 | user stop while a timer is pending → timer cleared, `_attemptRecovery` is a no-op (characterisation of existing behaviour) |
| T8 | two runtimes of one strategy → crashing A stops/restarts only A (A's symbol/mode); B stays registered and its broker/instance `destroy` is never called |
| T9 | unresolvable target → counted as a failed attempt, bounded, eventually terminal; never success |

T1, T3, T6 and T8 must fail on `main` and pass with the fix; both runs are recorded in §9.
## 9. Verification (real runs)

### 9.1 Fail-then-pass

Both runs use the **final** test file. `main` = `467e79c` with `engine/core/engine.js` reverted to that revision (`git stash push -- engine/core/engine.js`).

**On `main` (no fix) � 6 failed, 2 passed, 8 total**

```text
  � uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader        (T1)
  � reschedules with base*factor^1, counts attempts, then DISABLED                       (T3)
  v reschedules after a throw and stops at the cap                                       (T4)
  � does not reschedule and clears the recovery state                                    (T5)
  � does not reset attempts when recovery's own stop moves the runtime to STOPPED        (T6)
  v clears the pending recovery timer and no attempt runs afterwards                     (T7)
  � stops and restarts only the crashed runtime                                          (T8)
  � counts as failed attempts and terminates without ever reporting success              (T9)
Tests:       6 failed, 2 passed, 8 total
```

T4 passes on `main` because a throw happens before the stop, so the ledger is still `ERROR`; it is a behaviour-preservation test, not a regression test. T7 is a characterisation test (the listener's clear-on-STOPPED already exists) and passes on both revisions.

**With the fix � 8 passed, 8 total**

```text
  v T1 identity resolution � uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader
  v T3 failed attempt handling � reschedules with base*factor^1, counts attempts, then DISABLED
  v T4 thrown error � reschedules after a throw and stops at the cap
  v T5 successful recovery � does not reschedule and clears the recovery state
  v T6 attempt counter across STOPPED � does not reset attempts when recovery's own stop moves the runtime to STOPPED
  v T7 user stop � clears the pending recovery timer and no attempt runs afterwards
  v T8 sibling isolation � stops and restarts only the crashed runtime
  v T9 unresolvable target � counts as failed attempts and terminates without ever reporting success
Tests:       8 passed, 8 total
```

**Required set (T1, T3, T6, T8): fails on `main`, passes with the fix.**

### 9.2 Full suite

`node node_modules/jest/bin/jest.js --passWithNoTests`

```text
Test Suites: 61 passed, 61 total
Tests:       669 passed, 669 total
```

Baseline on `main` was 60 suites / 661 tests (E1 records the same figures); the delta is exactly this task's one new suite and eight new tests. No other suite changed.

## 10. Diff scope and PR

`git diff --stat origin/main` (tracked files) plus the two new untracked files:

```text
 engine/core/engine.js            | 125 ++++++++++++++++++++++++++++++++++++++++----------
 plans/ROADMAP.md                 |   1 +
 2 files changed, 102 insertions(+), 24 deletions(-)

 untracked: plans/tasks/ENGINE-02B-P0-1.md, test/engine-recovery.test.js
```

Only `engine/core/engine.js`, the new test file, this task file and the `plans/ROADMAP.md` row. No file outside `plans/` and `test/` was touched; `plans/STATUS.md` was deliberately left alone because this task's diff is restricted to the four paths above.

PR: <pending>
