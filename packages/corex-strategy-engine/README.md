# `corex-strategy-engine`

> **Package Name:** `corex-strategy-engine`
> **Namespace / Scope:** Strategy Execution, Indicators, Context Generation, Risk & Position Management
> **Repository:** Proprietary algorithmic trading engine (`CoreX`)

---

## 1. Overview

`corex-strategy-engine` is the isolated, high-performance strategy execution runtime for CoreX. It provides:

- **Zero-Allocation Execution Context:** In-place mutated `ctx` object (`ContextBuilder`) providing `ctx.price`, `ctx.indicators`, `ctx.ta`, `ctx.util`, `ctx.go.*`, and `ctx.flat`.
- **50 Incremental Technical Indicators:** Real-time $O(1)$ and $O(period)$ streaming indicator calculations (`IndicatorRegistry` and `IndicatorManager`).
- **Standardized Strategy Lifecycle:** Base class (`Strategy`) supporting both declarative reactive hooks (`onStart`, `onBar`, `onTick`, `onFill`, `onStop`) and functional `generateSignal(tick)`.
- **Position & Order Sizing:** Integrated `StrategyPositionManager` and `Position` aggregate models.
- **AST Security Scanner & Validation:** Static Acorn AST scanner (`utils/security.js`), `StrategyValidator`, and `ParamSchema` for dynamic runtime parameters.

---

## 2. Architecture & Components

```
packages/corex-strategy-engine/
├── index.js                     # Package public API exports
├── package.json                 # Package configuration & module aliases
├── README.md                    # Package documentation
├── src/
│   ├── Strategy.js              # Abstract Strategy base class
│   ├── ContextBuilder.js        # Zero-allocation per-tick context generator
│   ├── IndicatorManager.js      # Indicator attachment & lifecycle manager
│   ├── IndicatorRegistry.js     # Registry mapping 50 technical indicator classes
│   ├── ParamSchema.js           # Parameter schema extraction, patch validation
│   ├── Position.js              # O(1) position aggregate & PnL calculator
│   ├── SoACandleStore.js        # Structure-of-Arrays preallocated candle store
│   ├── StrategyDataManager.js   # OHLCV candle buffers
│   ├── StrategyIntrospection.js # Reflection helper for strategy class capabilities
│   ├── StrategyPositionManager.js# Multi-symbol position tracking
│   ├── StrategyRuntimeUtils.js  # Quantitative position sizing & protection helpers
│   ├── StrategyStateStore.js    # Debounced async key-value store for strategy state
│   ├── ta.js                    # Crossover, crossunder, highest, lowest helpers
│   ├── util.js                  # Lot sizing & decimal rounding utilities
│   ├── indicators/              # 50 streaming incremental indicator implementations
│   └── validation/              # StrategyValidator & StrategyManifest (Monaco IDE)
└── test/                        # 7 comprehensive Jest unit test suites
```

---

## 3. Usage Example

### Declarative Strategy
```javascript
const { Strategy } = require("corex-strategy-engine");

class MomentumStrategy extends Strategy {
    onStart(ctx) {
        ctx.indicators.sma50 = ctx.indicators.sma(50);
        ctx.indicators.rsi14 = ctx.indicators.rsi(14);
    }

    onTick(ctx, tick) {
        const sma = ctx.indicators.sma50;
        const rsi = ctx.indicators.rsi14;

        if (rsi > 70 && tick.price < sma) {
            return ctx.go.short(1);
        } else if (rsi < 30 && tick.price > sma) {
            return ctx.go.long(1);
        }
        return null;
    }
}

module.exports = MomentumStrategy;
```

---

## 4. Performance Benchmarks

Micro-benchmark results (50,000 continuous tick execution):
- **Context Generation (`ContextBuilder`):** 0.207 µs / tick
- **End-to-End Non-Signal Tick:** 0.772 µs / tick (~1.29 million ticks/second)
- **Signal-to-Execution Settlement:** ~5.64 µs total

---

## 5. Testing

Run all 7 test suites inside `corex-strategy-engine`:

```bash
npx jest packages/corex-strategy-engine/test/ --runInBand --forceExit
```

All 50 technical indicators and strategy engine components are covered by 66 unit tests.
