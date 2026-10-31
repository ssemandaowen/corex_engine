# CoreX Work Status

> Last updated: 2026-10-31
> Active phase: Phase 0 — Establish the verified repository baseline
> Authoritative roadmap: `plans/COREX_DEVELOPMENT_PLAN.md`
> Coordination rules: `plans/AGENT_WORKFLOW.md`

This file is the **current ownership and progress dashboard**. It does not replace the roadmap or task specifications.

## Status vocabulary

`READY`, `CLAIMED`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, `CANCELLED`.

## Active task board

| ID | Task | Suggested owner | Status | Depends on | Output |
|---|---|---|---|---|---|
| P0-01 | Repository baseline | Kilo Code | READY | None | `plans/architecture/REPOSITORY_BASELINE.md` |
| P0-02 | Backend ownership and dependency map | Kilo Code | READY | P0-01 | `plans/architecture/BACKEND_OWNERSHIP_MAP.md` |
| P0-03 | Frontend architecture and behavior map | Jules | READY | None; verify baseline commit | `plans/architecture/FRONTEND_OWNERSHIP_MAP.md` |
| P0-04 | Cross-layer contract map | Kilo Code | READY | P0-02, P0-03, P0-05 | `plans/architecture/INTEGRATION_CONTRACT_MAP.md` |
| P0-05 | Persistence, jobs and runtime-state audit | Jules | READY | P0-01 | `plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md` |
| P0-06 | Test and known-issues baseline | Kilo Code | READY | P0-01 | `plans/architecture/QUALITY_BASELINE.md` |
| P0-07 | Existing plans and PR/branch reconciliation | Jules | READY | None; verify current main | `plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md` |

**Suggested owner is a proposed allocation, not a claim.** A task becomes CLAIMED only when the owner and branch are recorded here and in its task file.

## Execution constraints

- P0-01 is the first baseline task. P0-03 and P0-07 may be investigated independently after checking the current main commit.
- P0-02, P0-05 and P0-06 should use P0-01's verified baseline and avoid overlapping writes.
- P0-04 waits for the backend, frontend and persistence maps.
- Prefer read-only audits in parallel. Assign a single writer for shared files/branches.
- Phase 0 exit requires Owen to review P0-01 through P0-07. No broad rebuild is authorized before that gate.
- The old `plans/to_do.md` and PR #17 J1–J10 tracking proposal are historical inputs, not active task boards.

## Workstream / integration branch

| Item | Value |
|---|---|
| Documentation bootstrap branch | `docs/agent-task-system` |
| Integration owner | Kilo Code (proposed default; confirm before claiming) |
| Main branch | `main` (read-only for contributors) |
| PR policy | Milestone PRs; no PR per task session |

## Current blockers and decisions

- No P0 task is claimed by an agent in this dashboard yet.
- Confirm that all contributors can see this branch/PR before assigning work.
- Review existing open PRs as evidence; do not merge or close them as part of a read-only audit.
- Any protected architecture, broker/execution/risk behavior, database schema or public-contract change requires the approval specified in the roadmap.

## Recent handoffs

No task handoffs recorded yet. Add a dated handoff pointer here when an agent pauses or changes ownership; keep the full handoff inside the task file.

## Update discipline

Update this file and the matching task record on every claim, start, blocker, handoff, review and completion. Never mark a task DONE without acceptance evidence and review.
