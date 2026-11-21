# B3 — Strategy module-resolution boundary and exact allow-list

Status: IN PROGRESS — implementation and regression coverage complete on PR #57; full repository verification passed (67 suites / 766 tests); owner-authored COMMENT review exists, but independent review and Owen acceptance are pending; SEC-01 remains separate
Owner: Owen Ssemanda (approval authority); ChatGPT assisting investigation and implementation
Branch: `fix/security-corex-strategy-engine`
Worktree: `C:\\Users\\SBUM\\Desktop\\corex-b3`
Pull request: #57 (retained as the focused B3 integration PR)
Started: 2026-11-20
Base: `origin/main` at `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`
Dependency: P1 PR #80 merged as `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`; Stage 2 PR #63 is DONE. P2 must wait for B3 acceptance.

## Objective

Make the strategy's injected CommonJS `require` channel explicit and fail-closed. Calls through that function may load only exact approved module specifiers through a compiler-owned resolver. The AST scanner remains a pre-execution diagnostic layer; it is not authoritative for aliases or a process-level security boundary.

This work is **not** a process sandbox or an execution-isolation solution. SEC-01 remains a separate security design workstream.

## Repository evidence and reproduced defects

### Pre-B3 compiler behavior (reproduced before the resolver change)

`engine/services/strategyCompiler.js::_loadModuleFromString()` currently:
- creates a Node `Module` with the strategy's synthetic `db://strategies/<id>.js` filename;
- sets `mod.paths = Module._nodeModulePaths(process.cwd())`;
- executes source with `mod._compile()`.

This supplies Node's normal CommonJS `require` function and resolution behavior rather than a strategy-specific allow-listed resolver. `Module._compile` and `Module._nodeModulePaths` are Node internal implementation APIs, not a documented public loader contract.

### Pre-B3 scanner behavior (reproduced before the scanner change)

`utils/security.js` currently:
- recognizes literal direct `require("...")` calls but does not make runtime resolution safe;
- authorizes package subpaths by first-segment matching for some allowed dependencies;
- uses a broad `specifier.includes("basestrategy")` compatibility exception;
- has no effective `ImportExpression` rejection.

### Reproduction evidence on Node v22.20.0

The following probes were run against the current implementation:
1. `validateStrategyCode()` accepted `const load = require; load("fs")`.
2. `validateStrategyCode()` accepted `import("node:fs")`; executing it through the current `Module._compile` path successfully loaded `node:fs`.
3. `validateStrategyCode()` accepted `require.resolve("fs")`.
4. `validateStrategyCode()` accepted the arbitrary package name `not-a-real-BaseStrategy-package` because it contains the substring `BaseStrategy`.
5. The current synthetic `db://strategies/probe.js` parent successfully loaded the repository root `package.json` through `require("../../package.json")`. Relative traversal is therefore not contained by the synthetic filename.
6. After `module-alias/register`, the current compiler-style `Module._compile` path successfully loaded `corex-strategy-engine/src/Strategy` even though the static scanner rejects that literal subpath. The alias maps the package prefix directly to the package directory.
7. A scratch proof using `vm.compileFunction()` with an injected custom `require` rejected aliased `require("fs")` and relative imports while allowing the exact `corex-strategy-engine` root. With no `importModuleDynamically` callback, dynamic import rejected with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.

### Compatibility evidence

- `utils/template.txt` currently generates strategies that import `@utils/BaseStrategy`. P3 is responsible for moving the authoring template into the package. Until that migration is accepted, B3 must preserve only this exact legacy specifier if required; do not retain substring-based BaseStrategy matching.
- `plans/decisions.md` records that seven legacy database strategies were deleted and the cutover to `corex-strategy-engine` was completed. This is consistent with the template being the remaining explicit compatibility path, not permission for arbitrary BaseStrategy-named modules.
- Current strategy API tests use `require("corex-strategy-engine")`; no tracked production strategy source imports package subpaths.

## Bounded implementation direction

1. Add `engine/services/strategyModuleResolver.js` as the single owner of strategy module loading. Replace the strategy's Node `Module._compile`/normal `require` path in `engine/services/strategyCompiler.js` with a CommonJS-compatible wrapper compiled using Node's documented `vm.compileFunction()` API. Inject:
   - `exports`;
   - a compiler-owned restricted `require` function;
   - a minimal `module` record containing only `exports`;
   - synthetic `__filename` and `__dirname` strings.
2. The restricted resolver must use an exact map of approved specifiers and resolve each approved module from the trusted compiler module context. Candidate supported names to verify in tests:
   - `corex-strategy-engine` (public package root only);
   - `mathjs`;
   - `technicalindicators`;
   - `@utils/BaseStrategy` only as the current template's temporary legacy import until P3 migrates that template.
