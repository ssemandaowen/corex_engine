# Phase 1: Database Evidence — Legacy Strategy Formats in the `strategies` Table

**Task:** Legacy Deletion — Step 0 boot fix prerequisite + Phase 1 DB evidence.
**Branch:** `chore/legacy-deletion` (from `origin/main`, never `main`).
**Date/Time:** 2026-10-03 21:5x (local Windows workstation).
**Repository:** https://github.com/ssemandaowen/corex_engine (package `corex_engine`, Apex Trait Ltd).

---

## 0. How this evidence was collected (provenance)

- **Tooling:** Node script `scripts/phase1-db-audit.js` using the app's own PostgreSQL service adapter (`engine/services/postgres.js`).
- **Auth:** The app's config mechanism (`DATABASE_URL` or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`); no secrets, connection strings, or passwords were printed or logged anywhere in this file.
- **Safety:** Every query ran inside `BEGIN READ ONLY; ... ; ROLLBACK;`. The session flag `transaction_read_only` was observed `= on` (verified), confirming no write path was reachable. The audit script itself hard-blocks any statement containing INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/TRUNCATE/GRANT/REVOKE/COPY/DO.
- **Pruning:** Only `strategies.id`, `strategies.name`, and classification flags were considered. `script_body` contents were **never printed**, and no user email / secret was exposed.

## 1. The table and its columns (from migrations)

The `strategies` table is created by migration `db/migrations/002_control_ledger.sql`, extended by:

| Migration | Change to `strategies` |
|---|---|
| `002_control_ledger.sql` | Base table: `id UUID`, `name VARCHAR(100) UNIQUE`, `description TEXT`, `created_at TIMESTAMPTZ` |
| `003_strategy_scripts.sql` | `script_body TEXT` added |
| `009_strategy_runtime.sql` | `runtime_params JSONB NOT NULL DEFAULT '{}'` added |
| `016_add_schema_to_strategies.sql` | `schema JSONB` added |
| `022_strategy_compile_cache.sql` | `compiled_hash TEXT`, `compiled_metadata JSONB`, index on `compiled_hash` |
| `024_strategy_runtime_state.sql` | `runtime_state_data JSONB DEFAULT '{}'`, GIN index on it (filtered to non-`{}`) |

**Full verified column list** (queried via `information_schema.columns`, ordered):
`id, name, script_body, schema, runtime_params, user_id, compiled_hash, runtime_state_data, created_at, updated_at`

**OBSERVED:** None of these columns is a foreign key or enum that encodes a base class or entrypoint. `script_body` is `TEXT` (verbatim source); `schema`, `runtime_params`, `runtime_state_data` are `JSONB`; `compiled_hash` is a hash string. The schema itself cannot force legacy-class usage — whatever the strategy author writes in `script_body` is what can be loaded.

## 2. Query environment

- **Database queried:** `corex_engine` on `localhost:5432` (default port; the development PostgreSQL instance shipped with the repo tooling — `D:/scoop/persist/postgresql/data`).
- **Role:** `postgres` (the role name, not a credential).
- **Environment classification:** This is the **development/local** environment (`corex_engine` on localhost). The `.env.example` template in the repo also names `PGDATABASE=corex_engine` on `PGPORT=5452` — a different port — which documents that multiple environments are possible, and that port/database pairs vary by deployment.

**OBSERVED:** The app's config can point at any database the env vars name; nothing in the repo pins "the" database.

## 3. Row counts and classification

### 3.1 Total

| Metric | Value |
|---|---|
| `SELECT COUNT(*) FROM strategies` | **0 rows** |

**OBSERVED:** The `strategies` table in the development `corex_engine` database is empty — no persisted strategies.

### 3.2 Classification (a–e)

The four classification questions were executed as regex scans of `script_body` (only IDs and names considered; bodies never printed):

| Class | Detection target | Rows found |
|---|---|---|
| (a) extends BaseStrategy / requires `utils/BaseStrategy` | `extends BaseStrategy`, `require('@utils/BaseStrategy')`, `require('BaseStrategy')` | **0** |
| (b) uses DeclarativeStrategy | `extends DeclarativeStrategy`, `require('@utils/DeclarativeStrategy')`, `require('DeclarativeStrategy')` | **0** |
| (c) legacy method definitions | `function next(`, `^next(` (method **definition**, not call site) | **0** |
| (d) new `corex-strategy-engine` API | `static params =`, `static indicators =`, `onStart(`, `onFill(`, `onStop(`, `ctx.go.`, `ctx.flat.`, `ctx.plot.`, `ctx.mark.` | **0** |
| (e) none / unclassifiable | — | **0** (no rows to classify) |

**OBSERVED — new API lifecycle methods, verified from package source** (`packages/corex-strategy-engine/src/Strategy.js:257`): the declarative strategy hooks are `onStart`, `onBar`, `onTick`, `onFill`, `onStop`. The new authoring surface is `static params` / `static indicators` plus `ctx.go.*` / `ctx.flat()` / `ctx.plot()` / `ctx.mark()`.

### 3.3 Metadata-column scan (runtime_params / schema / runtime_state_data)

- `schema` / `runtime_params` top-level JSONB keys: **0 rows** (nothing to scan).
- `runtime_state_data` top-level keys: **0 rows** (nothing to scan).
- Legacy-key hits in metadata columns (`BaseStrategy`, `DeclarativeStrategy`, `next`, `onBar`, `onTick`, `old`, `manifest`): **0**.

**OBSERVED:** No persisted strategy metadata in this environment references legacy base classes, legacy entrypoint names, or the old manifest format.

## 4. Interpretation

- **Classes a, b, c are ZERO.** Per the task GATE, this means Phase 2 deletions proceed fully (subject to the external-data caveat below).
- **Important scope note (OBSERVED, not a conclusion about production):** this evidence covers **one** database — the development `corex_engine` instance reachable on localhost:5432. The repo template also documents a different default (`PGPORT=5452`), and other deployments (production, staging, CI, Docker) are not queried here.

## 5. OPEN DECISION

**OPEN DECISION — repository cannot prove absence of legacy strategies in other environments.**

- The zero counts above apply only to the development `corex_engine` DB on `localhost:5432`.
- No artifact in the repo enumerates, or allows an agent to connect to, any production or other-environment `strategies` table. The `plans/decisions.md` record of 7 legacy rows deleted (2026-09-12) refers to this same development database.
- **I do not claim that production/other databases are empty.** A persisted strategy written against the legacy API could exist in a deployed environment that this audit cannot reach. Before deleting `BaseStrategy` support (the Phase 2 cascade), the owner should verify the production `strategies` table with the same read-only classification queries.

## 6. GATE RESULT

**GATE: PASSED** (for the audited environment).

- classes (a), (b), (c): all **zero** rows → Phase 2 deletions may proceed fully, including the `BaseStrategy` cascade (step 5), after the external-environment Open Decision is settled by the owner.
- class (d): 0 rows — no persisted strategy was found using the new API either; this is consistent with the empty table, not with a data-loss finding.
- Metadata columns: no legacy-key hits.

**Next action:** proceed to Phase 2 deletions (commit by commit). Record final status in `plans/STATUS.md`.

---

*Evidence ends. No code was changed. No secrets printed. All queries READ ONLY under `BEGIN READ ONLY; ROLLBACK;`.*
