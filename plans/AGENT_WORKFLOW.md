# CoreX Agent Workflow

> Status: Active
> Applies to: every human or automated contributor
> Authority: subordinate to Owen's latest explicit decision and `plans/COREX_DEVELOPMENT_PLAN.md`

## 1. Sources of truth

Read these in order before acting:

1. `AGENTS.md` and `SKILLS.md` — repository-wide rules.
2. `plans/COREX_DEVELOPMENT_PLAN.md` — phases, priorities, task dependencies and approval gates.
3. `plans/STATUS.md` — current task ownership, state, branch and handoff pointer.
4. The selected `plans/tasks/<TASK-ID>*.md` — exact scope, non-goals and acceptance criteria.
5. Relevant package instructions, `plans/decisions.md`, known issues and audit evidence.

The roadmap defines *what and when*. The task file defines *the bounded work*. STATUS defines *who currently owns it and where it stands*. This workflow defines *how contributors coordinate*.

Do not use old chat messages, PR descriptions, `plans/to_do.md`, or stale branch notes as authorization to start work.

## 2. Task states

Use only these states in STATUS and task records:

- `READY` — defined and eligible to be claimed, subject to dependencies and approval gates.
- `CLAIMED` — an owner has reserved the task; work has not yet started.
- `IN_PROGRESS` — active work is underway.
- `BLOCKED` — progress requires a named dependency, decision, access or evidence.
- `REVIEW` — implementation/evidence is submitted and awaiting review.
- `DONE` — acceptance criteria and required review are satisfied; evidence is linked.
- `CANCELLED` — intentionally stopped with a reason and decision reference.

A task is not DONE because a file was created, code compiles, or an agent says it finished. Do not invent progress percentages.

## 3. Claiming a task

Before writing:

1. Confirm the task is READY or already assigned to you for continuation.
2. Check STATUS for another owner and inspect the branch/worktree state.
3. Confirm dependencies are DONE and required approvals exist.
4. Record owner, agent/tool, branch, start date and state in STATUS and the task file.
5. If already claimed by someone else, do not take over silently. Ask the owner or Owen to coordinate.
6. If the task's scope or acceptance criteria are unclear, propose a clarification before implementation.

A claim is not architectural approval. Protected boundaries and roadmap approval gates still apply.

## 4. Branch and write ownership

- Never work directly on `main`.
- Use one long-lived branch per coherent workstream or milestone, not a new branch for every agent session.
- A new session resumes the existing task and branch when safe; it does not create a duplicate task or PR.
- One writer at a time per shared branch. Other agents may perform read-only review and return evidence.
- Do not have multiple agents independently implement the same task.
- Do not merge, close, rebase destructively, force-push, reset, clean, stash-overwrite, or discard another contributor's work without Owen's explicit approval.
- Inspect `git status` and the staged diff before committing. Stage explicit paths; never use `git add -A` or `git add .` when unrelated changes may exist.
- Preserve unrelated user changes. If the worktree is dirty or ownership is unclear, stop and report it.
- Prefer milestone PRs that group coherent completed tasks. Do not create a PR for every session or handoff.
- If an agent platform automatically creates a branch/PR, do not auto-merge it. Treat it as a review artifact and reconcile it with the workstream.

## 5. Scope control

- Work only within the task's scope and non-goals.
- Record adjacent findings as follow-up proposals; do not silently expand scope.
- No broad rebuild, mass move/delete, schema change, protected contract change or high-risk behavior change without the roadmap-required approval.
- Do not duplicate an existing source of truth. Update the roadmap, task file and STATUS only where each has a distinct role.
- Record evidence with exact paths, symbols, commands, commit SHAs and test results. Clearly label inference and unknowns.

## 6. Progress updates

Update STATUS and the task record when:
- a task is claimed or work begins;
- a blocker or dependency changes;
- scope is approved or amended;
- a meaningful deliverable is produced;
- work is handed off;
- review begins or finishes;
- the task is completed or cancelled.

Keep STATUS concise. Put technical findings and detailed handoffs in the task file or linked evidence document.

## 7. Mandatory handoff

Every pause, agent switch, context reset or session end must leave a handoff in the task file using this template:

```text
### Handoff — YYYY-MM-DD
Owner / agent:
Status:
Branch:
Last verified commit:
Files changed:
Completed:
Commands and test results:
Unverified items / limitations:
Decisions needed:
Blockers:
Exact next action:
May another agent continue? YES / NO — explain
```

The exact next action must be executable by a new contributor without needing the previous chat. If another agent must not continue, state why and name the required owner/decision.

## 8. Review and completion

Before moving to REVIEW, provide:
- concise outcome and evidence;
- complete changed-file list;
- commands actually run and results;
- acceptance-criteria checklist;
- contract, integration and migration impact;
- known limitations and follow-up tasks;
- branch, commit and PR references.

Move to DONE only after acceptance criteria are met, relevant review is complete, required approvals are recorded, and STATUS/task records are updated. The owner of the task cannot self-approve a protected architectural decision.

## 9. Adding or changing tasks

New tasks require a stable ID from the roadmap's relevant phase and must record:
- problem and intended user/system outcome;
- observed evidence and affected ownership boundary;
- scope and explicit non-goals;
- dependencies;
- acceptance criteria and verification approach;
- risk level and required approver;
- suggested owner, status and output path.

Owen approves new priorities and any scope that changes roadmap order or protected architecture. Add the task to the roadmap and STATUS; do not create a parallel backlog.

## 10. Roles

- **Owen:** product owner and final authority for priorities, scope, architecture and protected decisions.
- **ChatGPT:** roadmap steward, task definition, cross-layer analysis and independent acceptance review.
- **Kilo Code:** primary repository investigation, controlled implementation and integration owner unless Owen assigns otherwise.
- **Jules:** bounded implementation or independent audits against approved task specifications; read-only when another agent owns the write.
- **Claude:** independent design challenge, logic review and risk analysis.
- **Any other agent:** must follow the same task claim, scope, branch and handoff rules.

These are default responsibilities, not permission to override a task's explicit owner.

## 11. Conflict resolution

If STATUS, a task file, the roadmap, an issue or a branch disagrees:
1. Follow the authority order in the roadmap.
2. Stop if the conflict changes scope, ownership, approval or protected behavior.
3. Record the conflict and evidence in the task handoff.
4. Ask Owen for the decision when required.
