# ENGINE-02B-P0-1 — Recovery correctness (`engine.js` auto-recovery)

**Status:** PR OPEN � awaiting review (not merged)
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
4. **Every failed attempt schedules the next** with `min(recoveryMaxDelay, recoveryBaseDelay * recoveryFactor^attempts)`; at `recoveryMaxAttempts` the recovery stops and the terminal commit is made with `RECOVERY_MAX_ATTEMPTS_EXCEEDED`. `DISABLED` is reported **only if the state controller accepted it**; a rejected transition is logged as an error naming the reason and the current state (§7, §11).
5. **The attempt counter survives recovery's own `STOPPED`.** Attempts and the snapshot are captured/reused from `strategyRecoveryStates` before the stop; a `recoveryStopping` guard suppresses the `STATE_CHANGED` listener for the `STOPPED` that recovery itself caused. The `ERROR` guard stays in `_scheduleRecovery` (first schedule, from the listener). The record also carries `nextDelay` (the backoff that was actually scheduled) so the schedule is observable without asserting on timer internals.
6. **A stop request cancels recovery, and is never a failed attempt.** A `STOPPED` outside recovery's own stop window clears the recovery record for that runtime and, being a strategy-level intent, for the other runtimes of the same strategy. An attempt that finds its record gone (or finds the runtime already removed by a concurrent stop) stops without restarting, without rescheduling and without counting a failure. `_attemptRecovery` with no record at all is a no-op.
7. **`initialCash` / `connectorType`** are not on the registry entry and are not invented - see S7.

## 5. Scope

**In scope:** `engine/core/engine.js` (`_attemptRecovery`, `_scheduleRecovery` and the small private helpers they need), the new test file(s), this task file, the `plans/ROADMAP.md` row.

**Out of scope (explicit):** P0-3 (shutdown), P0-4 (listener duplication/cleanup on restart), E2 supervisor extraction, warmup, routes, B7 404/409 mapping, settings, telemetry. The `STATE_CHANGED` registration in `start()` is unchanged (only its callback body gains the in-flight guard).

## 6. Acceptance

| # | Criterion | State |
|---|---|---|
| 1 | Step 0 findings recorded with file:line | Met (S3) |
| 2 | T1, T3, T6, T8 fail on `main` and pass with the fix, both runs pasted | Met (S9) |
| 3 | Full Jest suite run, real counts recorded | Met (S9) |
| 4 | `git diff` limited to `engine/core/engine.js`, the test file(s), this file, `plans/ROADMAP.md` | Met (S10) |
| 5 | PR kept open on the same branch, no force-push, no new PR, not merged | Met (S10) |

## 7. Known limitations

- **`initialCash` / `connectorType` are not on the registry entry.** `commitReservation` (`engine/core/runtime/RuntimeLifecycle.js:133-144`) stores neither, so the recovery snapshot cannot restore them. `startStrategy` falls back to `options.initialCash || 100000` and `options.connectorType || 'metaapi'` (`engine/strategyLoader.js:471`), i.e. a restarted runtime may come back with a different cash/connector than the one that crashed. Fixing this requires adding the fields to the reservation/commit payload - outside P0-1.
- **`STOPPED -> DISABLED` is not an allowed transition** (`utils/stateController.js:18`). After recovery's own stop the runtime ledger is `STOPPED`, so the terminal `DISABLED` commit for `RECOVERY_MAX_ATTEMPTS_EXCEEDED` is rejected by the real state controller. The engine now verifies the commit result: it reports `DISABLED` only when the commit was accepted, and otherwise logs an explicit error naming the reason and the current state. **The rules table was not edited** - see S11.
- **A stop that lands inside recovery's own stop window is not observable.** `strategyLoader.stopStrategy` commits `STOPPED` only when `anyOk` (`engine/strategyLoader.js:566`), and the STOPPED that recovery's own stop produces is indistinguishable from a user stop landing in the same window. Closing that window needs a stop-request marker at the loader boundary - outside this task. What is covered: a stop that arrives before the attempt (timer pending) and a stop that arrives after recovery's stop has resolved (strategy-level STOPPED, including via a sibling runtime) both cancel the restart and are never counted as failed attempts.
- **Recovery state is per-process** (`strategyRecoveryStates` is in memory), so a restart loses pending attempts. Deferred (roadmap L-5).