3. Do not allow Node built-ins, arbitrary packages, package subpaths, relative imports, absolute paths, traversal paths, or unknown aliases.
4. Do not expose Node's generated `require.resolve`, `require.cache`, `require.extensions`, `require.main`, `require.paths`, or `module.require` surfaces to strategy code.
5. Update `utils/security.js` to use exact specifier matching, remove substring-based BaseStrategy authorization, reject relative/absolute specifiers, and reject AST `ImportExpression` nodes.
6. Keep the `importModuleDynamically` option unset. Node v22.20.0 documents that dynamic imports in code compiled by `vm.compileFunction()` reject with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` when no callback is supplied. The static scanner must also reject dynamic import syntax.
7. Preserve CommonJS export behavior needed by current strategy code: `module.exports`, `exports`, `this` binding, stack-trace filename, and class extraction.
8. Keep both compiler entry points (`validateAndExtractClass()` and `compile()`) on the same restricted loader.

The `vm` API is used here only to compile a wrapper with an injected resolver. It is **not** used as a security sandbox. Node's official documentation explicitly warns that `node:vm` is not a security mechanism; SEC-01 remains open.

## Acceptance criteria

1. The allow-list is exact and explicit; no first-segment or substring matching authorizes a module.
2. `corex-strategy-engine` root import works and returns the same public `Strategy` class used by the engine; all package subpaths fail.
3. `mathjs`, `technicalindicators`, and the temporary exact `@utils/BaseStrategy` template import work if retained by compatibility verification.
4. Runtime compilation rejects direct and aliased attempts to load built-ins, arbitrary packages, relative/absolute paths, traversal paths, and package subpaths.
5. Runtime compilation does not expose `require.resolve/cache/extensions/main/paths` or `module.require`.
6. Dynamic import is rejected by the scanner and cannot load modules through the compiler path.
7. The scanner rejects relative and absolute imports and no longer accepts arbitrary names containing `BaseStrategy`.
8. Tests exercise the real compiler loader, not only scanner helper functions.
9. Both compiler construction paths use the same resolver; existing StrategyCompiler, loader/recovery, runtime and backtest paths remain compatible.
10. Existing strategy compiler, strategy engine package, and relevant root test suites pass; `git diff --check` and syntax checks pass.
11. The PR and task record explicitly state that this is module-resolution control, not execution isolation.

## Caller audit note — separate finding (SEC-03)

The main `engine/strategyLoader.js` paths call `validateStrategyCode()` before `StrategyCompiler.compile()`. However, `engine/workers/strategyWorker.js` handles `LOAD_STRATEGY` by calling `compiler.compile()` directly, bypassing the AST scanner. This is a reachable production path: `engine/modules/strategyRuntime/workerPool.js` forks the worker and defaults to enabled under `NODE_ENV === "production"` unless explicitly overridden, while `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` requests through the pool. B3's runtime resolver still enforces the exact module allow-list on that path, but non-module scanner checks are skipped. This is recorded as SEC-03 in `plans/KNOWN_ISSUES.md` and `plans/ROADMAP.md`; it is intentionally not folded into B3. A separate task must decide validation ownership and test the worker's load contract.

## Non-goals

- No worker-thread/process isolation or full untrusted-code sandbox (tracked separately as SEC-01).
- No assumption that `vm` is a security boundary.
- No broad static taint-analysis framework to prove every alias; the runtime resolver is authoritative only for the injected CommonJS `require` function. It does not constrain process-global APIs or provide execution isolation.
- No P2 StrategyContract redesign, P3 template migration, P4 folder repatriation, or P5 legacy source deletion.
- No unrelated engine, broker, backtest, UI, or database changes.

## Post-implementation security finding — SEC-01 computed constructor escape

A post-implementation probe on Node v22.20.0 demonstrated that B3's exact `require` resolver is not a process-level security boundary:

- Source: `const fs = Object["con" + "structor"]("return process.getBuiltinModule('fs')")(); class StrategyProbe { constructor() { this.fsAvailable = typeof fs.readFileSync === "function"; } onBar() { return null; } } module.exports = StrategyProbe;`
- `validateStrategyCode(source)` accepted the source.
- `loadStrategyModule(source, "sec01-strategy-probe")` returned the class, and constructing it produced `fsAvailable === true`.
- The computed property avoids the scanner's direct `.constructor` property check. The generated Function executes in the engine process's global context and obtains `process.getBuiltinModule("fs")` without using the injected `require` function.

This is an SEC-01 execution-isolation defect, not a B3 implementation expansion. B3 should be reviewed and described only as a restriction on the injected CommonJS `require` channel. Do not claim that B3 makes untrusted strategy code safe. The reproducer and its impact are recorded in `plans/KNOWN_ISSUES.md` §9 and `plans/ROADMAP.md` SEC-01.

## PR reconciliation

- PR #56 was closed as superseded: it had 60 changed files and mixed the same allow-list patch with unrelated UI, settings, backtest, and planning changes.
- PR #57 is retained as the single B3 integration PR because its change is scoped to the resolver, compiler integration, scanner, related tests and planning records. PR #56 is closed unmerged as the noisy duplicate. PR #57 has one COMMENT review authored by the repository owner; this is not an independent review. The Kilo review bot reported that the account was out of credits, and no external reviewer submission is recorded.
- On 2026-11-21, local `corex-b3` merged the latest `origin/main` (`8a68c9f2bb2446d40fde5e86350ca5d8ec28e80d`) with merge commit `ef70e0c`. The merge was conflict-free and includes the package-entrypoint correction plus the deterministic SocketX token-bucket test. The current-main merge and B3 implementation/test/documentation updates are pushed to `origin/fix/security-corex-strategy-engine`; PR #57's body has been refreshed with current test evidence and security limitations. Recheck the exact ahead/behind count before any later merge consideration. Do not merge PR #57 before an actual independent review and Owen's explicit acceptance.

## Initial verification status

- Repository and caller audit: complete.
- Bypass reproducers: complete; findings above are reproduced.
- Context7 checked Node.js v22.20.0 module-resolution documentation.
- Official Node.js v22.20.0 documentation checked for `vm.compileFunction()` and dynamic-import behavior. It explicitly states `node:vm` is not a security mechanism and that dynamic import rejects with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` when no callback is supplied.
- Scratch proof of injected exact `require`: passed.
- Implemented locally: new `engine/services/strategyModuleResolver.js`; `StrategyCompiler` delegates both compile paths to it; `utils/security.js` now uses exact specifiers, rejects dynamic imports, relative paths and sensitive require properties; added scanner regressions plus resolver and compiler integration tests.
- `node --check` for all seven changed/new JavaScript files (`engine/services/strategyCompiler.js`, `engine/services/strategyModuleResolver.js`, `utils/security.js`, `test/DeclarativeStrategy.test.js`, `test/round7.comprehensive.test.js`, `test/strategyCompiler.moduleResolution.test.js`, and `test/strategyModuleResolver.test.js`): passed.
- Targeted Jest verification was rerun on the B3 source using the dependency installation in the separate P1 worktree via Jest `--modulePaths`; no dependency files or worktree contents were copied or modified.
  - `test/strategyModuleResolver.test.js`: 1 suite / 25 tests passed.
  - `test/strategyCompiler.moduleResolution.test.js`: 1 suite / 4 tests passed.
  - `test/round7.comprehensive.test.js` filtered to `security.js`: 1 suite / 21 tests passed (46 unrelated tests skipped).
  - `test/strategyCompiler.instanceSafety.test.js`: 1 suite / 2 tests passed.
  - `test/engine-recovery.test.js`: 1 suite / 15 tests passed.
  - Original targeted coverage: 5 suites / 67 tests passed; this is not a full repository test run.
