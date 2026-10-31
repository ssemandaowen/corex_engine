# CoreX Work Status

> Last updated: 2026-10-31
> Active phase: Phase 0 — Current-state architecture audits
> Authoritative roadmap: `plans/COREX_DEVELOPMENT_PLAN.md`
> Coordination rules: `plans/AGENT_WORKFLOW.md`

This file is the **current ownership and progress dashboard**. It does not replace the roadmap or task specifications.

## Status vocabulary

`READY`, `CLAIMED`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, `CANCELLED`.

## Active task board

| ID | Task | Suggested owner | Status | Depends on | Output |
|---|---|---|---|---|---|
| P0-01 | Repository baseline | Kilo Code | DONE | None | `plans/architecture/REPOSITORY_BASELINE.md` |
| P0-02 | Backend ownership and dependency map | Kilo Code | REVIEW | P0-01 | `plans/architecture/BACKEND_OWNERSHIP_MAP.md` |
| P0-03 | Frontend architecture and behavior map | Jules | READY | None; verify baseline commit | `plans/architecture/FRONTEND_OWNERSHIP_MAP.md` |
| P0-04 | Cross-layer contract map | Kilo Code | READY | P0-02, P0-03, P0-05 | `plans/architecture/INTEGRATION_CONTRACT_MAP.md` |
| P0-05 | Persistence, jobs and runtime-state audit | Jules | READY | P0-01 | `plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md` |
| P0-06 | Test and known-issues baseline | Kilo Code | REVIEW | P0-01 | `plans/architecture/QUALITY_BASELINE.md` |
| P0-07 | Existing plans and PR/branch reconciliation | Jules | READY | None; verify current main | `plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md` |
| P1-00 | Consolidated architecture flow and independent review | Kilo Code (draft); Jules and Gemini (review) | READY | P0-01 through P0-07 reviewed by Owen | `plans/tasks/P1-00-architecture-flow-and-review.md` |

**Suggested owner is a proposed allocation, not a claim.** A task becomes CLAIMED only when the owner and branch are recorded here and in its task file.

## Execution constraints

- P0-01 is accepted and DONE. P0-02, P0-05 and P0-06 may now use its verified baseline. P0-03 and P0-07 may be investigated independently after checking the current main commit.
- P0-02, P0-05 and P0-06 should use P0-01's verified baseline and avoid overlapping writes.
- P0-04 waits for P0-02, P0-03 and P0-05 evidence.
- P1-00 is review/planning only; it does not authorize coding. Kilo, Jules and Gemini review independently, then Owen decides.
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

- Owen accepted P0-01 on 2026-10-31. PR #53 was squash-merged to `main` as `a97ae6359b0d1b960b19368e2bbff476e16b4405`.
- P0-02 audit has been submitted on `audit/p0-02-backend-ownership` and is in REVIEW; it has not been accepted or integrated. Latest reported revision: `9d57881b0b5b570b5390f4cf94bdbe3af2ac27f4`.
- P0-06 quality baseline/follow-up has been submitted on `followup/p0-06-verification` and is in REVIEW; latest reported revision: `31c8c5e34bc7140077f05306aa02d904afdce1a4`. The corrected auth test script remains unexecuted.
- PR #49 is useful frontend evidence but is not the exact P0-03 frontend ownership-map deliverable. PR #51 is useful README evidence; neither is accepted automatically.
- P0-04, P0-05 and P0-07 remain outstanding; do not restart P0-01.
- Review existing open PRs as evidence; do not merge or close them as part of a read-only audit.
- Any protected architecture, broker/execution/risk behavior, database schema or public-contract change requires the approval specified in the roadmap.

## Recent handoffs

