# AGENTS.md — corex-strategy-engine

Package: `corex-strategy-engine` — Declarative strategy base class, ContextBuilder, IndicatorManager, ta/util helpers, PlotBuffer, and StrategyValidator.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@root`, `@core`, `@utils`, `@config`, `@events`, `corex-broker-contract`, `corex-strategy-engine`.

## Architecture

### Locked Principles
- **Zero-allocation hot path**: `ContextBuilder` reuses a single persistent `_ctx` object across packet evaluations rather than instantiating new objects on every tick.
- **Fixed 5-hook lifecycle**: `onStart`, `onBar`, `onTick`, `onFill`, `onStop`. Do not add new lifecycle hooks without explicit architectural approval.
- **No EventEmitters in hot path**: `_processData` and `updateForPacket` must remain synchronous and must not instantiate or emit EventEmitters to preserve high throughput.
- **Incremental O(1) indicator updates**: Indicators update incrementally per tick/bar rather than re-calculating entire historical lookback series.

### Core Modules
- `src/Strategy.js` — Base strategy class handling lifecycle, parameters, position state, data ingestion, and signal generation.
- `src/ContextBuilder.js` — Constructs and updates persistent `ctx` execution context.
- `src/IndicatorManager.js` & `src/IndicatorRegistry.js` — Dispatches and updates incremental indicator state.
- `src/StrategyDataManager.js` & `src/SoACandleStore.js` — Bounded history ring buffer for price bars.
- `src/PlotBuffer.js` — Bounded ring storage for `ctx.plot()` series data and `ctx.mark()` event markers.
- `src/StrategyStateStore.js` — Key-value state persistence store.
- `src/Position.js` — Strategy-level position representation.
- `src/ParamSchema.js` — Strategy parameter collection, schema conversion, patching, and serialization.
- `src/ta.js` & `src/util.js` — Technical analysis and utility helper functions.
- `src/validation/StrategyValidator.js` & `src/validation/StrategyManifest.js` — Static AST and structure verification tools.

## Boundaries (do not violate without asking Owen)
- **No broadcaster / engine coupling**: `corex-strategy-engine` is a pure-logic package. WebSocket broadcasting, event bus wiring, and runtime interval polling are strictly owned by `engine/` (`RuntimeRegistry.js`, `broadcaster.js`). Do not import `broadcaster.js` or `engine/` services into this package.
- **No per-tick I/O or heap allocation in the hot path**: Keep `_processData` and `updateForPacket` allocation-free.
- **No EventEmitters in packet processing**: Do not instantiate or emit EventEmitters inside `_processData`.
- **No network or blocking calls**: Strategy execution must remain strictly synchronous during `onTick` and `onBar`.

## Human verification required
- **Worker Pool / Concurrency Model**: Worker thread isolation (`workerPool.js` / multi-process execution) is an architectural plan and is not implemented or verified end-to-end.
- **Multi-Symbol Cross-Pair Live Execution**: Execution across multiple concurrent live symbol feeds requires human verification with live broker feeds.
