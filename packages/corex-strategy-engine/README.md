# corex-strategy-engine

`corex-strategy-engine` is the pure-logic algorithmic execution runtime for CoreX strategies, operating between raw market feed input and upper engine order/event broadcasting. It provides the declarative strategy base class (`Strategy`), zero-allocation context builder (`ContextBuilder`), incremental O(1) technical indicator state management (`IndicatorManager` / `IndicatorRegistry`), bounded charting storage (`PlotBuffer`), parameter schema validation (`ParamSchema`), and strategy structural verification (`StrategyValidator`).

---

## Authoring API Surface

### 1. Static Declarations
Strategy classes extend `Strategy` and declare operational metadata via static fields:
- `static symbols`: Array of ticker strings, e.g. `["EURUSD"]` (required; default fallback if config `symbols` is omitted).
- `static timeframe`: Timeframe string, e.g. `"1m"`, `"5m"`, `"1h"` (optional; defaults to `"1m"`).
- `static lookback`: Positive integer lookback window size (optional; defaults to `100`, upper bound `100000`).
- `static params`: Static object or class inheritance mapping parameter specifications to default values or schema objects (e.g. `{ period: 14, riskPct: 1.0 }`).
- `static indicators`: Static object mapping indicator keys to declarative definitions (e.g. `{ rsi: { type: "RSI", period: 14, source: "close" } }`).

### 2. Lifecycle Hooks
Strategies implement up to 5 standard lifecycle callbacks:
- `onStart(ctx)`: Invoked once when the strategy receives its first market data packet.
- `onBar(ctx, bar)`: Invoked for each completed bar packet (`source: "bar"` or closed candle). Returns a signal object or `null`.
- `onTick(ctx, tick)`: Invoked for each raw tick packet when `candleBased` is false. Returns a signal object or `null`.
- `onFill(ctx, fill)`: Invoked upon order fill execution callback.
- `onStop(ctx)`: Invoked during strategy teardown / destroy lifecycle.

### 3. The `ctx` Object Surface
The `ctx` object passed into lifecycle hooks is a persistent, zero-allocation context object created by `ContextBuilder`. Its verified properties and methods include:

#### Properties
- `ctx.symbol`: Active symbol string for the current packet.
- `ctx.price`: Current packet price (`packet.price ?? packet.close ?? 0`).
- `ctx.close`: Current packet close price (`packet.close ?? price`).
- `ctx.time`: Current packet timestamp (milliseconds).
- `ctx.isBar`: Boolean flag indicating whether the packet is a bar packet.
- `ctx.barTime`: Timestamp of the current bar.
- `ctx.engine`: Engine telemetry object `{ mode: string, barsReceived: number, connected: boolean }`.
- `ctx.position`: Position telemetry object `{ side: 'FLAT' | 'long' | 'short', entryPrice: number, size: number, unrealizedPnL: number }`.
- `ctx.params`: Strategy parameters object (updated dynamically via `updateParams`).
- `ctx.state`: Persistent key-value state store instance (`StrategyStateStore`).
- `ctx.indicators`: Object mapping active indicator names to incremental indicator instances (e.g., `ctx.indicators.rsi.value`, `ctx.indicators.rsi.ready`).

#### Libraries & Helpers
- `ctx.ta`: Fast technical analysis library:
  - `crossover(a, b)`: Returns true if A crosses above B.
  - `crossunder(a, b)`: Returns true if A crosses below B.
  - `highest(arr, length)`: Maximum value in lookback window.
  - `lowest(arr, length)`: Minimum value in lookback window.
  - `rising(arr, length)`: Checks if series is strictly rising over `length` bars.
  - `falling(arr, length)`: Checks if series is strictly falling over `length` bars.
  - `change(arr, length)`: Difference between current value and value `length` bars ago.
- `ctx.util`: Utility helper functions:
  - `round(val, decimals)`: Rounds numeric value to specified decimal places.
  - `positionSize(capital, riskPct, stopLossPips)`: Calculates risk-based position quantity.