- Independent rerun on 2026-11-21: the same five root suites (`strategyModuleResolver`, compiler module resolution, `round7.comprehensive`, compiler instance safety, and engine recovery) passed **5 suites / 113 tests**. The entire `packages/corex-strategy-engine/test` suite passed **12 suites / 125 tests**. Both runs used `--forceExit` because the test process retains open handles.
- Full repository verification on 2026-11-21 passed **67 suites / 766 tests** using `--runInBand --forceExit --testTimeout=25000`. The B3 checkout has no local `node_modules`, so the run used the P1 worktree dependency directory via `NODE_PATH`, inherited by child processes. A full run with Jest's default 5-second hook timeout failed only `test/strategyWorker.warmup.test.js` because its `beforeAll` readiness wait allows 20 seconds but Jest's hook default is 5 seconds; the same worker suite passed in isolation with a 25-second timeout. This is a pre-existing test-harness timing mismatch outside B3, not a B3 product failure; it was not changed in this PR. The legacy declarative-strategy scanner fixture was updated to import `Strategy` from the public `corex-strategy-engine` root instead of the now-forbidden relative `../utils/DeclarativeStrategy` path.
- The scanner and instance-safety suites retain open handles in this checkout; targeted runs needed Jest `--forceExit` to return cleanly. Assertions passed before forced exit. This is recorded as a test-process limitation, not a product-test failure.
- Added a compiler-level regression that reads the actual `utils/template.txt`, substitutes the generated class name, and compiles it through the restricted resolver; it confirms the exact `@utils/BaseStrategy` compatibility path still works. Targeted `test/strategyCompiler.moduleResolution.test.js`: 1 suite / 5 tests passed. Full repository verification above includes this regression.
- `git diff --check`: passed on the original implementation. Re-run after the current task/handoff updates before commit.
