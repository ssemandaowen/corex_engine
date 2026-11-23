# corex-strategy-engine

**CoreX strategy domain package** — strategy lifecycle, per-runtime market-data state, incremental technical indicators, parameter contracts, strategy context, and authoring validation.

This package is consumed by the CoreX application engine. It does not connect to brokers, fetch market data, persist database records, schedule jobs, or broadcast events. The application engine supplies packets and lifecycle calls and owns execution, persistence, scheduling, credentials, and transport.

## Status

- Strategy package structure and public API are documented in `docs/`.
- Strategy lifecycle and indicator pipeline are implemented and covered by the package test suite.
- The indicator catalogue contains 50 registered types. **20 currently have known full-series parity divergences** against the selected independent references; see [Known issues](docs/KNOWN_ISSUES.md) and [the divergence report](test/reference/DIVERGENCE.md).
- Indicator-family correctness work is deliberately separate from package structure/documentation completion. Do not treat registration as a certification of mathematical correctness.
- This is a CoreX workspace package, not yet a clean-room standalone npm package. A small number of imports still resolve through the host repository aliases; see [Architecture and boundaries](docs/ARCHITECTURE.md).

## Supported strategy lifecycle

Strategy classes extend the package-owned `Strategy` base class and implement the forward-only lifecycle:

| Hook | Purpose |
|---|---|
| `onStart(ctx)` | Initialise strategy-local state when runtime data begins |
| `onBar(ctx, bar)` | Process a completed bar |
| `onTick(ctx, tick)` | Process a raw tick when tick mode is enabled |
| `onFill(ctx, fill)` | React to an execution fill reported by the host |
| `onStop(ctx)` | Release strategy-local resources |

There is no legacy `BaseStrategy` adapter or imperative indicator adapter in the supported package contract. Strategies are classes; there is no DSL.

## Authoring surface

The template is [src/strategyTemplate.txt](src/strategyTemplate.txt). It demonstrates:

- static `symbols`, `timeframe`, and `lookback`;
- typed static `params` with defaults and constraints;
- declarative `indicators` with registry type, parameter and source;
- lifecycle hooks;
- context state, readiness guards, plotting, marks and forward-only order intents.

See [Public API](docs/API.md) for the package exports and context members.

## Runtime pipeline

1. The host supplies a packet to the strategy.
2. `Frame.load(packet)` is the raw packet normalisation boundary. Invalid packets return `false`.
3. `StrategyDataManager` writes completed bars into the typed-array `CandleStore`.
4. `IndicatorManager` updates configured indicators in compiled dense arrays.
5. `ContextBuilder` refreshes the persistent `ctx` object and invokes the selected lifecycle hook.
6. Strategy intents/signals are returned to the host. The package does not submit broker orders itself.

The normal bar pipeline is bar-close oriented. Raw-tick strategy hooks are supported, but configured indicators are not promised to update on every tick. See [Architecture and boundaries](docs/ARCHITECTURE.md).

## Package map

```text
corex-strategy-engine/
  index.js                  Public CommonJS entry point
  src/
    Strategy.js             Strategy lifecycle and signal domain
    ContextBuilder.js       Persistent strategy context
    StrategyDataManager.js  Per-symbol candle/history owner
    IndicatorManager.js     Indicator configuration and dispatch
    IndicatorRegistry.js    Lazy registry, aliases and metadata
    IndicatorBank.js        Dense named indicator collection
    indicators/             One implementation per indicator + shared base/cores
    kernel/                 Frame, CandleStore, sliding windows and numeric primitives
    params/                 Parameter collection, validation, resolution and patching
    validation/             Strategy manifest and structural/safety checks
    ta.js                   Small strategy-facing TA helper facade
    util.js                 Small strategy-facing utility facade
    strategyTemplate.txt    Canonical authoring template
  test/
    architecture/           Layer and boundary contracts
    characterisation/       Debt ratchet, golden and full-series parity
    indicator-core/         Base, registry, bank and manager contracts
    indicator-families/     Indicator implementation tests by family
    kernel/                 Frame, store and numeric primitive tests
    params/                  Parameter contract tests
    reference/               Independent reference implementations and parity tests
  bench/                    Bar-close benchmark and memory smoke
  docs/                     Architecture, API, indicator catalogue and open issues
```

The one-file-per-indicator layout is intentional: the registry lazy-loads implementations independently, and each indicator owns its recurrence, readiness and output shape. `ta.js` is intentionally a small facade for generic series predicates; it is not the container for all indicator implementations.

## Installation and use in CoreX

The package is currently loaded from the monorepo workspace:

```js
const {
  Strategy,
  indicators,
  globalIndicatorRegistry,
  IndicatorManager,
  ParamSchema
} = require("corex-strategy-engine");
```

The package requires Node.js 18 or later. Its current runtime dependencies are declared in `package.json`. The package still uses host-repository aliases for logger/config integration, so it must be loaded through the CoreX workspace configuration until the remaining package-purity work is completed.

## Verification commands

Run from `packages/corex-strategy-engine`:

```powershell
npm test -- --runInBand
npm run test:ratchet
npm run test:memory
npm run bench
```

- `test`: package unit, integration, architecture, kernel, parameter and reference tests.
- `test:ratchet`: accepted debt counts for selected legacy patterns.
- `test:memory`: warmed retained-heap smoke check.
- `bench`: alternating old Map dispatch and compiled dense dispatch over 14 indicators and 200,000 bars, with multiple runs and GC reporting.
- `bench:tick`: legacy tick-throughput diagnostic; it is not the authoritative bar-close benchmark.

The full-series parity harness compares every overlapping ready output across three deterministic data seeds at absolute tolerance `1e-9`. Known divergences are individually marked `test.failing`; when an indicator is corrected, promote its case to a normal passing test and update its metadata/version and changelog.

## Design constraints

- One symbol per strategy runtime instance.
- One normalisation boundary: `Frame.load`.
- Indicators consume reusable `Frame` objects; no per-bar Frame history arrays.
- Candle history uses structure-of-arrays typed windows and `CandleStore.pushFrame(frame)`.
- Indicator registration is lazy and unknown types fail fast.
- Parameter values are validated against the declared schema; integer parameters reject fractional values.
- Indicator output before readiness is `NaN`; readiness is represented separately by `ready`.
- Strategy code is not sandboxed by this package. Host validation and execution isolation remain application security responsibilities.

## Further reading

- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [Public API](docs/API.md)
- [Indicator catalogue and status](docs/INDICATORS.md)
- [Known issues and handoff](docs/KNOWN_ISSUES.md)
- [Changelog](CHANGELOG.md)
- [Full indicator divergence report](test/reference/DIVERGENCE.md)
