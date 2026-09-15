# CoreX — Comprehensive Strategy Engine Package Analysis (`corex-strategy-engine`)

> **Status:** Architecture & Operations Reference  
> **Document:** `plans/Audit/corex-strategy-engine-analysis.md`  
> **Target Package:** `packages/corex-strategy-engine`  
> **Audience:** AI coding agents, automated development systems, and core engineers working in the CoreX repository.

---

## 1. Executive Summary & Purpose

The `corex-strategy-engine` package is the self-contained core trading logic engine of CoreX. It encapsulates declarative strategy authoring, zero-allocation context building (`ContextBuilder`), incremental technical indicators (`IndicatorRegistry`, `IndicatorManager`, 41 indicator classes), parameter schema validation and serialization (`ParamSchema`), position lot tracking (`Position`), and TradingView-style technical analysis helpers (`ta.js`, `util.js`).

Following CoreX's modularization roadmap (Strangler Fig pattern), this package extracts all trading strategy logic out of the monolithic root `utils/` and `engine/` layers into a robust, independently testable npm package located at `packages/corex-strategy-engine`.

---

## 2. Package Architecture & Internal Structure

```
packages/corex-strategy-engine/
├── package.json
├── index.js                     # Public API entry point
├── src/
│   ├── Strategy.js              # Declarative Strategy base class
│   ├── ContextBuilder.js        # Zero-allocation per-tick execution context builder
│   ├── IndicatorManager.js      # Static indicator collection & dynamic re-seed manager
│   ├── IndicatorRegistry.js     # Global indicator registry & indicator class mappings
│   ├── ParamSchema.js           # Static parameter schema collection, coercion & UI serialization
│   ├── Position.js              # O(1) incremental aggregate position & lot manager
│   ├── SoACandleStore.js        # Structure of Arrays (SoA) candle storage
│   ├── StrategyDataManager.js   # Circular buffer lookback window & candle/tick ingestion
│   ├── StrategyStateStore.js    # Key-value persistent state store with 5s debounced flush
│   ├── StrategyIntrospection.js # Prototype reflection for public strategy method discovery
│   ├── StrategyPositionManager.js # Session position manager and order state tracker
│   ├── StrategyRuntimeUtils.js  # Order quantity normalization, sizing, and price resolution
│   ├── ta.js                    # Technical analysis math (crossover, crossunder, highest, lowest, rising, falling)
│   ├── util.js                  # Quantitative utilities (round, positionSize)
│   └── validation/
│       ├── StrategyManifest.js  # Monaco editor completion manifest (12 ctx.* entries)
│       └── StrategyValidator.js # Pre-flight strategy validation & anti-pattern scanner
└── test/
    ├── ContextBuilder.test.js   # Zero-allocation benchmark & context validation
    ├── Indicators.test.js       # Calculation correctness unit tests across all 41 indicators
    ├── ParamSchema.test.js      # Parameter validation and schema serialization tests
    ├── PluggableRegistry.test.js # Pluggable indicator registry & zero core-file edit tests
    ├── Position.test.js         # O(1) incremental lot aggregation correctness tests
    ├── Strategy.test.js         # End-to-end lifecycle and order placement tests
    ├── ta.test.js               # TA helper unit tests
    └── util.test.js             # Utility function tests
```

---

## 3. Core Operational Components

### 3.1 Declarative Strategy Base Class (`src/Strategy.js`)
- **Authoring Model:** Strategies extend `Strategy` and declare static metadata:
  ```javascript
  class MyStrategy extends Strategy {
      static symbols = ["EURUSD"];
      static timeframe = "1m";
      static params = {
          threshold: { default: 1.1000, type: "number" },
          rsiPeriod: { default: 14, type: "integer" }
      };
      static indicators = {
          ema: { type: "EMA", period: 5, source: "close" },
          rsi: { type: "RSI", periodKey: "rsiPeriod", source: "close" }
      };
      onStart(ctx) { ... }
      onBar(ctx, bar) { ... }
      onTick(ctx, tick) { ... }
      onFill(ctx, fill) { ... }
      onStop(ctx) { ... }
  }
  ```
- **Lifecycle Hooks:** Supports `onStart`, `onBar`, `onTick`, `onFill`, and `onStop`. Hooks receive a pre-bound execution context (`ctx`) providing clean access to state, indicators, parameters, and order submission helpers.

### 3.2 Zero-Allocation Context Builder (`src/ContextBuilder.js`)
- **Hot-Path Optimization:** Avoids ephemeral object and closure allocations on every incoming tick/bar.
- **Persistent Structure:** Allocates the `ctx` object graph once during initialization (`_buildPersistentCtx()`). On each incoming packet (`updateForPacket()`), scalar properties (`ctx.price`, `ctx.close`, `ctx.time`, `ctx.isBar`, `ctx.barTime`, `ctx.symbol`) and position telemetry (`ctx.position.*`) are updated **in-place**.
- **Benchmark:** Processes 50,000 ticks in ~40–60 ms (~0.8 µs per tick) with negative or zero heap growth (zero garbage collection pressure).

