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
| P0-02 | Backend ownership and dependency map | Kilo Code | READY | P0-01 | `plans/architecture/BACKEND_OWNERSHIP_MAP.md` |
| P0-03 | Frontend architecture and behavior map | Jules | READY | None; verify baseline commit | `plans/architecture/FRONTEND_OWNERSHIP_MAP.md` |
| P0-04 | Cross-layer contract map | Kilo Code | READY | P0-02, P0-03, P0-05 | `plans/architecture/INTEGRATION_CONTRACT_MAP.md` |
| P0-05 | Persistence, jobs and runtime-state audit | Jules | READY | P0-01 | `plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md` |
| P0-06 | Test and known-issues baseline | Kilo Code | READY | P0-01 | `plans/architecture/QUALITY_BASELINE.md` |
| P0-07 | Existing plans and PR/branch reconciliation | Jules | READY | None; verify current main | `plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md` |
| P3-04 | Broker folder ownership cleanup & Socket_X integration audit | Kilo Code | REVIEW | P0-01 | `plans/tasks/P3-04-broker-ownership-cleanup.md` |
| ENGINE-01 S2 | Atomic runtime ownership | Kilo Code | REVIEW (S2-FIX-3) | ENGINE-01 P0 (PR #62) | `plans/tasks/ENGINE-01-STAGE-2.md` |

**Suggested owner is a proposed allocation, not a claim.** A task becomes CLAIMED only when the owner and branch are recorded here and in its task file.

## Execution constraints

- P0-01 is accepted and DONE. P0-02, P0-05 and P0-06 may now use its verified baseline. P0-03 and P0-07 may be investigated independently after checking the current main commit.
- P0-02, P0-05 and P0-06 should use P0-01's verified baseline and avoid overlapping writes.
- P0-04 waits for the backend, frontend and persistence maps.
- Prefer read-only audits in parallel. Assign a single writer for shared files/branches.
- Phase 0 exit requires Owen to review P0-01 through P0-07. No broad rebuild is authorized before that gate.
- P3-04 is Owen-directed bounded cleanup on the dedicated `fix/p3-04-broker-ownership` branch (the original `fix/upload-multipart-transport` branch is already PR #58 for unrelated upload work). It removes verified duplicate broker paths only; it does not authorize a full execution-authority rebuild.
- ENGINE-01 S2 is Owen-directed runtime-ownership implementation on `engine-01/stage-2-runtime-ownership` (branched from `origin/main` @ `8dd6048`, which includes PR #62). `RuntimeRegistry` is the single authoritative runtime owner; the registry-based reservation/commit/abort protocol and the registry-authoritative deletion gate must not be duplicated in another module.
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
- P0-02 is approved to begin. It remains READY until Kilo records its workstream branch and claims it in this dashboard and task file.
- P3-04 is claimed by Kilo Code on `fix/p3-04-broker-ownership` (Owen-directed 2026-11-14; branched from `origin/main` @ `1d67733`). It is bounded to verified broker-folder ownership cleanup and does not change protected broker/execution architecture.
- Review existing open PRs as evidence; do not merge or close them as part of a read-only audit.
- Any protected architecture, broker/execution/risk behavior, database schema or public-contract change requires the approval specified in the roadmap.
- Socket_X is not mounted by `engine/server.js`. Wiring it to the strategy execution authority remains a separate, unapproved task; see P3-04 evidence.

## Recent handoffs

### Handoff — 2026-11-14 (P3-04)
Owner / agent: Kilo Code
Status: REVIEW
Branch: `fix/p3-04-broker-ownership` (branched from `origin/main` @ `1d67733`)
Last verified commit: `29ee775`.
Files changed: broker package entry point; deleted `/broker` mirrors + dead backtest modules; deleted `engine/services/mt5Bridge.js`, `engine/core/runtime/RuntimeBrokerFactory.js`, `engine/core/runtime/MarketFeed.js`; market-data legacy singleton exposure; runtimeService broker lookup; MetaApiDriver connector selection; MT5 connector/bridge protocol mapping; tests; plans.
Completed: Repository investigation, consumer migration, verified deletions, confirmed MT5/driver fixes, regression tests, documentation, rebase onto `origin/main`.
Commands and test results: broker-contract 12/165 pass; market-data 6/70 pass; gateway 3/85 pass; strategy-engine 10/87 pass; portfolio 2/12 pass; root targeted 8 suites/97 tests pass; `node --check` pass; ESLint unavailable. Pre-existing unrelated failure remains in the untracked `test/runtime-lifecycle-provider.test.js`.
Unverified items / limitations: real MT5/MetaAPI execution; Socket_X transport (not mounted); end-to-end boot with credentials.
Decisions needed: MT5 transport selection; MetaApiConnector disposition; approval for separate Socket_X execution-authority design; reconcile with PR #60 / PR #26 which overlap this work.
Blockers: none for the cleanup.
Exact next action: review `29ee775`, decide the overlap with PR #60 / PR #26, then push and open the PR.
May another agent continue? YES — resume the task file and this dashboard.

### Handoff — 2026-11-14 (ENGINE-01 S2 / S2-FIX-3, PR #63)
Owner / agent: Kilo Code
Status: REVIEW
Branch: `engine-01/stage-2-runtime-ownership` (branched from `origin/main` @ `8dd6048`)
Last verified commit: see `git log -1` on the branch (S2-FIX-3 commit).
Files changed: `engine/core/runtime/RuntimeRegistry.js` (single owner, reserve/commit/abort, no TTL, fenced delete), `engine/core/runtime/RuntimeLifecycle.js` (ownership re-check after warmup, joinable serialized cleanup, orphan scope limited to uncommitted boots), `engine/strategyLoader.js`, `engine/routes/executionController.js`, `engine/routes/strategyController.js`, `test/runtimeOwnership.test.js`, plus `plans/tasks/ENGINE-01-STAGE-2.md`, `plans/STATUS.md`, `plans/KNOWN_ISSUES.md`, `plans/decisions.md`, `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.
Completed: (1) a stop during warmup aborts the boot (`RUNTIME_ABORTED`) before subscribe/activate/announce and is reported as `START_CANCELLED` (409); (2) rollback and terminate share one cleanup in either order, both resolving to `{ failures, finalized, joined? }`; (3) orphan destruction restricted to boots that never committed, so no collaborator is destroyed twice; (4) tests 33–35 added (33 tests total).
Commands and test results: targeted `test/runtimeOwnership.test.js` + `test/runtimeExclusivity.test.js` → 2 suites / 37 tests pass (16.802 s); `npm test` → 60 suites / 659 tests pass (56.551 s); baseline PR #62 59 suites / 626 tests.
Unverified items / limitations: no real broker/PAPER/LIVE end-to-end boot (credentials absent, broker factory mocked); ownership and deletion claims are per-process; no crash reconciliation of a runtime persisted as ACTIVE; `strategyLoader.startStrategy` is not unit-covered end to end; the lost-claim path is only reachable if claims ever expire or go cross-process.
Decisions needed: whether cross-process runtime ownership is ever required (would need a DB-backed lease).
Blockers: none.
Exact next action: review the S2-FIX-3 diff and the implementation record; if accepted, merge PR #63.
May another agent continue? YES — resume the task file and this dashboard.

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

## Update discipline

Update this file and the matching task record on every claim, start, blocker, handoff, review and completion. Never mark a task DONE without acceptance evidence and review.