### Acceptance — 2026-10-31 (P0-01)
Owner / decision: Owen Ssemanda
Status: DONE — accepted
Integrated PR: [#53](https://github.com/ssemandaowen/corex_engine/pull/53)
Merge commit: `a97ae6359b0d1b960b19368e2bbff476e16b4405`
Evidence: three documentation files merged; all seven task IDs remain on the dashboard; P0-01 acceptance record and correction metadata verified on `main`.
Decision: P0-02 is authorized to begin. Kilo must record its branch and claim before work starts.

### Handoff — 2026-10-31 (correction pass 3)
Owner / agent: Kilo Code
Status: REVIEW
Branch: audit/p0-01-repository-baseline
Audited base commit: 3aab1d71bd0c2554b519b2a099f8af6caccddf79
Initial P0-01 audit commit: fdcdd9f84babe4da3f6c2016f70feca4261d7956
First correction commit: c565d0492cbcbbd9e21c3d0a2eb0513445aee5df
Latest reviewed revision before this pass: 85533094243e1332bd8293fb0a21db68c0f4f856
Files changed: plans/architecture/REPOSITORY_BASELINE.md (updated); plans/STATUS.md (updated); plans/tasks/P0-01-repository-baseline.md (updated)
Completed: Third correction pass per final GitHub review. Restored full P0-01..P0-07 dashboard in STATUS.md (P0-01 REVIEW, P0-02..P0-07 READY). Removed duplicate data/ row. Softened all existence-only labels. Corrected section 6 lint row to agree with section 4. Added latest reviewed revision commit reference.
Commands and test results: Select-String/Test-Path verification only; no tests rerun (docs-only).
Unverified items / limitations: root cause of strategies alias unknown; schema.sql vs migrations relationship untraced; ownership/usage not traced for any directory.
Decisions needed: Owen review of corrected audit.
Blockers: None.
Exact next action: Owen reviews corrected audit and final diff; if accepted, integrate via PR #53.
May another agent continue? YES — read-only review only.

Owner / agent: Kilo Code
Status: REVIEW
Branch: audit/p0-01-repository-baseline
Audited base commit: 3aab1d71bd0c2554b519b2a099f8af6caccddf79
Initial P0-01 audit commit: fdcdd9f84babe4da3f6c2016f70feca4261d7956
First correction commit: c565d0492cbcbbd9e21c3d0a2eb0513445aee5df
Latest reviewed revision before this pass: 85533094243e1332bd8293fb0a21db68c0f4f856
Files changed: plans/architecture/REPOSITORY_BASELINE.md (updated); plans/STATUS.md (updated); plans/tasks/P0-01-repository-baseline.md (updated)
Completed: Second correction pass per independent GitHub MCP review. Fixed commit metadata, section 12 recommendations, ownership labels, strategies alias wording, lint documentation, handoff metadata.
Commands and test results: Select-String/Test-Path verification only; no tests rerun (docs-only).
Unverified items / limitations: root cause of strategies alias unknown; schema.sql vs migrations relationship untraced; ownership/usage not traced for any directory.
Decisions needed: Owen review of corrected audit.
Blockers: None.
Exact next action: Owen reviews corrected audit and final diff; if accepted, integrate via PR #53.
May another agent continue? YES — read-only review only.

### Planning handoff — 2026-10-31 (P1-00)
Owner / agent: ChatGPT — investigation and task draft
Status: READY FOR INDEPENDENT REVIEW
Branch: `planning/phase0-closeout-phase1-flow`
Last verified base: `435127546087f9d40486ea272cb337363ce0724e`
Task file: `plans/tasks/P1-00-architecture-flow-and-review.md`
Completed: Investigated the authoritative roadmap, current source boot/runtime/backtest/job paths, package entry points, P0 review branches and relevant PR #49/#51 evidence. Drafted the current flow, candidate target interaction flow, minimal Phase 0 closeout sequence, Phase 1 design order, implementation dependency order and independent review protocol.
Commands and test results: Read-only GitHub source/document inspection; no tests run; no source files changed.
Limitations: P0-02 remains a provisional review artifact; P0-03/P0-04/P0-05/P0-07 are not accepted deliverables; exact end-to-end broker/portfolio persistence path still needs contract tracing.
Exact next action: Kilo, Jules and Gemini review P1-00 independently; no coding until Owen approves.
May another agent continue? YES — read-only review only.

## Update discipline

Update this file and the matching task record on every claim, start, blocker, handoff, review and completion. Never mark a task DONE without acceptance evidence and review.
