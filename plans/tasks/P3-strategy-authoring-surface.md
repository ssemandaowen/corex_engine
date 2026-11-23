# P3 — Strategy Authoring Surface

**Status:** IMPLEMENTATION IN PROGRESS — template aligned to current Strategy API; final contract tests pending  
**Implementation:** Kilo Code initial migration; ChatGPT template/controller refinement  
**Branch:** `main` (changes maintained in the main checkout as directed by Owen)  
**Active checkout:** `C:\Users\SBUM\Desktop\corex` (`main`)  
**Started:** 2026-11-22  
**Completed:** 2026-11-22  
**Dependencies:** P2 DONE (PR #82, merged `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`), P1 DONE, B3 DONE  
**Roadmap:** `plans/ROADMAP.md`, P3  
**Checkout:** `C:\Users\SBUM\Desktop\corex` on `main`; existing uncommitted work is preserved in place.

## Implementation Summary

### Files Created

| File | Purpose |
|------|---------|
| `packages/corex-strategy-engine/src/strategyTemplate.txt` | Package-owned authoring template with typed static params, declarative EMA indicators, `onStart`/`onBar`/`onTick`/`onFill`/`onStop`, context guards, plots, marks and order helpers |
| `plans/tasks/P3-strategy-authoring-surface.md` | This task file |

### Files Modified

| File | Change |
|------|--------|
| `engine/routes/strategyController.js` | Resolves the package template relative to the controller module and fails closed if the canonical template is missing; no invalid plain-class fallback |
| `scripts/validate-strategy.js` | `StrategyValidator` import repointed from `../utils/strategy/StrategyValidator` to `corex-strategy-engine` |
| `scripts/sync-strategy-manifest.js` | `StrategyManifest` import repointed from `@utils/strategy/StrategyManifest` to `corex-strategy-engine` |
| `packages/corex-strategy-engine/README.md` | Authoring API docs aligned with the package template and actual tick-hook behavior |
| `test/strategyCompiler.moduleResolution.test.js` | Template path repointed to package template; assertions updated to check `Strategy` instance + lifecycle hooks |
| `packages/corex-strategy-engine/README.md` | Authoring API documentation aligned with the package template and actual tick-hook behavior |
| `plans/ROADMAP.md` | P2→DONE (PR #82, `f71fdfc`); ENGINE-02B-P0-1→DONE (PR #66, `da7dfd63`); P3→IN PROGRESS |

### Files Removed

| File | Reason |
|------|--------|
| `utils/template.txt` | Legacy template removed — all consumers repointed to package-owned template; no duplicate template ownership |

### Tests Executed

| Suite | Command | Result |
|-------|---------|--------|
| `test/strategyCompiler.moduleResolution.test.js` + `packages/corex-strategy-engine/test/Strategy.test.js` | `jest --runInBand` | 12/12 tests passed after the template API refinement |
| Generated-template smoke validation | In-memory template substitution + public `StrategyValidator.validate()` | Pass — package inheritance, schema/indicators and all five lifecycle hooks verified |
| `packages/corex-strategy-engine` | `jest packages/corex-strategy-engine` | 12 suites / 125 tests passed |
| `node --check` on all modified `.js` files | — | Pass |
| `git diff --check` | — | Pass (no whitespace issues) |

### Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Template exists in `packages/corex-strategy-engine/src/` extending package `Strategy` | ✅ `strategyTemplate.txt` extends `Strategy` |
| 2 | Template uses actual `onBar(ctx, bar)` / `onTick(ctx, tick)` hook signatures | ✅ Matches Strategy hook dispatch |
| 3 | `strategyController.js` resolves the package template independently of process cwd and fails closed if missing | ✅ Module-relative path; no non-Strategy fallback |
| 4 | `validate-strategy.js` imports `StrategyValidator` from `corex-strategy-engine` | ✅ Import repointed |
| 5 | `sync-strategy-manifest.js` imports `StrategyManifest` from `corex-strategy-engine` | ✅ Import repointed |
| 6 | Template compiles and strategy package regression tests pass | ✅ 12/12 focused tests passed after template refinement; dedicated template contract test pending |
| 7 | `node --check` passes on all modified JS files | ✅ Pass |
| 8 | `git diff --check` passes | ✅ Pass |
| 9 | No duplicate template ownership | ✅ `utils/template.txt` removed |
| 10 | Generated template validates against package Strategy and current lifecycle | ✅ In-memory generated-class smoke validation passed; dedicated behavior test pending |

## Scope Compliance

| Boundary | Status |
|----------|--------|
| `utils/BaseStrategy.js` | Preserved — deletion is P5 |
| `utils/strategy/*` | Preserved — repatriation is P4 |
| `StrategyContract` | Preserved — deletion is P5 |
| Backtesting | Not touched — extraction is P7 |
| Broker/execution | Not touched |
| Broad `utils/` cleanup | Not performed |

## D4 — `::demo` Deletion Status

**Not executed.** D4 approval not granted. The `::demo` strategy row (`8bb1780d-977e-4075-8525-312035860760::demo`) and its runtime row remain untouched.

**Read-only before counts (from `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`):**
- 1 `::demo` strategy row (`strategies.runtime_state` = `RUNNING`, stale)
- 1 `::demo` runtime row (`...::demo::BTC/USD::PAPER` = `STOPPED`, updated 2026-11-11T20:33:34Z)
- 1 orphan `ema_crossover` runtime row also identified

**Proposed deletion scope (requires D4 approval):** Delete the `::demo` strategy row and its associated runtime row. Before counts: 2 rows; After counts: 0 rows.

## Planning

| Item | Status |
|------|--------|
| Task file | `plans/tasks/P3-strategy-authoring-surface.md` — COMPLETE |
| Roadmap P2 row | Updated to DONE with PR #82 and merge SHA `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b` |
| Roadmap ENGINE-02B-P0-1 row | Updated to DONE with PR #66 and merge SHA `da7dfd63f1c94c2d7657945ef91635f8808b9639` |
| Roadmap P3 row | Set to IN PROGRESS with branch `p3-strategy-authoring-surface` |
| Completed workstreams table | P2 and ENGINE-02B-P0-1 added with merge SHAs |
| Next workstream | P4 — repatriate `utils/strategy`; P5 remains the subsequent legacy deletion stage |

## Remaining Limitations

- P3 PR not yet created/submitted — implementation has been migrated into the main checkout and awaits review/PR creation
- `::demo` deletion blocked on D4 approval
- `utils/BaseStrategy.js` deletion deferred to P5
- `utils/strategy/*` repatriation deferred to P4