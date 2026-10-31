# P0-07 — Existing Plans and PR/Branch Reconciliation

Status: READY
Suggested owner: Jules
Risk: Medium (read-only repository coordination audit)
Dependencies: None; verify current main and all relevant open PR/branch metadata
Output: `plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md`

## Objective
Reconcile historical plans, open pull requests and active branches against the current roadmap and verified main branch, preserving useful work without treating old PR descriptions as authorization.

## Scope
- Compare `plans/target-architecture.md`, `plans/to_do.md`, `plans/Audit/`, decisions and current agent instructions with the authoritative roadmap.
- Inspect relevant open PRs and branches: base/head, commit ancestry, changed files, status, tests, conflicts and dependencies.
- Classify each reviewed PR/branch as ADOPT, EXTRACT, REWORK, HOLD, CLOSE or NEEDS OWNER DECISION, with evidence and rationale.
- Review backend architecture work and frontend enhancement PRs as separate workstreams.
- Identify duplicate task systems, stale instructions and docs that point agents to obsolete work.
- Specifically review PR #17 as an older status-board proposal and determine how its useful information should be preserved or retired.

## Non-goals
- Do not merge, close, retarget, rebase, delete or push any branch/PR.
- Do not edit historical plans or issue descriptions as part of this audit.
- Do not assume PR descriptions or prior test counts remain current.

## Procedure
1. Record current main commit and list open PRs/branches.
2. Inspect each relevant PR's complete changed-file list and diff, not only its description.
3. Compare ancestry and identify overlap/conflicts with main and other PRs.
4. Cross-check claims against current files and tests where possible.
5. Provide a disposition and exact next action for each reviewed item.

## Deliverable
Create `plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md` with a PR/branch matrix, plan conflicts, evidence, proposed disposition, risk/conflict analysis, preserved work and Owen decisions required.

## Acceptance criteria
- [ ] Every reviewed PR/branch has an evidence-backed disposition.
- [ ] Relevant changed files and commit relationships are identified.
- [ ] Historical plans are classified as current, historical, superseded or unresolved.
- [ ] PR #17's old J1–J10 board is reconciled with the P0 roadmap.
- [ ] No PR, branch or historical issue was modified.
