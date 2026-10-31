# P0-05 — Persistence, Jobs and Runtime-State Audit

Status: READY
Suggested owner: Jules
Risk: High (read-only audit of protected data/runtime behavior)
Dependencies: P0-01
Output: `plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md`

## Objective
Identify authoritative persisted state, in-memory runtime state, database ownership and job lifecycle/recovery behavior without changing schemas or execution behavior.

## Scope
- Map migrations/tables to domains, readers, writers, foreign keys and account/user scoping.
- Trace transaction boundaries and persistence ordering for important state changes.
- Map runtime state machines, job enqueue/claim/run/retry/cancel/complete/fail transitions.
- Inspect idempotency, locking, stale-job recovery, process restart and shutdown behavior.
- Identify state held only in memory and explain whether it is intentionally ephemeral or a recovery gap.
- Trace backtest and live runtime persistence separately where behavior differs.

## Non-goals
- No migrations, SQL changes, data repair, production/dev DB writes or runtime refactors.
- Do not connect to a live environment or expose credentials.
- Do not change protected execution, broker, risk or recovery semantics.

## Procedure
1. Confirm the baseline commit and read current migration/database guidance.
2. Build a table ownership matrix from migrations and actual SQL call sites.
3. Trace job lifecycle from enqueue through terminal state and recovery.
4. Trace runtime lifecycle and persistence/reconstruction paths.
5. Use tests and safe read-only evidence; clearly label any database evidence unavailable in the environment.

## Deliverable
Create `plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md` with table ownership, writers/readers, transactions, state machine diagrams, retry/cancellation/recovery analysis, idempotency, restart gaps, evidence and decisions needed.

## Acceptance criteria
- [ ] Table ownership is tied to migrations and actual writers.
- [ ] Runtime/job transitions and terminal paths are traced.
- [ ] Persisted, reconstructed and ephemeral state are distinguished.
- [ ] Recovery and idempotency gaps are evidenced.
- [ ] No schema, data or runtime behavior changed.
- [ ] Missing environment access is recorded honestly.
