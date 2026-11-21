# Strategy lifecycle: PostgreSQL → runtime, and why deleted strategies reappeared

**Date:** 2026-11-15
**Base:** `origin/main` @ `6d35335`
**Status:** investigation only — no code changed
**Question asked:** map the full strategy lifecycle, and establish why deleted strategies could previously reappear, before adding any caching or persistence infrastructure.

---

## 1. The lifecycle as implemented

| Stage | Where | Durable effect |
| --- | --- | --- |
| Create / update | `engine/routes/strategyController.js:176` (`INSERT INTO strategies ... ON CONFLICT (name) DO UPDATE`) | `strategies` row |
| Compile cache | `engine/strategyLoader.js:132-213` (`_compileAndRegisterMeta`) | `strategies.schema`, `compiled_hash`, `compiled_metadata` (UPDATE) |
| Start | `engine/strategyLoader.js:395-507` (`startStrategy`) | `strategy_runtimes` row upserted `ACTIVE` (`_saveRuntimeDesiredState`, 289-298); `strategies.runtime_mode`, `runtime_state='RUNNING'` (506) |
| Stop | `engine/strategyLoader.js:509-583` (`stopStrategy`) | `strategy_runtimes.actual_state='STOPPED'` (304-310); `strategies.runtime_state='STOPPED'`; meta dropped after a 5-minute delay (585-591) |
| Boot restore | `engine/strategyLoader.js:143` → `255-282` | reads `strategy_runtimes WHERE actual_state='ACTIVE'` and calls `startStrategy` per row |
| Delete | `engine/routes/strategyController.js:283-335` | `DELETE FROM strategies WHERE name = $1` only |

Notes that matter later:

- The restore set is **`strategy_runtimes`**, not `strategies`. `strategies` says *what code exists*; `strategy_runtimes` says *what should be running*.
- `_metaRegistry` is a process-local compile cache, and it is only dropped on stop (delayed 5 min) or on explicit `invalidate(id)`.
- `strategy_runtimes` has **no foreign key to `strategies`** (keyed by `runtime_id`, strategy held as a plain `strategy_name` column), so nothing removes it when a strategy is deleted.

## 2. What a delete actually removes

`DELETE /api/strategies/:id` (`strategyController.js:319-323`):

```sql
DELETE FROM strategies WHERE name = $1
```

| Data | Removed? | Evidence |
| --- | --- | --- |
| `strategies` row | yes | `strategyController.js:319` |
| `strategy_versions` | yes, `ON DELETE CASCADE` | `schema.sql:1575` |
| `strategy_runtimes` | **no** — no FK, no explicit delete | `schema.sql:466-481`, only writers are `strategyLoader.js:292/307` |
| `strategy_ticks`, `strategy_signals` | **no** — name-keyed, no FK | `schema.sql` (no FK onto `strategies`) |
| `orders` | blocks the delete | `schema.sql:1543` `orders_strategy_id_fkey` has no cascade, so a strategy with orders raises an FK violation → 500 `DELETE_FAILED` |
| `_metaRegistry` entry | dropped by `loader.invalidate(id)` | `strategyController.js:325` → `invalidateMeta` |

So "deleted" today means *the code row is gone*; the desired-state row survives.

## 3. Why deleted strategies reappeared

The reappearance is **not** reproducible from the current code through the restore path. Verified:

1. The list reads `strategies` only (`strategyController.js:54-58`), so a deleted strategy cannot be listed.
2. The boot restore reads `strategy_runtimes` (`strategyLoader.js:262-267`). For an orphaned row it calls `startStrategy(id)`, which finds no `_metaRegistry` entry, queries `strategies`, gets no row and throws `Strategy '<id>' not found in DB` (383). The catch returns `{ ok: false }` (509-521). No runtime is created; the restore loop logs a warning (277) and repeats on every boot.

Therefore the observed reappearance has exactly one shape that fits: **the `strategies` row was inserted again**, not restored. All insert paths are name-keyed upserts, so a stale source recreates the strategy verbatim:

| Source | Where | Trigger |
| --- | --- | --- |
| Client save/upload | `strategyController.js:176` (`ON CONFLICT (name) DO UPDATE`) | a client still holding the strategy in its editor/list re-saves it |
| Migration script | `db/migrate_strategies_to_db.js:20` | re-running the one-off migration re-imports from files |
| Registration CLI | `engine/services/corex-reg.js:29` | `node engine/services/corex-reg.js <name> <file>` |

The dangerous interaction is with §2: because the orphaned `strategy_runtimes` row is still `ACTIVE`, a re-inserted `strategies` row makes the strategy **start again on the next boot** with no user action. From the user's side that is indistinguishable from "I deleted it and it came back". Delete-then-reregister is currently indistinguishable from a first registration.

A second, narrower reappearance path exists **inside one process**: `stopStrategy` schedules `_metaRegistry.delete(id)` five minutes out (`strategyLoader.js:585-591`). If a strategy is stopped and deleted within that window the delete wins (`invalidate`), so the delayed delete is a no-op — but the ordering is timing-dependent rather than causal, and any future reader of `_metaRegistry` before `invalidate` lands would see a strategy the database no longer has.

## 4. Durable state vs running state: the contradictions found

| # | Contradiction | Evidence | Impact |
| --- | --- | --- | --- |
| C1 | Orphaned `strategy_runtimes` `ACTIVE` rows survive strategy deletion | §2 | a warning on every boot; and automatic start if the strategy name is ever re-registered |
| C2 | `_clearRuntimeDesiredState` marks `STOPPED`, never deletes | `strategyLoader.js:304-310` | rows accumulate for every runtime identity ever used |
| C3 | Delete can fail on `orders_strategy_id_fkey` | `schema.sql:1543` | `DELETE_FAILED` 500 for any strategy with order history; the row stays deletable-looking in the UI |
| C4 | `strategy_ticks` / `strategy_signals` survive deletion | §2 | orphaned history keyed by a name that may later be re-registered, mixing old and new data |
| C5 | Restore failure is a warning, not a reconciliation | `strategyLoader.js:277` | a stale desired state is retried forever instead of being corrected |

C1 and C5 are the same defect seen from two sides: nothing ever reconciles `strategy_runtimes` against `strategies`.

## 5. Recommended order of work

1. **Reconcile at boot, before restoring** (fixes C1, C5). Drop or mark `STOPPED` the `strategy_runtimes` rows whose `strategy_name` has no `strategies` row, then restore the remainder. This is the change that was staged in the dirty tree and never landed (`plans/Audit/BASELINE.md:51`).
2. **Delete the desired state with the strategy** (fixes C1, C2). Delete `strategy_runtimes` rows for the strategy inside the same transaction as the `strategies` delete.
3. **Decide the fate of ticks/signals** (C4) — an explicit retention decision, not an incidental one.
4. **Order history vs deletion** (C3) — either soft-delete strategies, or cascade/settle orders. Needs Owen's decision; it changes what "delete" means.

No new cache, no new persistence layer: the contradiction is an ordering gap between two existing tables, not a missing store.

## 6. Verification status

- Code-verified: every claim above is read from `6d35335` at the cited file:line.
- Not verified against a live PostgreSQL instance: the `orders` FK behaviour (C3) and the actual orphan rows in the deployed database. Both need a real database (`psql`/migration environment) and are listed as human verification, per `AGENTS.md` §10.
- No test yet covers "a deleted strategy cannot be restored"; that belongs with fix 1.