---
description: Scaffold the next package in CoreX's modularization/extraction plan
subtask: true
---

Scaffold the next package in CoreX's modularization/extraction plan.

Before writing any code:
1. State which package this is, and confirm it's the next one in sequence per
   `.kilo/rules/11-modularization-package-extraction.md` — don't skip ahead.
2. List the files/modules this package will contain and where it will live in the workspace.
3. Note the git branch name you'll use, per `.kilo/rules/12-git-workflow-package-extraction.md`
   (`extract/<package-name>`).
4. Stop and wait for confirmation of the plan before scaffolding.

Once confirmed, scaffold: package.json, the contract/interface file, a minimal test stub, and wire
it into TS project references. Do not touch the main engine's consumption of the old path yet
(Strangler Fig — old path stays alive until this package is proven).

Arguments (`$ARGUMENTS`) may specify the package name directly, e.g. `/new-package market-data-contract`.