## 8. Regression tests

`test/engine-recovery.test.js` - jest fake timers; mocks limited to the loader's `init`/`startStrategy`, `@data`, the broker factory, `@utils/storageManager` and `@core/services/postgres`. **Real:** `RuntimeRegistry`, `RuntimeLifecycle`, `stateController`, the event bus, and the real `strategyLoader.stopStrategy` (so the `STOPPED` transition and `terminate()` are genuinely exercised - that is what makes D3 a real test rather than a mock). `stateController.commit` is spied on only to observe calls; the state transitions themselves are real.

| ID | Assertion |
|---|---|
| T1 | runtimeId crash -> `RuntimeRegistry.get(runtimeId)` used, `forStrategy` never called, `stopStrategy(strategyName, {runtimeId})`, `startStrategy(strategyName, {userId, mode, symbol, params})`, runtimeId never passed as strategy id |
| T2 | not implemented - the strategy-id form does not occur (S0a) |
| T3 | `{ok:false}` -> next attempt with `attempts` incremented and `nextDelay = base*factor^attempts`; repeats to the cap; then the real final state is `STOPPED` (the `DISABLED` commit is rejected by the real state controller), the rejection is logged, the record is dropped, and nothing is rescheduled |
| T4 | thrown error -> reschedules (existing behaviour kept) |
| T5 | `{ok:true}` -> no reschedule, recovery state cleared |
| T6 | attempts not reset by the `STOPPED` transition recovery itself causes |
| T7a | user stop while a timer is pending -> timer and record cleared; a later direct `_attemptRecovery` is a no-op (no stop, no start, no timer, no record) |
| T7b | user stops the whole strategy while the restart is in flight -> recovery for the crashed runtime is cancelled, and a rejected restart does not reschedule |
| T7c | the runtime was already removed by a concurrent stop -> cancelled, never counted as a failed attempt |
| T8 | two runtimes of one strategy -> crashing A stops/restarts only A (A's symbol/mode); B stays registered and its broker/instance `destroy` is never called |
| T9 | unresolvable target -> counted as a failed attempt, bounded, eventually terminal; never success |

T1, T3, T6 and T8 must fail on `main` and pass with the fix; both runs are recorded in S9.

## 9. Verification (real runs)

### 9.1 Fail-then-pass

The `main` run uses `git checkout origin/main -- engine/core/engine.js` (true `467e79c` baseline, verified: no `_scheduleRetry`/`_cancelRecovery` in the file), with the final test file.

**On `main` (no fix) - 7 failed, 3 passed, 10 total**

```text
  x uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader        (T1)
  x reschedules with base*factor^1, counts attempts, then stops recovery at the cap       (T3)
  √ reschedules after a throw and stops at the cap                                        (T4)
  x does not reschedule and clears the recovery state                                     (T5)
  x does not reset attempts when recovery's own stop moves the runtime to STOPPED         (T6)
  √ clears the pending recovery timer, and a later _attemptRecovery is a no-op            (T7a)
  √ does not reschedule when a stop request for the strategy lands during the restart     (T7b)
  x treats a runtime removed by a concurrent stop as cancelled, not as a failed attempt   (T7c)
  x stops and restarts only the crashed runtime                                           (T8)
  x counts as failed attempts and terminates without ever reporting success               (T9)
Tests:       7 failed, 3 passed, 10 total
```

T4 and T7a pass on `main` by design (T4 is behaviour preservation, T7a characterises the listener's existing clear-on-STOPPED).

**With the fix - 10 passed, 10 total**

```text
  √ T1 identity resolution > uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader
  √ T3 failed attempt handling > reschedules with base*factor^1, counts attempts, then stops recovery at the cap
  √ T4 thrown error > reschedules after a throw and stops at the cap
  √ T5 successful recovery > does not reschedule and clears the recovery state
  √ T6 attempt counter across STOPPED > does not reset attempts when recovery's own stop moves the runtime to STOPPED
  √ T7 user stop > clears the pending recovery timer, and a later _attemptRecovery is a no-op
  √ T7 user stop > does not reschedule when a stop request for the strategy lands during the restart
  √ T7 user stop > treats a runtime removed by a concurrent stop as cancelled, not as a failed attempt
  √ T8 sibling isolation > stops and restarts only the crashed runtime
  √ T9 unresolvable target > counts as failed attempts and terminates without ever reporting success
Tests:       10 passed, 10 total
```

**Required set (T1, T3, T6, T8): fails on `main`, passes with the fix.**

### 9.2 Full suite

`node node_modules/jest/bin/jest.js --passWithNoTests`

```text
Test Suites: 61 passed, 61 total
Tests:       673 passed, 673 total
Time:        147.702 s
```

Baseline on `main` was 60 suites / 661 tests; the delta is exactly this task's suite (12 tests after the amendment). One earlier run showed 3 failures (`FileDataProvider`, `IncrementalIndicators`, `SoACandleStore`); all three pass in isolation and in the recorded re-run, so they are load-related flakes, not regressions from this change. The amended suite also failed once under a 4-way parallel full-suite run (the T3 timer assertion, see §12.4) and passed in every other run including the recorded green full suite.

## 10. Diff scope and PR

`git diff --stat` against the branch base (`467e79c` plus this task's earlier commit):

```text
 engine/core/engine.js         | 130 ++++++++++++++++++++++++++++++++++++++++++++++++-----
 engine/strategyLoader.js      |   9 +++
 test/engine-recovery.test.js  | 189 ++++++++++++++++++++++++++++++++++++++++++++++++--
 utils/stateController.js      |   5 +-
 4 files changed, 191 insertions(+), 14 deletions(-)
```

Only the four files named in the amendment changed in this round. No file outside `engine/core/engine.js`, `engine/strategyLoader.js`, `utils/stateController.js`, `test/engine-recovery.test.js` and `plans/` was touched, and `plans/STATUS.md` was deliberately left alone.

PR: https://github.com/ssemandaowen/corex_engine/pull/66 - OPEN, not merged. Head `fix/engine-recovery-correctness`; pushed with a normal `git push` (no force-push, no new PR).

## 11. Escalation - `STOPPED -> DISABLED` (approved, amended in)

This section was the escalation; Owen approved it with the P0-1 amendment. The transition is now made, exactly as approved:

```text
utils/stateController.js, rules table
- "STOPPED": ["STAGED", "WARMING_UP", "STOPPING"],
+ "STOPPED": ["STAGED", "WARMING_UP", "STOPPING", "DISABLED"],
```

Scope impact (unchanged from the escalation, still accurate):

- `utils/stateController.js` is a shared state machine used by the engine, the loader, the runtime lifecycle and the routes. Adding `DISABLED` as a legal target from `STOPPED` widens what every caller may commit, not only recovery. T11 now pins that this is the only change to the table.
- `DISABLED` is already reachable from `WARMING_UP`, `ACTIVE` and `ERROR` (`utils/stateController.js:19-24`), so the change only adds a terminal transition from an already-terminal state; it does not alter any existing legal path.
- It makes the recovery terminal state real (`RECOVERY_MAX_ATTEMPTS_EXCEEDED` persists on the runtime ledger) and removes the honest-rejection log path added in S7.
- `DISABLED` is now terminal: the only way out is `STAGED` (`utils/stateController.js:25`), which only the loader's `startStrategy` takes, and only for a manual restart (§12.3). Recovery itself never re-enables a disabled runtime.

## 12. Amendment - terminal DISABLED with a safe re-enable path

### 12.1 Changes

| # | File | Change |
| --- | --- | --- |
| 1 | `utils/stateController.js` | `STOPPED` gains `DISABLED`, with a comment naming recovery as the reason. No other rule touched. |
| 2 | `engine/core/engine.js` | The exhaustion commit now carries `attempts` alongside `reason`, on the runtimeId ledger `recovery` operates on. |
| 3 | `engine/strategyLoader.js` | `startStrategy` reopens the runtimeId ledger (`DISABLED -> STAGED`, reason `manual_restart_after_disable`) immediately before `lifecycle.boot()`. Nothing else in the loader changed. |
| 4 | `test/engine-recovery.test.js` | T3 strengthened, T10 and T11 added (see §12.3). |

The re-enable key is the `runtimeId`, because that is the ledger recovery writes to. The loader's `commit(id, "ACTIVE")` after boot uses the strategy id and is untouched.

### 12.2 Fail-then-pass

Baseline = the amendment reverted in the three source files (`git stash push -- engine/core/engine.js utils/stateController.js engine/strategyLoader.js`), tests kept.

**On main (amendment reverted) - T3 and T10 fail**

```text
  √ uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader
  × reschedules with base*factor^1, counts attempts, then stops recovery at the cap
  × boots through the real startStrategy and crashes back into recovery with a fresh counter
  × adds only STOPPED -> DISABLED to the rules table
Tests:       3 failed, 9 passed, 12 total
```

T1/T6/T7/T8 still pass in this run because the stash only reverts the amendment; the earlier round already recorded those failing on true `origin/main`.

**With the fix - 12 passed, 12 total**

```text
  √ T1 identity resolution > uses RuntimeRegistry.get(runtimeId) and passes the strategy name to the loader
  √ T3 failed attempt handling > reschedules with base*factor^1, counts attempts, then stops recovery at the cap
  √ T4 thrown error > reschedules after a throw and stops at the cap
  √ T5 successful recovery > does not reschedule and clears the recovery state
  √ T6 attempt counter across STOPPED > does not reset attempts when recovery's own stop moves the runtime to STOPPED
  √ T7 user stop > clears the pending recovery timer, and a later _attemptRecovery is a no-op
  √ T7 user stop > does not reschedule when a stop request for the strategy lands during the restart
  √ T7 user stop > treats a runtime removed by a concurrent stop as cancelled, not as a failed attempt
  √ T8 sibling isolation > stops and restarts only the crashed runtime
  √ T9 unresolvable target > counts as failed attempts and terminates without ever reporting success
  √ T10 re-enable after DISABLED > boots through the real startStrategy and crashes back into recovery with a fresh counter
  √ T11 state machine rules > adds only STOPPED -> DISABLED to the rules table
Tests:       12 passed, 12 total
```

### 12.3 What the new tests assert

- **T3 (strengthened).** `getStatus(runtimeId) === "DISABLED"`; the ledger tail entry is `DISABLED` with `meta.reason === "RECOVERY_MAX_ATTEMPTS_EXCEEDED"` and `meta.attempts === 3`; the rejection log path is gone; `strategyRecoveryStates` is empty; advancing 600000 ms produces no fourth start attempt.
- **T10.** Exhaustion → `DISABLED`; then the **real** `strategyLoader.startStrategy` with only the broker, feed, provider, DB and compiler boundary mocked: the ledger reads `WARMING_UP, ACTIVE, ERROR, STOPPED, DISABLED, STAGED, WARMING_UP, ACTIVE` and the runtime is registered and `ACTIVE`. A later crash schedules recovery with `attempts === 1` (fresh counter) and reaches 2 on the next delay.
- **T11.** The whole `rules` table is compared against the main baseline; the only reported difference must be `{ state: "STOPPED", added: ["DISABLED"], removed: [] }`.

### 12.4 Limitation - no exact `jest.getTimerCount() === 0`

T3 asserts the timer count is bounded by the pre-crash baseline, not `=== 0`. In this suite the `DISABLED` transition emits unrelated timers (boot plot interval, DB mocks, logger), so the count rises by ~4 per crash regardless of recovery; the exact-zero form is not reachable here. The substantive guarantee is covered behaviourally: the recovery record is deleted (it owns the only retry timer) and a 600 s advance produces no further attempt.

### 12.5 Limitation - stop-during-own-stop race (unfixed, B9)

If a stop request for the strategy lands while `_attemptRecovery` is awaiting `loader.stopStrategy()` and that stop already removed the runtime entry, the recovery sees a `false` stop result with no ledger record to cancel against, treats it as "nothing to stop", and still restarts the runtime. This is the loader-boundary blind spot recorded as **B9** in `plans/ROADMAP.md`; the fix needs a stop-request marker that survives the loader boundary, which this task does not implement. Risk is highest in LIVE mode (an unintended restart of a live runtime).

## 13. Session handoff

Last verified commit: `3a2bdbd` plus this amendment commit on `fix/engine-recovery-correctness`.

Changed in this round: `utils/stateController.js`, `engine/strategyLoader.js`, `engine/core/engine.js`, `test/engine-recovery.test.js`, `plans/tasks/ENGINE-02B-P0-1.md`, `plans/ROADMAP.md`.

Tests: `test/engine-recovery.test.js` 12/12; full suite 61 suites / 673 tests green (one load-related flake in T3, §12.4).

Next action: none inside P0-1. PR #66 is ready for review; B9 is the follow-up.
