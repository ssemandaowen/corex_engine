# P2 — Strategy base-class ownership and StrategyContract retirement

**Status:** IN PROGRESS — implementation and full-repository verification complete; PR #81 open, review pending
**Owner:** Owen Ssemanda (approval authority); ChatGPT assisting investigation and implementation
**Started:** 2026-11-21
**Dependencies:** P1 DONE (PR #80); B3 DONE (PR #57, merge commit `1f39d1fd87cba7d2b569c4120ddf16400b11878a`)
**Roadmap:** `plans/ROADMAP.md`, P2
**Current checkout:** `C:\\Users\\SBUM\\Desktop\\corex` on `main`; clean before this planning update
**Implementation branch / PR:** `p2-strategy-contract-retirement`; PR #81 (OPEN). Worktree: `C:\\Users\\SBUM\\Desktop\\corex-p2`; main checkout remains untouched.

## 1. Goal

Make `corex-strategy-engine`'s exported `Strategy` class the authoritative base for the current package-based strategy path. Move the remaining base-class responsibilities out of the engine-owned `StrategyContract` adapter:

- `getStateSnapshot()`
- `__corexApi` introspection metadata
- singular `symbol` to canonical `symbols` normalization

Remove the package's dependency on `engine/core/strategy/StrategyContract.js` and stop adapting canonical `Strategy` instances through that engine contract.

The class-identity test is a required boundary check: compiler, loader, runtime and backtest must all recognize the same `Strategy` constructor exported by `corex-strategy-engine`.

## 2. Current evidence

Repository inspection on the current `main` checkout:

- `packages/corex-strategy-engine/src/Strategy.js` imports `@core/core/strategy/StrategyContract` and calls `StrategyContract.adapt(Strategy.prototype)` at the bottom of the module. This is a package-to-engine dependency inversion.
- `Strategy.js` already owns construction, symbols, lifecycle hooks, state, context and signal generation. Its constructor currently accepts `config.symbols` or static `symbols`, but not a singular `config.symbol` fallback.
- `StrategyContract.adapt()` supplies `getStateSnapshot`, `__corexApi`, and singular-symbol normalization.
- `engine/services/strategyCompiler.js` calls `adapt()` and `validate()` in both compiler construction paths. Its full `compile()` path also independently computes `__corexApi` using `getStrategyApi()`, duplicating the base-class metadata responsibility.
- `engine/strategyLoader.js` adapts each newly constructed runtime instance.
- `engine/backtestManager.js` calls `StrategyContract.validateAndAdapt()`. The existing `test/backtest-report-path.test.js` fixture passes a plain object, not a package `Strategy` instance.
- `packages/corex-strategy-engine/src/validation/StrategyValidator.js` already checks inheritance from the package's `Strategy` class and uses the P1 `assertSafeInstance` guard.
- `utils/BaseStrategy.js`, the current `utils/template.txt`, and the stored `::demo` strategy still depend on the legacy contract path. P3/P5 own their migration and removal; deleting the contract outright in P2 would break that still-present legacy path.
- P1's package-owned `assertSafeInstance` already checks exact constructor/prototype identity and forbidden own/container keys. P2 must not reintroduce or duplicate the old contract's prototype-pollution checks.

## 3. Bounded implementation scope

### Canonical package-based Strategy path

1. Implement `getStateSnapshot()` directly on `Strategy.prototype`, preserving the established snapshot fields: `id`, `name`, `symbols`, `timeframe`, and `mode`.
2. Populate `__corexApi` from the package-owned `StrategyIntrospection` implementation for each canonical strategy instance. Keep it immutable as it is today. The compiler must consume this value rather than recomputing it.
3. Normalize a singular configured/static `symbol` into the canonical `symbols` array when no non-empty `symbols` array is supplied. Preserve the existing explicit multi-symbol behavior; do not add a new symbol configuration system.
4. Remove the `StrategyContract` import and prototype adaptation from `packages/corex-strategy-engine/src/Strategy.js`.
5. Remove contract adaptation/validation from the canonical `Strategy` compiler and loader path. Use the public `corex-strategy-engine` `Strategy` constructor identity and the existing `assertSafeInstance` boundary; preserve current compile metadata and lifecycle behavior.
6. Backtests using the canonical path must receive a real instance of the same package `Strategy` class. Convert the plain-object characterization fixture to a small `Strategy` subclass and retain its report/persistence assertions.
7. Add a regression proving the strategy source, compiler, loader/runtime instance and backtest all resolve and use the same public `Strategy` constructor. Do not introduce a second package loader or another registry.

### Explicit legacy boundary

The existing `BaseStrategy` path is still used by the old template and stored `::demo` record. The backtest manager also has a plain-object characterization path that relies on the same adapter. Until P3 migrates the authoring template/demo and P5 removes legacy source, the contract may remain only for these existing legacy inputs. P2 must not add new legacy consumers or make the old adapter the canonical interface.

This is a temporary migration boundary, not the target architecture. Full deletion of `StrategyContract.js` belongs with P5 after the legacy consumers are gone.

## 4. Non-goals

- Do not migrate `utils/template.txt` or the stored `::demo` strategy here; that is P3.
- Do not repatriate `utils/strategy` modules here; that is P4.
- Do not delete `utils/BaseStrategy.js`, its remaining helpers, or the final legacy contract path before P5.
- Do not redesign the strategy DSL, lifecycle hooks, schema/configuration system, runtime identity, broker interfaces, or execution authority.
- Do not expand SEC-01 execution isolation or SEC-03 worker AST-validation ownership.
- Do not add a new validation framework. Reuse the package's `Strategy`, `StrategyValidator`, and P1 `assertSafeInstance` where they fit.
- Do not make unrelated backtest pipeline changes.

## 5. Acceptance criteria

1. `packages/corex-strategy-engine/src/Strategy.js` has no import from `@core` and no `StrategyContract.adapt(Strategy.prototype)` call.
2. Canonical `Strategy` instances provide `getStateSnapshot()`, immutable `__corexApi`, and canonical `symbols` without engine-side adaptation.
3. Canonical compiler and loader paths do not call `StrategyContract.adapt()` or `StrategyContract.validate()`; the temporary legacy branch is limited to `BaseStrategy` until P5.
4. The compiler no longer recomputes `__corexApi` for canonical instances; its returned metadata remains equivalent.
5. Compiler, loader/runtime and backtest regression tests prove they share the exact public `corex-strategy-engine` `Strategy` constructor identity.
6. Backtest report/persistence characterization remains green for both paths: a canonical package `Strategy` instance bypasses `StrategyContract`, while the existing plain-object/legacy adapter characterization remains intact until P5.
7. `executionController` continues to receive the same `api` array shape from `instance.__corexApi`.
8. Relevant package, compiler, loader/runtime and backtest suites pass; full repository test results and any pre-existing failures are reported accurately.
9. `git diff --check`, changed-file audit and syntax checks pass.

## 6. Verification plan

- Package tests for snapshot fields, `__corexApi` immutability/content and singular-symbol normalization.
- Compiler integration test using a strategy source that imports `Strategy` from the exact public package entrypoint.
- Loader/runtime test proving the created instance retains the same package constructor/prototype identity.
- Backtest integration/characterization test using the canonical package Strategy class.
- Run all affected Jest suites, then the full repository suite if practical.
- Search all production references to `StrategyContract` and classify any remaining reference as the explicitly temporary BaseStrategy legacy path.

## 7. Handoff / implementation notes

- The old `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md` contains a broader proposed removal order. It is evidence, not an instruction to pull P3/P4/P5 work into P2.
- The roadmap is authoritative. P3 owns template/demo migration; P4 owns `utils/strategy` repatriation; P5 owns final legacy deletion and removal of the remaining contract.
- Keep P2 to one coherent implementation PR.

## 8. Implementation and verification

Implemented in `p2-strategy-contract-retirement`:

- `Strategy.js` now owns `getStateSnapshot()`, lazy immutable `__corexApi` metadata via package-owned `StrategyIntrospection`, and singular `config.symbol` / static `symbol` normalization. The package no longer imports or adapts through `StrategyContract`.
- Compiler and loader identify the exact exported package `Strategy` constructor. Their temporary adapter path is restricted to the actual legacy `BaseStrategy`; unknown strategy base classes are rejected. The backtest manager retains its existing plain-object adapter path only for the explicit legacy characterization input.
- Backtests accept canonical package `Strategy` instances without calling `StrategyContract`; the legacy plain-object characterization remains green.
- The recovery test fixture now extends the public package `Strategy`, matching the loader's canonical runtime contract instead of relying on an arbitrary fake class.
- Added package, compiler, loader, backtest and unsupported-base regressions. No template/demo migration, `utils/strategy` move or legacy deletion was included.

Verification on 2026-11-21 (Node v22.20.0):

- Full Jest suite: **67 suites / 772 tests passed** (`--runInBand --forceExit --testTimeout=25000`).
- Focused P2 suites: 4 suites / 25 tests passed; recovery suite: 1 suite / 15 tests passed.
- `node --check` and `git diff --check` passed for the implementation before the final test-fixture adjustment; the final recovery test and full repository suite passed after that adjustment.

Remaining gate: obtain review on PR #81, then Owen decides merge. Do not mark P2 DONE before it is merged. Do not fold unrelated security, worker, backtest-pipeline or engine-coordination work into it.