### 3.3 Indicator Registry & Suite (`src/IndicatorRegistry.js`, `src/indicators/`)
- **Registry Pattern:** `globalIndicatorRegistry` stores constructor classes mapped by uppercase type names (e.g. `"EMA"`, `"RSI"`, `"ATR"`, `"SUPERTREND"`, etc.).
- **41 Technical Indicators Included:**
  - *Trend & Overlays:* SMA, EMA, WMA, HMA, McGinley Dynamic, ALMA, KAMA, VIDYA, Parabolic SAR, SuperTrend, Linear Regression Curve & Slope, Standard Deviation Channels, Ehlers Instantaneous Trendline, SuperSmoother Filter, Ichimoku Cloud.
  - *Momentum Oscillators:* RSI, MACD, Stochastic Oscillator, CCI, ROC, Momentum, Williams %R, Ultimate Oscillator, TSI, CMO, STC, Ehlers Fisher Transform, Laguerre RSI, RVI, Connors RSI.
  - *Volatility & Channels:* ATR, Bollinger Bands, Keltner Channels, Donchian Channels.
  - *Volume & Liquidity:* VWAP, Anchored VWAP, OBV, MFI, CMF, Accumulation/Distribution, Ease of Movement.
  - *Trend Strength, Regime & Fractal:* ADX, Vortex Indicator, Choppiness Index, Hurst Exponent, Fractal Dimension Index (FDI).
  - *Statistical & Quantitative:* Z-Score, DPO, Coppock Curve, Fibonacci Retracements & Extensions.
- **Incremental & Lookback Update:** Each indicator implements `.update(...)`, `.reseed(...)`, `.ready`, `.value`, and `.prev`, operating incrementally without recalculating historical data from scratch on every tick.

### 3.4 Position Lot Management (`src/Position.js`)
- **O(1) Incremental Aggregation:** Position lot additions maintain running aggregates (`this.quantity`, `this.avgEntryPrice`) in $O(1)$ time rather than recomputing the full lot array in $O(n^2)$ time.
- **FIFO Lot Reduction:** `reduceDetailed()` matches incoming exits against oldest lots first (FIFO), computing exact realized PnL per lot.

---

## 4. Integration into the CoreX System

### 4.1 Compilation & Loading Pipeline
1. **Source Storage:** Strategy source code resides in the PostgreSQL `strategies` table (`script_body`).
2. **Security & Compilation:** `strategyLoader.js` passes code through `utils/security.js` (Acorn AST blocklist scanner) before compiling via `strategyCompiler.js` (`Module._compile`).
3. **Contract Adaptation:** `StrategyContract.adapt(strategyInstance)` verifies contract compliance and maps legacy methods (`next`, `onBar`) to the canonical lifecycle.
4. **Instantiation & Scoping:** `RuntimeLifecycle` boots the strategy instance within a runtime identified by `userId::strategyName::symbol::mode`.

### 4.2 Signal & Order Execution Pipeline
- **Generation (`SignalGenerationEngine`):** Feeds market data packets into the strategy instance (`onBar`, `onTick`, or `generateSignal`).
- **Processing (`SignalProcessingEngine`):** Validates generated trading intents against portfolio risk rules (drawdown ceiling, scaling limits, position conflicts).
- **Execution (`SignalExecutionEngine`):** Submits validated orders to the broker runtime (`broker.handle()`).
- **Universal Risk Gate (`BaseBroker.handle()`):** All order sources (both strategy-generated signals and Socket_X client commands) pass through the universal risk validator gate (`SignalProcessingEngine.validateForCommand()`) as a mandatory fail-closed checkpoint before reaching broker drivers (`BacktestDriver`, `CoreXPaperDriver`, `MetaApiDriver`).

---

## 5. Development & Testing Procedures

### Running Package Tests
```bash
cd packages/corex-strategy-engine
npm test
```
*(Runs Jest tests covering ContextBuilder benchmarks, Position O(1) correctness, parameter validation, technical analysis math, and all 41 indicators).*

### Running Root Test Suite
```bash
npm test
```

---

## 6. Protected Architecture & Invariants

1. **Server Authority:** The client never executes trading logic or determines authoritative state; the server runtime is strictly authoritative.
2. **Runtime Identity:** Scoping uses the canonical identifier `userId::strategyName::symbol::mode`.
3. **Zero-Allocation Hot Path:** Tick-level context updates must remain zero-allocation (`ContextBuilder` pattern).
4. **Fail-Closed Risk Enforcement:** `BaseBroker.handle()` must fail closed if the risk validator is unconfigured.

*Document generated successfully and stored at `plans/Audit/corex-strategy-engine-analysis.md`.*