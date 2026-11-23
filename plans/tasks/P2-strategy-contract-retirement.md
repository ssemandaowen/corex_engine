# P2 — Strategy base-class ownership and StrategyContract retirement

**Status:** COMPLETE  
**Owner:** Owen Ssemanda (approval authority); Kilo Code implementing  
**Started:** 2026-11-21  
**Completed:** 2026-11-22  
**Dependencies:** P1 DONE (PR #80); B3 DONE (PR #57, merge commit `1f39d1fd87cba7d2b569c4120ddf16400b11878a`)  
**Roadmap:** `plans/ROADMAP.md`, P2  
**Checkout:** `C:\\Users\\SBUM\\Desktop\\corex` on `main`; HEAD `1f39d1fd87cba7d2b569c4120ddf16400b11878a`  
**Implementation branch / PR:** `fix/p2-strategy-contract-retirement` / PR #82 — MERGED as `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`

## Implementation Summary

### Files Created

| File | Purpose |
|------|---------|
| `test/StrategyClassIdentity.test.js` | Class-identity regression: compiler output, backtest instances all resolve to the public `corex-strategy-engine` `Strategy` constructor |

### Files Modified

| File | Change |
|------|--------|
| `packages/corex-strategy-engine/src/Strategy.js` | Removed `StrategyContract` import + `adapt(Strategy.prototype)` call; added `getStateSnapshot()`; populated `__corexApi` via package-owned `StrategyIntrospection.getStrategyApi()`; added singular `config.symbol` → canonical `symbols` normalization |
| `engine/services/strategyCompiler.js` | Removed `StrategyContract` import; removed `adapt()`/`validate()` calls from `validateAndExtractClass()` and `compile()`; removed `__corexApi` recomputation (now set by `Strategy` constructor) |
| `engine/strategyLoader.js` | Removed `StrategyContract` import; removed `StrategyContract.adapt(instance)` from `startStrategy()` |
| `engine/backtestManager.js` | Added `Strategy` import from `corex-strategy-engine`; `run()` checks `strategy instanceof Strategy` — canonical instances bypass `StrategyContract`, plain-object legacy path still uses `validateAndAdapt()` until P5 |
| `test/backtest-report-path.test.js` | Converted `makeStrategy()` plain-object fixture to a `Strategy` subclass; report/persistence assertions unchanged |

### Files Removed

None. `engine/core/strategy/StrategyContract.js` is preserved for the temporary BaseStrategy legacy path until P5 (per P2 explicit scope boundary).

### Legacy Dependencies Resolved

| Dependency | Status | Notes |
|------------|--------|-------|
| `Strategy.js` ← `@core/core/strategy/StrategyContract` | REMOVED | Package no longer imports from engine |
| `Strategy.js` ← `StrategyContract.adapt(Strategy.prototype)` | REMOVED | Prototype adaptation eliminated |
| `strategyCompiler.js` ← `StrategyContract.adapt()/validate()` | REMOVED | Compiler no longer adapts or validates |
| `strategyCompiler.js` ← `__corexApi` recomputation | REMOVED | `Strategy` constructor populates it |
| `strategyLoader.js` ← `StrategyContract.adapt()` | REMOVED | Loader no longer adapts instances |
| Backtest plain-object fixture → `Strategy` subclass | CONVERTED | `makeStrategy()` returns `Strategy` instance |

### Remaining Legacy Dependencies (intentionally preserved until P3/P5)

| Dependency | Owner | Reason |
|------------|-------|--------|
| `utils/BaseStrategy.js` ← `StrategyContract` | P5 | Explicitly temporary until P5 deletes legacy path |
| `engine/backtestManager.js` ← `StrategyContract` (plain-object path) | P5 | Kept for plain-object callers until all consumers migrated |
| `engine/core/strategy/StrategyContract.js` | P5 | Not deleted in P2; still used by BaseStrategy legacy path |

### Tests Executed

| Suite | Command | Result |
|-------|---------|--------|
| `packages/corex-strategy-engine` | `npm test` | 13 suites / 136 tests passed |
| `test/backtest-report-path.test.js` | `jest test/backtest-report-path.test.js` | 5 tests passed |
| `test/StrategyClassIdentity.test.js` | `jest test/StrategyClassIdentity.test.js` | 4 tests passed |
| `test/strategyCompiler.instanceSafety.test.js` | `jest test/strategyCompiler.instanceSafety.test.js` | 2 tests passed |
| Full repository | `npm test` | 79 suites / 947 tests passed |

### Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `Strategy.js` has no `@core` import and no `StrategyContract.adapt()` call | ✅ Verified — zero matches |
| 2 | Canonical `Strategy` instances provide `getStateSnapshot()`, immutable `__corexApi`, canonical `symbols` | ✅ Verified by tests |
| 3 | Compiler and loader paths do not call `StrategyContract.adapt()/validate()` | ✅ Verified — removed from both |
| 4 | Compiler no longer recomputes `__corexApi` | ✅ Verified — set by `Strategy` constructor |
| 5 | Compiler/loader/backtest share exact public `Strategy` constructor identity | ✅ Verified by `StrategyClassIdentity.test.js` |
| 6 | Backtest characterization green for both canonical and legacy paths | ✅ Verified — `backtest-report-path.test.js` passes |
| 7 | `executionController` receives same `__corexApi` array shape | ✅ Preserved — `getStrategyApi()` output unchanged |
| 8 | Package, compiler, loader, backtest suites pass | ✅ Verified — 947 tests pass |
| 9 | `git diff --check`, syntax checks pass | ✅ Verified — `node --check` passes on all modified files |

### Scope Compliance

| Boundary | Status |
|----------|--------|
| Provider registration / selection | Unchanged |
| DataProviderFactory behavior | Unchanged |
| Active provider default (Twelve Data) | Unchanged |
| 5,000-bar limit | Unchanged |
| Credential resolution | Unchanged |
| Execution connectors | Unchanged |
| MarketFeed behavior | Unchanged |
| Per-runtime sessions | Not implemented |
| Generic plugin framework | Not implemented |
| Dynamic provider discovery | Not implemented |
| OANDA integration | Not implemented |
| P3/P4/P5/P6 work | Not started |

### Deviations from Approved Proposal

None. All changes are within the P2 bounded scope defined in `plans/tasks/P2-strategy-contract-retirement.md`.

### Planning

- **Task file:** `plans/tasks/P2-strategy-contract-retirement.md` — updated to COMPLETE with implementation evidence
- **Roadmap:** P2 row reconciled to `DONE`; PR #82 merged as `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`.
- **Next workstream:** P3 (authoring surface / template migration) is now active.

### Remaining Issues

None within P2 scope. All acceptance criteria are met with passing tests.
