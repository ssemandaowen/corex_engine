# Public API

The CommonJS package entry point is `index.js`. Prefer importing through `require("corex-strategy-engine")`; direct `src/...` imports are internal implementation details unless a host integration has explicitly pinned them.

## Exports

| Export | Responsibility |
|---|---|
| `Strategy` | Base class for the forward-only strategy lifecycle |
| `ta` | Crossover/crossunder and series predicates |
| `util` | Numeric rounding and basic position-size helper |
| `ParamSchema` | Static parameter collection, schema conversion, defaults, patching and diff |
| `resolveParams` | Resolve schema defaults, saved values and overrides |
| `ParamResolutionError` | Typed parameter resolution error |
| `IndicatorManager` | Configured indicator construction and runtime dispatch |
| `IndicatorBank` | Dense named indicator collection |
| `BaseIndicator` | Frame-based indicator contract |
| `EmaCore`, `WilderCore` | Reusable numeric smoothing cores |
| `IndicatorRegistry` | Registry implementation |
| `UnknownIndicatorError` | Typed unknown-indicator error |
| `globalIndicatorRegistry`, `indicators` | Default registry and lazy indicator accessors |
| `ContextBuilder` | Persistent strategy context implementation |
| `getStrategyApi` | Public strategy API introspection |
| `StrategyValidator`, `StrategyManifest` | Static validation and authoring metadata |
| `assertSafeInstance`, `UnsafeStrategyInstanceError` | Post-construction instance-integrity guard |
| `Position` | Strategy-local position model |
| `PlotBuffer` | Bounded plot/mark storage |
| `StrategyStateStore` | Strategy-local key/value state |
| `StrategyRuntimeUtils` | Runtime helper methods |
| `StrategyDataManager` | Per-symbol candle history and warmup state |

## Strategy declaration

A strategy class may declare:

- `static symbols: string[]` — symbols assigned to this runtime;
- `static timeframe: string` — timeframe used by the host;
- `static lookback: positive integer` — retained history requirement;
- `static params: object` — typed parameter specs/defaults;
- `static indicators: object` — named indicator definitions.

A runtime is configured for one symbol. Multi-symbol orchestration belongs to the host, which creates distinct runtime instances.

## Lifecycle context

The persistent `ctx` object exposes:

### Properties

- `symbol`, `price`, `close`, `time`, `isBar`, `barTime`;
- `params`, `indicators`, `state`;
- `position` and `engine` telemetry;
- `ta` and `util` helper facades;
- `go` forward-only intent helpers.

### Methods

- `ctx.hasBars(count, symbol?)`
- `ctx.requireBars(count, indicatorName?, symbol?)`
- `ctx.plot(name, value)`
- `ctx.mark(name, message)`
- `ctx.flat(quantity?, price?)`
- `ctx.go.long(quantity?, price?)`
- `ctx.go.short(quantity?, price?)`
- `ctx.go.scale(quantity?, price?)`
- `ctx.go.protect({ sl?, tp?, trailPct? })`

The returned values are intents/signals for the host. They are not proof that a broker accepted or filled an order.

## Indicator access

A configured indicator is available by its declared key under `ctx.indicators`. Read `ready` before consuming `value`. Before warmup, `value` and `prev` are `NaN`; `ready` is `false`.

Indicator sources supported by the Frame-based contract:

- `open`, `high`, `low`, `close`, `volume`;
- `hl2`, `hlc3`, `ohlc4`.

## TA helper facade

`ctx.ta` (same object exported as `ta`) provides:

- `crossover(a, b)`, `crossunder(a, b)` — compare current and previous scalar/indicator values;
- `highest(values, length)`, `lowest(values, length)`;
- `rising(values, length = 1)`, `falling(values, length = 1)`;
- `change(values, length = 1)`.

These are small series helpers, not the indicator registry. Use configured incremental indicators for streaming calculations.

## Parameter resolution

The parameter pipeline is:

1. collect static declarations through the class hierarchy;
2. normalise specs and defaults;
3. validate integer/number/enum/range/step constraints;
4. resolve defaults, persisted values and runtime overrides with provenance;
5. apply schema-aware patches and report invalid/unknown keys.

Integer parameters reject fractional values. See `src/params/` and `test/params/`.

## Contract cautions

- `ctx.position` is telemetry, not the application execution authority.
- `ctx.go.*` returns a strategy signal/intent; broker submission and fill state are host-owned.
- `ctx.time` and `ctx.barTime` are packet/bar timestamps; wall-clock scheduling is host-owned.
- `Strategy.math` currently exposes the `mathjs` package through a shared instance. Treat it as mutable shared state; this is tracked for future hardening.
- Strategy source execution is not sandboxed by this package.
