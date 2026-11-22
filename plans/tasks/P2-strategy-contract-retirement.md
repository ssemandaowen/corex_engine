# P2 — Strategy base-class ownership and StrategyContract retirement

**Status:** IN PROGRESS
**Owner:** Owen Ssemanda (approval authority); implementation isolation by ChatGPT, initial implementation by Kilo Code
**Started:** 2026-11-21
**Implementation isolated:** 2026-11-22
**Dependencies:** P1 DONE (PR #80); B3 DONE (PR #57, merge commit `1f39d1fd87cba7d2b569c4120ddf16400b11878a`)
**Roadmap:** `plans/ROADMAP.md`, P2
**Worktree:** `C:\Users\SBUM\Desktop\corex-p2-isolation`
**Branch:** `fix/p2-strategy-contract-retirement`
**Base:** `origin/main` at `1f39d1fd87cba7d2b569c4120ddf16400b11878a`
**PR:** Pending publication.

## Scope

Remove `StrategyContract` from the canonical `Strategy` path. The strategy package owns state snapshots, API introspection and singular-symbol normalization. Keep the legacy plain-object backtest path and `StrategyContract` implementation for the later P5 migration.

## P2 implementation files

| File | Change |
|---|---|
| `packages/corex-strategy-engine/src/Strategy.js` | Removed engine `StrategyContract` dependency and prototype adaptation; added `getStateSnapshot()`; added canonical `config.symbol` → `symbols` normalization; exposed frozen `__corexApi` through a package-owned lazy getter so subclass class-field methods are included after construction. |
| `engine/services/strategyCompiler.js` | Removed `StrategyContract.adapt()/validate()` from both compile paths and removed compiler-side `__corexApi` assignment. Compiler metadata introspection remains. |
| `engine/strategyLoader.js` | Removed `StrategyContract` import and runtime adaptation. The loader constructs the compiler-returned public Strategy class directly. |
| `engine/backtestManager.js` | Canonical `Strategy` instances bypass `StrategyContract`; plain-object callers retain the legacy validation/adaptation path until P5. |
| `test/backtest-report-path.test.js` | Characterizes the canonical Strategy path and retains a separate legacy plain-object regression test. |
| `test/StrategyClassIdentity.test.js` | Covers public constructor identity, snapshots, frozen API, subclass class-field API methods, singular-symbol normalization, compiler, loader, backtest and executionController telemetry API handoff. |

## Explicit exclusions

The isolated branch does not include B1 `safeFilename`, SymbolBinder, ParamResolver, schema-state tracking, provider manifests, instrument normalization, or any other provider/runtime-binding work. No BaseStrategy deletion, broad utils cleanup, folder move, broker change, or P3/P4/P5 work is included.

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Strategy package has no engine `@core` import or `StrategyContract.adapt(Strategy.prototype)` | PASS |
| 2 | Canonical Strategy provides state snapshot, immutable API and singular-symbol normalization | PASS |
| 3 | Compiler and loader no longer adapt/validate canonical instances through StrategyContract | PASS |
| 4 | Compiler no longer assigns/recomputes instance `__corexApi` | PASS |
| 5 | Compiler, loader-created instances and backtest use the public Strategy constructor identity | PASS — explicit identity tests |
| 6 | Canonical backtest path and legacy plain-object path remain functional | PASS — both paths covered |
| 7 | executionController telemetry returns the exact constructor-owned frozen `__corexApi` array | PASS — actual `/telemetry/:id` handler exercised; reference equality asserted |
| 8 | Focused and full repository tests pass | PASS — focused 3 suites / 14 tests; full 68 suites / 773 tests |
| 9 | Syntax checks and `git diff --check` pass | PASS |

## Verification evidence

- `node --check` passed for all six implementation/test files.
- `git diff --check` passed.
- Focused Jest run: 3 suites / 14 tests passed.
- Full repository Jest run from the isolated `origin/main` worktree: 68 suites / 773 tests passed.
- Jest was invoked with `--forceExit` because this checkout leaves asynchronous handles open after tests complete; all suites/tests reported PASS before the forced exit. This is recorded as a test-runner limitation, not represented as a P2 behavior failure.
- The earlier 79 suites / 947 tests report came from the mixed checkout and is not the clean-main baseline. The isolated worktree is the authoritative verification for this PR.

## Remaining legacy path

- `utils/BaseStrategy.js` continues to use `StrategyContract` until P5.
- `engine/backtestManager.js` retains `StrategyContract.validateAndAdapt()` only for non-canonical plain-object callers until P5.
- `engine/core/strategy/StrategyContract.js` remains in place until P5.

## Handoff

Do not mark P2 DONE before review and merge. Publish one P2-only PR, update the P2 roadmap row with its branch/PR in that same PR, and leave P2 awaiting review. The roadmap's DONE status and merge SHA are recorded only after the merge outcome is known.
