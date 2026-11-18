# CoreX Strategy Engine Finalization Audit & Shim Catalog

Date: $(date)
Package: `packages/corex-strategy-engine`

## Overview
This document records the finalization work on `packages/corex-strategy-engine`, including migration shims left behind for legacy compatibility, module ownership, and removal conditions.

## Migration Shim Catalog

| Legacy Path | Internal Package Path | Owner | Purpose & Removal Condition |
| --- | --- | --- | --- |
| `utils/strategy/StrategyParamUtils.js` | `packages/corex-strategy-engine/src/StrategyParamUtils.js` | corex-strategy-engine | **MIGRATION SHIM: remove by 2026-12-31.** Legacy shim delegating to package module until all root callers migrate. |
| `utils/strategy/StrategyStateStore.js` | `packages/corex-strategy-engine/src/StrategyStateStore.js` | corex-strategy-engine | **MIGRATION SHIM: remove by 2026-12-31.** Legacy shim delegating to package module until all root callers migrate. |
| `utils/strategy/StrategyDataManager.js` | `packages/corex-strategy-engine/src/StrategyDataManager.js` | corex-strategy-engine | **MIGRATION SHIM: remove by 2026-12-31.** Legacy shim delegating to package module until all root callers migrate. |
| `utils/strategy/StrategyManifest.js` | `packages/corex-strategy-engine/src/validation/StrategyManifest.js` | corex-strategy-engine | **MIGRATION SHIM: remove by 2026-12-31.** Legacy shim delegating to package module until all root callers migrate. |
| `utils/strategy/StrategyValidator.js` | `packages/corex-strategy-engine/src/validation/StrategyValidator.js` | corex-strategy-engine | **MIGRATION SHIM: remove by 2026-12-31.** Legacy shim delegating to package module until all root callers migrate. |

## Verification Checkpoints
1. No file inside `packages/corex-strategy-engine/src` imports `@utils`, `@core`, or `@config`.
2. All 87 package tests pass.
3. Full test suite passes without regressions from baseline.
4. `StrategyManifest` generates `ctx.plot`, `ctx.mark`, and `ctx.go.*` methods.
5. `StrategyValidator` and `StrategyManifest` read indicator names from `IndicatorRegistry`.
