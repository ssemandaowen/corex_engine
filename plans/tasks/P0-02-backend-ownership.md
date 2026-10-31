# P0-02 — Backend Ownership and Dependency Map

Status: REVIEW
Suggested owner: Kilo Code
Risk: Medium (read-only architectural audit)
Dependencies: P0-01
Output: `plans/architecture/BACKEND_OWNERSHIP_MAP.md`

## Objective
Map actual backend responsibility and dependency ownership from transport entry points through orchestration, domain behavior, adapters and persistence.

## Scope
- Trace routes/controllers to services, workers, domain modules, broker/data adapters and repositories.
- Inventory backend packages and legacy directories, public entry points and actual consumers.
- Identify large files, high-fan-in modules, mutable singletons, alias imports, deep imports, circular dependencies and duplicate implementations.
- Trace critical flows: startup, strategy lifecycle, market data, broker connection, execution/order handling, backtest lifecycle and persistence.
- Classify important files/modules: KEEP, MOVE, REBUILD, REPLACE, CONSOLIDATE or REMOVE, with evidence and reason.
- Record test ownership and missing behavioral coverage.

## Non-goals
- No code edits, file moves, deletions, package extraction or dependency changes.
- No architectural decision disguised as an audit recommendation.
- Do not infer ownership from directory names alone.

## Procedure
1. Read P0-01 baseline and confirm the inspected commit is still current.
2. Trace consumers and call paths from real entry points; inspect tests and manifests.
3. Record path/symbol-level evidence and distinguish observed facts from inference.
4. Identify cross-domain dependencies and ownership conflicts.
5. Propose disposition and migration risks without implementing them.

## Deliverable
Create `plans/architecture/BACKEND_OWNERSHIP_MAP.md` with a summary, domain/file ownership tables, critical flow traces, dependency violations, large-file/singleton inventory, test map, proposed dispositions and unresolved decisions.

## Acceptance criteria
- [ ] Important findings cite actual paths and symbols.
- [ ] Consumers and dependency direction are evidenced.
- [ ] Duplicate implementations are identified with parity/behavior questions.
- [ ] Proposed dispositions include rationale and migration risk.
- [ ] No source or runtime files changed.
- [ ] Follow-ups are proposed, not silently implemented.
