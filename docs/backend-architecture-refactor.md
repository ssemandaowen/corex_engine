# CoreX Backend Refactor (Signal Pipeline + Loader)

## File Structure

```
engine/
  core/
    strategy/
      StrategyContract.js
    lifecycle/
      ComponentLifecycle.js
    pipeline/
      SignalGenerationEngine.js
      SignalProcessingEngine.js
      SignalExecutionEngine.js
      index.js
    loader/
      StrategyLoader.js
```

## Loader Core Logic

1. `StrategyCompiler` compiles source and applies `StrategyContract.adapt`.
2. `StrategyBootloader` runs phased boot:
   `DISCOVERY -> VALIDATION -> COMPILATION -> LINKING -> INITIALIZATION -> REGISTRATION`.
3. Booted instances are stored in registry and can be started/stopped/reloaded at runtime without service restart.
4. Lifecycle is standardized through `ComponentLifecycle` with state snapshots and uniform log metadata.

## Signal Pipeline

1. `SignalGenerationEngine`: invokes strategy signal hooks (`generateSignal/onMarketData/onTick`).
2. `SignalProcessingEngine`: validates + normalizes signals.
3. `SignalExecutionEngine`: bounded concurrent queue executes adapter calls with backpressure metrics.

## HFT/Operations Additions

- DB migration: `db/migrations/20260221_hft_pipeline_optimizations.sql`.
- Maintenance cleanup script: `scripts/maintenance/prune-runtime-artifacts.js` (dry-run default).