#### Orders & Guards
- `ctx.go`: Order execution helper object:
  - `ctx.go.long(qty?, price?)`: Triggers `entryLong`.
  - `ctx.go.short(qty?, price?)`: Triggers `entryShort`.
  - `ctx.go.scale(qty?, price?)`: Triggers `entryLong` with `allowScaling: true`.
  - `ctx.go.protect({ sl?, tp?, trailPct? })`: Returns protection intent object `{ intent: "PROTECT", sl, tp, trailPct, symbol }`.
- `ctx.hasBars(count = 1, symbol = ctx.symbol)`: Returns boolean indicating if `count` warmed-up bars exist for the symbol.
- `ctx.requireBars(count = 1, indicatorName = null, symbol = ctx.symbol)`: Guard returning true only if `hasBars(count)` passes AND specified (or all) indicators report `ready: true`.
- `ctx.plot(name, value)`: Records a time-series plot data point into `PlotBuffer`.
- `ctx.mark(name, message)`: Records an event marker into `PlotBuffer`.

#### Discrepancy Note (StrategyManifest vs Actual Wiring)
`StrategyManifest.js` includes metadata descriptors for IDE completion that are **not** attached to `ctx` or `this` in actual runtime execution:
- `ctx.flat`: **Unwired**. (`_createFlatHandler` exists as a private method in `ContextBuilder.js` but is never attached to `ctx`). Strategies close exposure via `ctx.go` or `this.close()` / `this.exitAll()`.
- `oncePerBar`, `safeRule`, `describe`, `logDecision`, `logSignal`, `logGuard`: Listed in `StrategyManifest.js` as manifest helper descriptors, but are not methods on `Strategy.prototype` or `ctx`.
- `above`, `below`, `between`, `pctChange`: Listed in `StrategyManifest.js`, but not exported by `ta.js` or `ctx.ta`.

---

## Data Flow

### Inbound Data Flow
1. Market data packets (ticks or closed bars) enter via `Strategy.onTick(tick)`, `Strategy.onBar(bar)`, `Strategy.onMarketData(packet)`, or `Strategy.generateSignal(packet)`.
2. Internal pipeline `_processData(packet, meta)` invokes `ContextBuilder.updateForPacket(packet, isBar)`.
3. `StrategyDataManager` / `SoACandleStore` ingests the packet and updates price history lookback windows.
4. `IndicatorManager` updates all registered incremental indicators in O(1) time.
5. `ContextBuilder` updates `ctx` attributes (`price`, `close`, `time`, `position`, `engine`) and passes `ctx` to the appropriate user hook (`onBar` / `onTick`).

### Outbound Data Flow
- **Signals & Orders**: Returned directly from `onBar` / `onTick` or emitted via `this.entryLong()`, `this.entryShort()`, `this.exitAll()`, `this.flipToLong()`, `this.flipToShort()`, or `ctx.go.*`.
- **Plot & Mark Deltas**: Recorded via `ctx.plot()` and `ctx.mark()` into `PlotBuffer`. Extracted on demand or via periodic drain using `Strategy.getPlotDelta()`.

---

## Requirements & Coupling

### Dependencies
- **Runtime**: Node.js >= 18.
- **Path Aliases**: Requires `@root`, `@core`, `@utils`, `@config`, `@events`, `corex-broker-contract`.

### Explicit Non-Coupling
- **No Network Calls**: `corex-strategy-engine` contains zero network or HTTP code.
- **No Database Coupling**: Data persistence is handled via injected utilities (`StrategyStateStore`).
- **No Broadcaster Coupling**: WebSocket broadcasting and channel routing are strictly handled by the engine layer (`RuntimeRegistry.js`, `broadcaster.js`).

---

## Known Limitations

1. **No Runtime Sandboxing**: Strategy code runs directly in the Node.js V8 process without VM2 or worker thread isolation beyond the AST security scanner in `utils/security.js`.
2. **No Hard Indicator/Lookback Caps**: Beyond `StrategyValidator` advisory warnings and the `MAX_ALLOWED_LOOKBACK = 100000` error bound, no memory or execution time caps are enforced inside this package itself.
