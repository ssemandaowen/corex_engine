# P0-01 — Repository Baseline

Status: READY
Suggested owner: Kilo Code
Risk: Low (read-only investigation and documentation)
Dependencies: None
Output: `plans/architecture/REPOSITORY_BASELINE.md`

## Objective
Create a verified, reproducible snapshot of the current repository and development environment so later audits use the same factual baseline.

## Why this matters
The roadmap and old audit reports contain historical assumptions. Later work must distinguish the current main branch from stale branches, PR claims and prior test counts.

## Scope
- Record default branch, current commit SHA, date, working-tree state and repository identity.
- Inventory Node/npm/package manager versions, engines, lockfiles, workspaces, module aliases and package manifests.
- Inventory scripts and identify the actual commands for boot, lint, unit, integration and full test execution.
- Map top-level and important nested directories, including backend, frontend, packages, database, tests, scripts and plans.
- Inventory package-level `AGENTS.md`, README and local instructions.
- Identify environment prerequisites and commands that cannot safely run without credentials/services.
- Note discrepancies between `AGENTS.md`, `SKILLS.md`, roadmap and legacy docs.

## Non-goals
- No application code, dependency, lockfile, configuration or database changes.
- Do not run destructive scripts, migrations, deployment commands or commands that mutate user data.
- Do not repair unrelated documentation or start P0-02 automatically.
- Do not treat any open PR branch as the baseline.

## Procedure
1. Read all mandatory repository guidance.
2. Inspect `git status --short --branch`, `git log -1`, branch tracking and remotes.
3. Inspect manifests, lockfiles, package scripts, workspace settings and runtime declarations.
4. Inventory directories and package instructions from the checked-out branch.
5. Run only safe, relevant read-only inspection commands; distinguish commands inspected from commands executed.
6. Record environment-dependent limitations and exact commands needed for later verification.

## Deliverable
Create `plans/architecture/REPOSITORY_BASELINE.md` with:
- timestamp and commit SHA;
- environment/toolchain;
- directory and package inventory;
- scripts and test command matrix;
- branch/worktree facts;
- guidance conflicts;
- verified facts vs assumptions;
- risks and follow-up questions.

## Acceptance criteria
- [ ] Every key fact has a real path, command or manifest as evidence.
- [ ] Current branch and commit SHA are recorded.
- [ ] Commands that were run are distinguished from commands merely identified.
- [ ] No application/config/dependency files changed.
- [ ] Limitations and unknowns are explicit.
- [ ] STATUS and this task record include a resumable handoff.

## Handoff
Use the mandatory handoff template in `plans/AGENT_WORKFLOW.md`. Do not claim the task DONE until Owen reviews the baseline.
