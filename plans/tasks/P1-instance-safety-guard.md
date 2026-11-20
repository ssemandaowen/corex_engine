# P1 — Strategy instance-safety guard

Status: IMPLEMENTED — verification passed; final diff audit pending
Owner: Owen Ssemanda (product owner); ChatGPT assisting investigation and implementation
Branch: `fix/strategy-instance-safety-guard`
Worktree: `C:\\Users\\SBUM\\Desktop\\corex-p1`
Started: 2026-11-20
Dependency: STAGE-1 replacement PR #79 is open and its targeted Jest test plus frontend build pass. This satisfies the roadmap's P1 entry gate; STAGE-1 itself remains in review.
Scope: Add one authoritative post-construction instance guard to `corex-strategy-engine` and enforce it at all production strategy-construction boundaries.

## Problem and evidence

The static security scanner is a pre-execution check. It cannot guarantee that a constructor returns an instance with the expected prototype or that the constructed object has not introduced forbidden own properties.

Current production construction paths found:
- `engine/services/strategyCompiler.js`: temporary instance in `validateAndExtractClass()` and compile instance in `compile()`.
- `engine/strategyLoader.js`: runtime instance in `startStrategy()`.
- `packages/corex-strategy-engine/src/validation/StrategyValidator.js`: validation instance in `validate()`.

`engine/core/strategy/StrategyContract.js` contains a prototype-pollution check, but the compiler currently calls `adapt()` and then `validate()`; the pollution check is only called by `validateAndAdapt()`. It also does not establish that the constructed instance has the exact prototype belonging to the constructor that was compiled.

## Intended design

Add `assertSafeInstance(instance, ExpectedClass)` under `packages/corex-strategy-engine/src/validation/` and export it from the package's public `index.js`.

The guard must be synchronous and fail closed. It must:
1. Require a non-null object instance and a valid expected constructor.
2. Require `Object.getPrototypeOf(instance) === ExpectedClass.prototype`; reject constructors that return a foreign object or replace the instance prototype.
3. Require the expected prototype's own `constructor` data descriptor to point back to `ExpectedClass`.
4. Reject forbidden own property names (`__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`).
5. Reject those forbidden keys in own data-property `params` and `schema` objects without invoking user-defined getters.
6. Throw a typed error with stable code `UNSAFE_STRATEGY_INSTANCE` and a machine-readable reason; return the original instance on success.

The guard checks instance integrity against the exact constructor. It does not replace the AST scanner, class-inheritance validation, or the later P2 StrategyContract retirement.

## Integration scope

- Call the guard immediately after construction and before adaptation/validation in both `StrategyCompiler` construction paths.
- Call it immediately after construction in `strategyLoader.startStrategy()`, before symbol scoping, state restoration, or runtime lifecycle boot.
- Call it after construction in package `StrategyValidator.validate()`, preserving its existing diagnostic behavior for ordinary invalid classes.
- Keep the guard inside `corex-strategy-engine`; engine callers import it from the package public API.
- Do not remove or redesign `StrategyContract` in P1; that belongs to P2.
- Do not change the static scanner or its allow-list in P1; that is B3.

## Non-goals

- No P2 migration of `StrategyContract`.
- No P3 authoring/template changes.
- No P4/P5 `utils/strategy` or `BaseStrategy` deletion.
- No change to strategy lifecycle hooks, package aliases, sandbox resolution, broker contracts, or runtime identity.
- No broad validator rewrite and no compatibility shim.

## Acceptance criteria

1. Package unit tests cover valid base/subclass instances, invalid input types, unrelated constructors, constructors returning foreign objects, prototype replacement, forbidden own keys, and forbidden `params`/`schema` keys.
2. Compiler tests prove unsafe temporary and compile instances fail before `StrategyContract.adapt()` or metadata extraction.
3. Loader tests prove an unsafe runtime instance is rejected before runtime lifecycle boot and no runtime is registered/reserved as ACTIVE.
4. Package `StrategyValidator` uses the same guard without breaking its normal validation report for ordinary invalid strategies.
5. Existing strategy-engine, compiler, loader and runtime lifecycle tests pass.
6. The static scanner remains unchanged and continues to run before strategy compilation.
7. No changes outside this task's source, tests, task file and roadmap row.

## Verification plan

- Targeted guard unit tests.
- Targeted strategy compiler and loader tests.
- Full `corex-strategy-engine` package test suite.
- Relevant root compiler/loader/runtime test suites.
- `git diff --check`, syntax checks, and final changed-file audit.

## Handoff — 2026-11-20

Owner / agent: ChatGPT assisting Owen
Status: IMPLEMENTED — verification passed; final diff audit pending
Branch: `fix/strategy-instance-safety-guard`
Base: `origin/main` at `4c33ec7591ec023cfdc3708710dab642b91e8926`
Dependency gate: STAGE-1 PR #79 is open; its targeted genuine-client test and frontend build passed. Merge is not required by the roadmap entry gate.
Implementation:
- Added `src/validation/assertSafeInstance.js` with typed `UnsafeStrategyInstanceError`, stable code `UNSAFE_STRATEGY_INSTANCE`, machine-readable reasons, exact-prototype validation, own-constructor descriptor validation, forbidden own-key checks, and safe inspection of own data-property `params`/`schema`.
- Exported the guard and error from the `corex-strategy-engine` public API.
- Integrated the guard immediately after construction in both compiler paths, the runtime loader, and package `StrategyValidator`.
- Added 31 package test cases covering the guard and validator integration; added compiler and runtime-loader integration tests.
- The old `utils/strategy/StrategyValidator` remains untouched: repository search found it is used only by the explicit `scripts/validate-strategy.js` CLI. Legacy path retirement remains P5 scope.
Files changed: compiler, loader, package public index, package StrategyValidator, new guard, two new package tests, two root tests (one new compiler test and one loader regression test), this task record and roadmap row.
Verification:
- Full `corex-strategy-engine` package suite: 12 suites / 118 tests passed. The first full-suite attempt had one transient benchmark-threshold miss (2,404 ms vs. 2,000 ms); the benchmark passed in isolation (1,459 ms), and the complete suite passed on rerun (895 ms).
- Compiler integration: 2 tests passed; unsafe temporary and compile instances rejected before `StrategyContract.adapt()`.
- Loader integration plus recovery regression suite: 15 tests passed; unsafe runtime instance rejected before lifecycle boot, registry registration, or ACTIVE state. The regression directly spies on `RuntimeLifecycle.boot()`.
- The guard also normalizes a throwing Proxy `prototype` trap on the expected constructor to the typed `INVALID_EXPECTED_CLASS` failure; its unit test is included in the 118-test package pass.
- `git diff --check` passed; Git emitted only its normal LF-to-CRLF working-copy notice for the task document.
- Earlier package baseline before validator integration: 11 suites / 115 tests passed.
Unverified: Final changed-file audit and commit/push are still pending. The command service is responding again. No test failures remain in the verified P1 suites.
Decisions needed: None. Keep the static scanner separate; do not redesign `StrategyContract` in P1.
Blockers: None identified.
Exact next action: Complete the changed-file and branch audit, then commit and push P1 for review. Do not start B3 until P1 is reviewed/accepted under the roadmap dependency sequence.
May another agent continue? YES — only on this branch and within the bounded P1 scope.
