# CoreX Context Handoff Summary

Last updated: 2026-11-21
Purpose: durable handoff for another ChatGPT session, agent, or developer. Repository plans and task files are authoritative; this is a navigation summary, not a replacement.

## Repository and working boundaries

- Repository: `ssemandaowen/corex_engine`
- Active worktree: `C:\\Users\\SBUM\\Desktop\\corex-b3`
- Active branch: `fix/security-corex-strategy-engine`
- Active PR: [#57 — security: enforce exact strategy module resolution](https://github.com/ssemandaowen/corex_engine/pull/57). This is now the single B3 integration PR.
- Current main: `8a68c9f2bb2446d40fde5e86350ca5d8ec28e80d`.
- On 2026-11-21, B3 merged the latest `origin/main` into `corex-b3` with merge commit `ef70e0c` (conflict-free). This includes the package-entrypoint correction and deterministic SocketX token-bucket regression test. The follow-up B3 test/docs commit `e44ee0e` was pushed to `origin/fix/security-corex-strategy-engine`; the branch is now 15 commits ahead of current main and 0 behind.
- P1 worktree: `C:\\Users\\SBUM\\Desktop\\corex-p1`; PR #80 is merged. Do not continue P1 implementation there.
- Main checkout: `C:\\Users\\SBUM\\Desktop\\corex` — do not reset, clean, or disturb its dirty/unrelated state.
- PR #56 was closed as superseded because it contained 60 changed files and mixed the allow-list change with unrelated UI, settings, backtest, and planning work.
- PR #80 was merged and its GitHub body corrected to reflect the merge and acceptance.
- PR #57's published head is `e44ee0eca13ed5dc15b532ef5935a86907a9d428`; GitHub compare reports 15 commits ahead and 0 behind current main. PR #57's body has been refreshed with the latest test results and explicit non-sandbox limitations. The only submitted COMMENT review is authored by the repository owner, so independent review is still outstanding. Kilo's review bot reported insufficient credits. Do not merge B3 without an actual independent review and Owen's explicit approval.
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

- B3 implementation commit: `083f96d9644a3256f70c34e7894f9c8c07b04ce1` (`security: restrict strategy module resolution`). Latest main-sync merge commit: `ef70e0c` (local; push pending).
- B3 has no local `node_modules`. Targeted Jest runs successfully used the existing P1 worktree dependency installation via a child Node process with `NODE_PATH`; no dependency files were copied or modified.
- Verified targeted suites before the latest compatibility test: resolver 25/25; compiler module-resolution integration 4/4; `round7.comprehensive.test.js` security selection 21/21 (46 unrelated tests skipped); compiler instance-safety 2/2; engine recovery 15/15. The compiler integration suite now has a fifth test that reads the real `utils/template.txt`, substitutes the generated class name, and verifies that the restricted resolver compiles it through the exact `@utils/BaseStrategy` import; 1 suite / 5 tests passed.
- Full repository verification on 2026-11-21: **67 suites / 766 tests passed** with `--runInBand --forceExit --testTimeout=25000`. The first full run with Jest's default 5-second hook timeout failed only the worker warmup suite because its `beforeAll` uses a 20-second worker-readiness wait. That worker suite passed alone with a 25-second timeout. This is an existing test harness timing mismatch outside B3; it was not changed in this PR.
- B3 has no local `node_modules`; tests used the P1 worktree dependency installation through `NODE_PATH`, with no dependencies copied. The scanner and instance-safety tests retain open handles, so `--forceExit` is used after assertions complete.
- Run `node --check` across the seven changed/new JS files and `git diff --check` after the final documentation edits. The worker scanner bypass is separately recorded as SEC-03. The only submitted COMMENT review is owner-authored; an actual independent review and Owen acceptance remain outstanding. Do not claim B3 acceptance or merge readiness.

## Separate security backlog

### SEC-01 — execution isolation / shared process intrinsics

P1 captures its own inspection intrinsics but does not isolate strategy execution. Strategy code still runs in the engine process. B3's `vm.compileFunction()` wrapper does not change that. SEC-01 needs its own threat model, import-closure analysis, and reviewed isolation design. Do not use `vm` alone as a security boundary.

### SEC-02 — strategy module-resolution bypasses

SEC-02 is the active B3 defect. Evidence and acceptance criteria are in the B3 task file and roadmap. Close it only after the restricted compiler resolver and regression tests are reviewed and merged.

### SEC-03 — strategy worker bypasses AST validation

`engine/workers/strategyWorker.js` calls `StrategyCompiler.compile()` directly for `LOAD_STRATEGY`, without the `validateStrategyCode()` call used by the main strategy loader. The worker pool forks it and defaults to enabled in production unless `COREX_STRATEGY_WORKER_ENABLED` overrides that setting; `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` through the pool. The worker pool forks it and defaults to enabled in production unless `COREX_STRATEGY_WORKER_ENABLED` overrides that setting; `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` through the pool. The exact B3 runtime resolver still constrains module loading on this path, but AST checks for non-module hazards are skipped. Recorded separately in `plans/KNOWN_ISSUES.md` §11 and the roadmap as NEEDS TRIAGE — NOT SCHEDULED. Do not expand B3 to absorb this separate worker validation-ownership task.

## Sequence

- P1: DONE, PR #80 merged.
- B3: IN PROGRESS, PR #57 retained and synced with main; restricted resolver and scanner hardening are implemented, full repository tests pass (67 suites / 766 tests), and independent review is pending.
- P2: LATER; it depends on both P1 and B3.
- PR #56: CLOSED as noisy duplicate.
- PR #57: OPEN; do not close until B3 is completed or deliberately superseded.
- STAGE-1 PR #79 remains open; its opened status satisfied the P1 entry gate recorded in the roadmap.

## Exact next actions

1. Obtain an actual independent review of PR #57 and address any B3-scope findings.
2. Re-run affected tests and update the task record if review changes are required.
3. Do not merge PR #57 without Owen's explicit acceptance after review.
4. Keep SEC-03 (worker AST validation bypass) and SEC-01 (execution isolation) separately scoped; do not fold them into B3.
5. Start P2 only after B3 has been reviewed, accepted, and merged.

## Working discipline

- Inspect current code/callers before editing; do not trust stale summaries over Git.
- Keep one coherent task per PR/worktree. Do not absorb SEC-01 or unrelated work into B3.
- Cross-cutting/high-risk discoveries become separately scoped roadmap/Known Issues items with evidence, impact, boundaries, and dependencies.
- Use Context7 for current Node/library API documentation when implementation depends on it.
- Distinguish observed evidence, tested behavior, limitations, and assumptions.
