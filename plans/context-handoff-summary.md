# CoreX Context Handoff Summary

Last updated: 2026-11-20
Purpose: durable handoff for another ChatGPT session, agent, or developer. Repository plans and task files are authoritative; this is a navigation summary, not a replacement.

## Repository and working boundaries

- Repository: `ssemandaowen/corex_engine`
- Active worktree: `C:\\Users\\SBUM\\Desktop\\corex-b3`
- Active branch: `fix/security-corex-strategy-engine`
- Active PR: [#57 — security: authorize corex-strategy-engine exact import](https://github.com/ssemandaowen/corex_engine/pull/57). This is now the single B3 integration PR.
- Current main: `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c` (P1 squash merge).
- B3 branch was updated by merging current `origin/main` into the existing PR #57 branch, no force-push. Merge commit: `c0ff2737992d64903eba20de9dba65032a6ef534`. PR #57 now has current main as its merge base and its pre-implementation diff still contains only `utils/security.js` and `test/round7.comprehensive.test.js`.
- P1 worktree: `C:\\Users\\SBUM\\Desktop\\corex-p1`; PR #80 is merged. Do not continue P1 implementation there.
- Main checkout: `C:\\Users\\SBUM\\Desktop\\corex` — do not reset, clean, or disturb its dirty/unrelated state.
- PR #56 was closed as superseded because it contained 60 changed files and mixed the allow-list change with unrelated UI, settings, backtest, and planning work.
- PR #80 was merged and its GitHub body corrected to reflect the merge and acceptance.
- Do not merge B3 without review and Owen's explicit approval.

## P1 — complete

Authoritative task: `plans/tasks/P1-instance-safety-guard.md`
Roadmap row: P1 = DONE.
PR: #80, merged 2026-11-20.
Merge SHA: `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`.

P1 added package-owned `assertSafeInstance(instance, ExpectedClass)` and enforced it immediately after construction in both compiler paths, runtime loader, and package StrategyValidator. It checks exact prototype ownership, constructor descriptor, forbidden own properties, safe `params` / `schema` containers, accessors, and proxies.

Verification recorded:
- `corex-strategy-engine`: 12 suites / 125 tests passed.
- Root compiler + loader/recovery: 2 suites / 17 tests passed.
- Syntax check and `git diff --check`: passed.
- Owen approved progression after reviewing the corrected guard findings.
- Kilo's automated review did not run because the Kilo account was out of credits; no external reviewer submission was recorded.

The PR #80 merge was performed after Owen's approval. The P1 roadmap completion row and task record are being corrected in the B3 worktree because PR #80 had already merged with the row still marked IN PROGRESS. This documentation correction is included with the B3 planning updates.

## B3 — active workstream

Authoritative task: `plans/tasks/B3-sandbox-module-resolution.md`
Roadmap: `plans/ROADMAP.md`
Known issues: `plans/KNOWN_ISSUES.md`
Branch/worktree/PR: `fix/security-corex-strategy-engine` / `corex-b3` / PR #57.

B3 objective: replace the strategy compiler's unrestricted Node module resolution with an exact, compiler-owned allow-list. The AST scanner remains useful as a pre-execution check but is not the runtime security boundary.

### Reproduced findings on Node v22.20.0

Current `engine/services/strategyCompiler.js::_loadModuleFromString()` uses `new Module(filename, module)`, `Module._nodeModulePaths(process.cwd())`, and `mod._compile()`. This exposes Node's normal CommonJS require and resolution behavior.

The current scanner/loader was tested and the following were reproduced:
1. Scanner accepts `const load = require; load("fs")`; the compiler-style Module loader then loads fs through the alias.
2. Scanner accepts dynamic `import("node:fs")`; current `Module._compile` execution successfully loads node:fs.
3. Scanner accepts `require.resolve("fs")`.
4. Scanner accepts arbitrary names containing `BaseStrategy` due to substring matching.
5. `require("../../package.json")` succeeds from the synthetic `db://strategies/probe.js` filename; relative traversal can reach repository files.
6. Root `module-alias/register` lets the compiler-style loader load `corex-strategy-engine/src/Strategy` even though the scanner rejects that literal package subpath.

### Proposed bounded implementation

- Replace Node's generated CommonJS require path with a wrapper compiled through documented Node `vm.compileFunction()`.
- Inject a minimal `module` record and a compiler-owned restricted `require` function.
- Exact allowed specifiers to verify: `corex-strategy-engine`, `mathjs`, `technicalindicators`, and the exact temporary legacy template import `@utils/BaseStrategy`.
- Reject package subpaths, built-ins, arbitrary packages, relative/absolute/traversal paths, dynamic imports, and unknown aliases.
- Do not expose `require.resolve/cache/extensions/main/paths` or `module.require`.
- Preserve `module.exports`, `exports`, `this` binding, filename stack traces, and both compiler entry paths.
- No `importModuleDynamically` callback is supplied; Node docs state dynamic imports then reject with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. The scanner must also reject ImportExpression nodes.
- This is module-resolution control only. Node explicitly states `node:vm` is not a security mechanism; SEC-01 remains separate.

### Compatibility note

`utils/template.txt` still generates `@utils/BaseStrategy` imports. P3 moves the authoring template into the package; P5 deletes the legacy BaseStrategy implementation. Until P3, retain only the exact `@utils/BaseStrategy` specifier if needed. Do not preserve the old substring exception or allow bare arbitrary names containing BaseStrategy.

### Environment / verification state

- B3 implementation is present locally in `engine/services/strategyModuleResolver.js`, `engine/services/strategyCompiler.js`, `utils/security.js`, and focused tests. Planning and implementation changes are not yet committed.
- B3 has no local `node_modules`. Targeted Jest runs successfully used the existing P1 worktree dependency installation via a child Node process with `NODE_PATH`; no dependency files were copied or modified.
- Verified targeted suites: resolver 25/25; compiler module-resolution integration 4/4; `round7.comprehensive.test.js` security selection 21/21 (46 unrelated tests skipped); compiler instance-safety 2/2; engine recovery 15/15. Total 5 suites / 67 tests passed; this is not a full repository run.
- `node --check` passed for all five changed/new JavaScript files. The scanner and instance-safety test files needed Jest `--forceExit` because the test process retained open handles; assertions passed before forced exit.
- `git diff --check` passed after correcting mixed line endings in the Known Issues update. The compiler, scanner, resolver, strategy-loader callers, and worker caller were reviewed. The worker scanner bypass is separately recorded as SEC-03. GitHub review and full-repository verification remain pending; do not claim B3 acceptance or merge readiness.

## Separate security backlog

### SEC-01 — execution isolation / shared process intrinsics

P1 captures its own inspection intrinsics but does not isolate strategy execution. Strategy code still runs in the engine process. B3's `vm.compileFunction()` wrapper does not change that. SEC-01 needs its own threat model, import-closure analysis, and reviewed isolation design. Do not use `vm` alone as a security boundary.

### SEC-02 — strategy module-resolution bypasses

SEC-02 is the active B3 defect. Evidence and acceptance criteria are in the B3 task file and roadmap. Close it only after the restricted compiler resolver and regression tests are reviewed and merged.

### SEC-03 — strategy worker bypasses AST validation

`engine/workers/strategyWorker.js` calls `StrategyCompiler.compile()` directly for `LOAD_STRATEGY`, without the `validateStrategyCode()` call used by the main strategy loader. The worker pool forks it and defaults to enabled in production unless `COREX_STRATEGY_WORKER_ENABLED` overrides that setting; `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` through the pool. The worker pool forks it and defaults to enabled in production unless `COREX_STRATEGY_WORKER_ENABLED` overrides that setting; `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` through the pool. The exact B3 runtime resolver still constrains module loading on this path, but AST checks for non-module hazards are skipped. Recorded separately in `plans/KNOWN_ISSUES.md` §11 and the roadmap as NEEDS TRIAGE — NOT SCHEDULED. Do not expand B3 to absorb this separate worker validation-ownership task.

## Sequence

- P1: DONE, PR #80 merged.
- B3: IN PROGRESS, PR #57 retained and synced with main; restricted resolver and scanner hardening are implemented locally, with targeted tests passing.
- P2: LATER; it depends on both P1 and B3.
- PR #56: CLOSED as noisy duplicate.
- PR #57: OPEN; do not close until B3 is completed or deliberately superseded.
- STAGE-1 PR #79 remains open; its opened status satisfied the P1 entry gate recorded in the roadmap.

## Exact next actions

1. Finish any remaining source/diff review and run additional relevant tests if needed; the targeted B3 suites and syntax checks are recorded in the task file.
2. Stage and commit only the B3 implementation, its regression tests, and the related roadmap/Known Issues/handoff/P1 closeout documentation in `corex-b3`.
3. Push the B3 branch and update PR #57's title/body with the actual scope, tests, and explicit non-sandbox limitation.
4. Obtain independent review and address findings. Do not merge without Owen's explicit approval.
5. Keep SEC-03 (worker AST validation bypass) and SEC-01 (execution isolation) separately scoped; do not fold them into B3.
6. Start P2 only after B3 has been reviewed, accepted, and merged.

## Working discipline

- Inspect current code/callers before editing; do not trust stale summaries over Git.
- Keep one coherent task per PR/worktree. Do not absorb SEC-01 or unrelated work into B3.
- Cross-cutting/high-risk discoveries become separately scoped roadmap/Known Issues items with evidence, impact, boundaries, and dependencies.
- Use Context7 for current Node/library API documentation when implementation depends on it.
- Distinguish observed evidence, tested behavior, limitations, and assumptions.
