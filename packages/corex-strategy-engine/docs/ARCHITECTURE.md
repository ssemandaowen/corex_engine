# Architecture and boundaries

## Responsibility

`corex-strategy-engine` owns the strategy-domain implementation:

- Strategy base class and forward-only lifecycle hooks.
- Strategy context and strategy-local state.
- Strategy parameter schema, validation, resolution and patch semantics.
- Per-runtime candle history and indicator dispatch.
- Incremental indicator implementations and their registry metadata.
- Strategy authoring template, manifest and structural validation helpers.

The package is not the application composition root.

## Outside this package

The host engine owns:

- user/account identity, authorization and credentials;
- HTTP routes, WebSocket sessions and broadcasting;
- market-data provider selection, network connections and historical downloads;
- broker contracts, live/paper/backtest drivers and order execution;
- risk authority and portfolio-level limits;
- jobs, workers, scheduling, cancellation and runtime supervision;
- database repositories, reports, artifacts and persistence.

The package may return a signal/intent or accept a fill callback. It does not execute a broker order, write a database row or open a network connection.

## Runtime flow

```text
Host packet
   |
   v
Frame.load(packet) ---- invalid ----> reject packet (false)
   |
   v
StrategyDataManager
   | completed bar
   v
CandleStore (typed-array SoA)
   |
   v
IndicatorManager
   | dense Frame indicators + temporary legacy dispatch
   v
ContextBuilder
   |
   v
onBar(ctx, bar) / onTick(ctx, tick)
   |
   v
strategy signal or intent
   |
   v
Host execution authority
```

### Frame

`kernel/Frame.js` is the only normaliser for raw market packets. It coerces accepted numeric fields, validates finite values and OHLCV consistency, derives `hl2`, `hlc3`, and `ohlc4`, and returns `false` without mutating the previous frame when input is invalid.

`Frame.loadValues()` is a lower-level copy method for already-normalised typed-array data. It is not a second raw-packet normaliser.

### Candle history

`kernel/CandleStore.js` stores time/open/high/low/close/volume in independent `SlidingWindow` typed arrays. `pushFrame(frame)` is the single insertion operation. Public lookback methods intentionally materialise arrays/objects for consumers; the hot ingestion path does not retain an array of Frame instances.

### Indicators

`indicators/BaseIndicator.js` centralises:

- `value` and `prev` initialised to `NaN`;
- an independent `ready` flag;
- precomputed source-field lookup for open/high/low/close/volume/hl2/hlc3/ohlc4;
- Frame-only updates;
- reset, typed-array reseed and reconfiguration contracts.

`indicators/core/` contains reusable EMA and Wilder smoothing primitives. `IndicatorBank` is the dense named collection. `IndicatorRegistry` owns lazy loaders, aliases and metadata. `IndicatorManager` compiles configured instances and dispatches updates.

The registry's `cost` metadata is a complexity label, not a performance SLA. A declared `O(1)` implementation must be checked against its actual hot path and parameter changes.

### Parameters

`params/` is the single implementation home for static declaration collection, spec normalisation, validation, defaults, saved values, overrides, provenance, stale warnings and patch application. The top-level `ParamSchema.js` and `ParamResolver.js` are compatibility/public facades.

## Supported lifecycle

- `onStart(ctx)`
- `onBar(ctx, bar)`
- `onTick(ctx, tick)`
- `onFill(ctx, fill)`
- `onStop(ctx)`

The intended strategy contract is forward-only. Legacy names may still appear in validation/editor metadata; they are not an alternate adapter contract.

## Current integration limitation

This package is not yet standalone outside the CoreX monorepo. The current source imports host aliases for:

- `@utils/logger` in `Strategy.js`;
- `@config/constants` in `Strategy.js`, `StrategyDataManager.js`, and `StrategyRuntimeUtils.js`.

The package manifest/Jest configuration also contains workspace alias mappings. These are known package-purity debt, not a reason to introduce new host imports. Future cleanup should inject a logger through the construction boundary and move only the strategy-owned constants into a package-owned module, while preserving engine-facing behavior.

## Security boundary

The package does not sandbox strategy source. AST validation, module resolution, worker/process isolation and threat controls are owned by the application host. Do not describe the package or `vm.compileFunction` as a security sandbox.

## Explicit non-goals

- broker execution or broker state ownership;
- risk engine or portfolio risk decisions;
- network/provider adapters;
- database or artifact persistence;
- runtime scheduling and multi-process ownership;
- a strategy DSL;
- multi-symbol aggregation inside one runtime;
- automatic tick-level indicator updates for bar-close indicators.
