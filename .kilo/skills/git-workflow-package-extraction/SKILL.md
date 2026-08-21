---
name: git-workflow-package-extraction
description: Git Workflow for Package Extraction
---


## Context
Owen has so far relied on AI assistants to handle git directly and does not have hands-on
familiarity with branching/worktree mechanics. The repo (`corex_engine`) is a large, messy single
cluster. Any git workflow proposed here must be explicit, step-by-step, and specific to the
package-extraction plan — not generic "use feature branches" advice.

## Baseline workflow to apply (unless Owen specifies otherwise)
1. **One branch per package extraction**, named after the package
   (e.g. `extract/market-data-contract`, `extract/twelvedata-wrapper`).
2. Branch from the current stable trunk; do not branch from another in-progress extraction branch
   unless the packages are genuinely dependent — call that dependency out explicitly if so.
3. Commit in small, reviewable chunks scoped to one package's extraction steps (interface →
   implementation → wiring → tests), not one giant commit per package.
4. Before merging a package branch back: confirm the package is independently tested/verified per
   `11-modularization-package-extraction.md`.
5. Tag or note in the commit message which package-plan step this corresponds to, so history stays
   legible against the extraction plan.

## When acting as the git operator
- Always state in plain language what a git command will do before running it (Owen doesn't yet
  read git output independently).
- Prefer non-destructive commands. Anything resembling a history rewrite or hard reset should be
  explained and confirmed first (also enforced at the permission layer in `kilo.jsonc`).
- If asked to "just handle git," still narrate the plan (branch name, what's being committed) — one
  short line is enough, not a lecture.



