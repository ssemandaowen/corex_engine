# CoreX Strategy Best Practices Guide

**Version:** 1.0.0  
**Last Updated:** 2026-02-25

---

## Table of Contents

1. [Introduction](#introduction)
2. [Strategy Design Principles](#strategy-design-principles)
3. [Code Quality](#code-quality)
4. [Performance Optimization](#performance-optimization)
5. [Risk Management](#risk-management)
6. [Testing & Validation](#testing--validation)
7. [Debugging & Troubleshooting](#debugging--troubleshooting)
8. [Common Pitfalls](#common-pitfalls)
9. [Production Readiness](#production-readiness)
10. [Examples](#examples)

---

## Introduction

This guide provides battle-tested best practices for developing robust, maintainable, and profitable trading strategies in CoreX. Following these practices will help you avoid common mistakes and build strategies that perform reliably across backtest, paper, and live environments.

### Who Should Read This

- Strategy developers (all levels)
- System integrators
- Risk managers
- Code reviewers

---

## Strategy Design Principles

### 1. Start Simple, Then Iterate

```javascript
// GOOD: Start with simple, testable logic
class SimpleEMACross extends BaseStrategy {
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    
    const closes = this.safeSeries(symbol, "close");
    const fast = this.indicators.EMA.calculate({ period: 12, values: closes });
    const slow = this.indicators.EMA.calculate({ period: 26, values: closes });
    
    return this.rule(data)
      .whenPos("flat", symbol).whenCrossUp(fast, slow).enterLong({ symbol, quantity: 1 })
      .whenPos("long", symbol).whenCrossDown(fast, slow).exitLong({ symbol })
      .value();
  }
}

// BAD: Overly complex from the start
class ComplexStrategy extends BaseStrategy {
  next(data) {
    // 500 lines of complex logic with 10 indicators
    // and multiple nested conditions...
  }
}
```

**Why:** Simple strategies are easier to understand, test, debug, and optimize. Add complexity only when proven necessary.

### 2. Single Responsibility

Each method should do one thing well:

```javascript
// GOOD: Clear separation of concerns
class WellStructuredStrategy extends BaseStrategy {
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this._validateData(symbol, data)) return null;
    
    const indicators = this._calculateIndicators(symbol);
    if (!indicators) return null;
    
    return this._generateSignal(symbol, indicators, data);
  }
  
  _validateData(symbol, data) {
    return this.isWarmedUp(symbol) && 
           this.requireBars(symbol, this.lookback, "validation");
  }
  
  _calculateIndicators(symbol) {
    // Calculate and return indicators
  }
  
  _generateSignal(symbol, indicators, data) {
    // Generate signal based on indicators
  }
}

// BAD: Everything in one method
class PoorlyStructuredStrategy extends BaseStrategy {
  next(data) {
    // Validation, calculation, and signal generation all mixed together
  }
}
```

### 3. Fail Fast

Validate inputs and state early:

```javascript
// GOOD: Early validation and returns
next(data) {
  // 1. Validate data structure
  if (!data || typeof data !== 'object') return null;
  
  // 2. Validate symbol
  const symbol = this.resolveSymbol({ packet: data });
  if (!symbol) return null;
  
  // 3. Check warmup
  if (!this.isWarmedUp(symbol)) return null;
  
  // 4. Check bar requirements
  if (!this.requireBars(symbol, 100, "guard")) return null;
  
  // 5. Proceed with logic
  return this.safeRule(() => {
    // Strategy logic
  }, null);
}

// BAD: Late validation
next(data) {
  const closes = this.series(data.symbol, "close"); // May throw
  const ema = this.indicators.EMA.calculate({ period: 20, values: closes }); // May fail
  if (!this.isWarmedUp(data.symbol)) return null; // Too late!
}
```

### 4. Defensive Programming

Always guard against edge cases:

```javascript
// GOOD: Defensive checks
_calculateIndicators(closes) {
  // Check input
  if (!Array.isArray(closes) || closes.length < this.params.period) {
    return null;
  }
  
  // Calculate
  const ema = this.indicators.EMA.calculate({
    period: this.params.period,
    values: closes
  });
  
  // Validate output
  if (!Array.isArray(ema) || ema.length === 0) {
    this.log.warn(`[${this.id}] Invalid EMA output`);
    return null;
  }
  
  // Check for NaN
  if (ema.some(v => !Number.isFinite(v))) {
    this.log.warn(`[${this.id}] EMA contains invalid values`);
    return null;
  }
  
  return ema;
}

// BAD: Assumes everything works
_calculateIndicators(closes) {
  return this.indicators.EMA.calculate({ period: this.params.period, values: closes });
}
```

---

## Code Quality

### 1. Use Helper Methods

```javascript
// GOOD: Use provided helpers
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.requireBars(symbol, 100, "warmup")) return null;
  
  const closes = this.safeSeries(symbol, "close");
  
  return this.safeRule(() => {
    // Logic
  }, null);
}

// BAD: Reinvent the wheel
next(data) {
  const symbol = data.symbol || this.symbols[0];
  const bars = this.dataManager.getLookbackWindow(symbol);
  if (bars.length < 100) return null;
  
  let closes;
  try {
    closes = this.series(symbol, "close");
  } catch (e) {
    closes = [];
  }
  
  try {
    // Logic
  } catch (e) {
    return null;
  }
}
```

### 2. Meaningful Names

```javascript
// GOOD: Clear, descriptive names
const fastEMAPeriod = 12;
const slowEMAPeriod = 26;
const rsiOverboughtLevel = 70;
const stopLossMultiplier = 2.0;

function calculatePositionSize(price, riskPct) {
  // ...
}

// BAD: Cryptic names
const fp = 12;
const sp = 26;
const rsi_ob = 70;
const slm = 2.0;

function calc(p, r) {
  // ...
}
```

### 3. Consistent Formatting

```javascript
// GOOD: Consistent style
class MyStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "my_strategy",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 100
    });
    
    this.schema = {
      period: { type: "integer", min: 2, max: 200, default: 20 }
    };
    this._applyDefaults();
  }
  
  next(data) {
    // Implementation
  }
}

// BAD: Inconsistent style
class MyStrategy extends BaseStrategy{
constructor(){
super({name:"my_strategy",symbols:["BTC/USD"],timeframe:"15m",lookback:100});
this.schema={period:{type:"integer",min:2,max:200,default:20}};
this._applyDefaults();}
next(data){/* Implementation */}}
```

### 4. Documentation

```javascript
// GOOD: Well-documented
/**
 * Calculate exponential moving average crossover
 * 
 * Generates long entry when fast EMA crosses above slow EMA
 * and exits when fast EMA crosses below slow EMA.
 * 
 * @param {Object} data - Market data packet
 * @param {string} data.symbol - Trading symbol
 * @param {number} data.close - Close price
 * @param {number} data.time - Bar timestamp
 * @returns {Object|null} Signal or null
 */
next(data) {
  // Implementation
}

// BAD: No documentation
next(data) {
  // Implementation
}
```

---

## Performance Optimization

### 1. Cache Expensive Calculations

```javascript
// GOOD: Cache indicators per bar
next(data) {
  const barTime = data.time;
  
  // Check cache
  if (this._indicatorCache && this._indicatorCache.time === barTime) {
    return this._generateSignal(this._indicatorCache.values);
  }
  
  // Calculate
  const indicators = this._calculateIndicators();
  
  // Update cache
  this._indicatorCache = { time: barTime, values: indicators };
  
  return this._generateSignal(indicators);
}

// BAD: Recalculate every time
next(data) {
  const indicators = this._calculateIndicators(); // Expensive!
  return this._generateSignal(indicators);
}
```

### 2. Minimize Series Access

```javascript
// GOOD: Access series once
next(data) {
  const closes = this.safeSeries(symbol, "close");
  const highs = this.safeSeries(symbol, "high");
  const lows = this.safeSeries(symbol, "low");
  
  // Use cached series
  const ema = this.indicators.EMA.calculate({ period: 20, values: closes });
  const atr = this.indicators.ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
}

// BAD: Multiple series accesses
next(data) {
  const ema = this.indicators.EMA.calculate({
    period: 20,
    values: this.series(symbol, "close") // Access 1
  });
  
  const atr = this.indicators.ATR.calculate({
    period: 14,
    high: this.series(symbol, "high"),   // Access 2
    low: this.series(symbol, "low"),     // Access 3
    close: this.series(symbol, "close")  // Access 4
  });
}
```

### 3. Avoid Unnecessary Calculations

```javascript
// GOOD: Calculate only when needed
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.isWarmedUp(symbol)) return null; // Early return
  
  // Only calculate if we might trade
  const position = this.positions.get(symbol);
  if (position && position.side === "long") {
    // Only calculate exit indicators
    return this._checkExitConditions(symbol, data);
  } else {
    // Only calculate entry indicators
    return this._checkEntryConditions(symbol, data);
  }
}

// BAD: Calculate everything always
next(data) {
  const allIndicators = this._calculateAllIndicators(); // Expensive!
  // Use only subset based on position
}
```

### 4. Limit Lookback Window

```javascript
// GOOD: Reasonable lookback
constructor() {
  super({
    name: "my_strategy",
    symbols: ["BTC/USD"],
    lookback: 200,              // Reasonable
    max_data_history: 500       // Limited
  });
}

// BAD: Excessive lookback
constructor() {
  super({
    name: "my_strategy",
    symbols: ["BTC/USD"],
    lookback: 10000,            // Too large!
    max_data_history: 50000     // Memory hog!
  });
}
```

---

## Risk Management

### 1. Always Use Stop Losses

```javascript
// GOOD: Integrated stop loss
_initializePosition(side, entry, atr) {
  const stopDistance = atr * this.params.stopMultiplier;
  
  this._state.position = {
    entry,
    stop: side === "long" ? entry - stopDistance : entry + stopDistance,
    target: null
  };
}

_checkStopLoss(side, currentPrice) {
  if (!this._state.position.stop) return false;
  
  if (side === "long") {
    return currentPrice <= this._state.position.stop;
  } else {
    return currentPrice >= this._state.position.stop;
  }
}

// BAD: No stop loss
next(data) {
  // Enter position without stop loss
  return this.entryLong({ symbol, quantity: 1 });
}
```

### 2. Position Sizing

```javascript
// GOOD: Risk-based position sizing
_calculateQuantity(symbol, price, atr) {
  const stopDistance = atr * this.params.stopMultiplier;
  
  return this.sizePosition({
    symbol,
    price,
    riskPct: this.params.riskPct,
    stopDistance,
    fallbackQty: 1
  });
}

// BAD: Fixed position size
_calculateQuantity() {
  return 1; // Always same size regardless of risk
}
```

### 3. Maximum Drawdown Limits

```javascript
// GOOD: Track and limit drawdown
_updateRiskState(pnl) {
  if (pnl < 0) {
    this._state.risk.dailyLoss += Math.abs(pnl);
    
    // Stop trading if daily loss limit exceeded
    if (this._state.risk.dailyLoss > this.params.maxDailyLoss) {
      this.log.warn(`[${this.id}] Daily loss limit exceeded`);
      return false;
    }
  }
  return true;
}

next(data) {
  // Check risk limits before trading
  if (!this._updateRiskState(0)) return null;
  
  // Continue with logic
}

// BAD: No drawdown tracking
next(data) {
  // Trade without risk limits
}
```

### 4. Diversification

```javascript
// GOOD: Multi-symbol support
constructor() {
  super({
    name: "diversified_strategy",
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], // Multiple symbols
    timeframe: "15m",
    lookback: 100
  });
}

// BAD: Single symbol only
constructor() {
  super({
    name: "single_symbol_strategy",
    symbols: ["BTC/USD"], // All eggs in one basket
    timeframe: "15m",
    lookback: 100
  });
}
```

---

## Testing & Validation

### 1. Backtest Before Live

```javascript
// Always backtest with:
// - Multiple time periods
// - Different market conditions (trending, ranging, volatile)
// - Various parameter combinations
// - Out-of-sample data

// Example backtest workflow:
// 1. Develop strategy
// 2. Backtest on historical data (2+ years)
// 3. Optimize parameters (avoid overfitting)
// 4. Validate on out-of-sample data
// 5. Paper trade for 1-3 months
// 6. Go live with small position sizes
// 7. Scale up gradually
```

### 2. Parameter Sensitivity Analysis

```javascript
// Test parameter robustness
const parameterSets = [
  { fastPeriod: 10, slowPeriod: 20 },
  { fastPeriod: 12, slowPeriod: 26 },
  { fastPeriod: 15, slowPeriod: 30 }
];

// Strategy should perform reasonably across all sets
// If performance varies wildly, strategy may be overfit
```

### 3. Walk-Forward Analysis

```javascript
// Test on rolling windows
// Train on period 1, test on period 2
// Train on period 2, test on period 3
// etc.

// This validates strategy adapts to changing market conditions
```

### 4. Use Validation Tool

```bash
# Validate strategy before deployment
node scripts/validate-strategy.js strategies/my_strategy.js

# Validate all strategies
node scripts/validate-strategy.js --all
```

---

## Debugging & Troubleshooting

### 1. Structured Logging

```javascript
// GOOD: Structured, informative logs
next(data) {
  this.logDecision("EVALUATING_ENTRY", {
    symbol,
    price: data.close,
    indicators: { fast: fastValue, slow: slowValue }
  });
  
  if (entryCondition) {
    this.logSignal(signal, "GENERATED", "info");
    return signal;
  }
  
  this.logGuard("entry_condition", false, { reason: "Conditions not met" });
  return null;
}

// BAD: No logging or console.log
next(data) {
  console.log("checking entry"); // Not structured
  if (entryCondition) {
    return signal;
  }
  return null;
}
```

### 2. State Inspection

```javascript
// GOOD: Expose state for debugging
getStateSnapshot() {
  return {
    id: this.id,
    name: this.name,
    params: { ...this.params },
    state: {
      position: { ...this._state.position },
      signals: { ...this._state.signals },
      risk: { ...this._state.risk }
    },
    positions: this.positions.getAll()
  };
}

// Use in debugging:
// const snapshot = strategy.getStateSnapshot();
// console.log(JSON.stringify(snapshot, null, 2));
```

### 3. Error Handling

```javascript
// GOOD: Graceful error handling
next(data) {
  return this.safeRule(() => {
    // Complex logic that might fail
    const result = this._complexCalculation(data);
    return this._generateSignal(result);
  }, null); // Fallback to null on error
}

_complexCalculation(data) {
  try {
    // Risky operation
    return someComplexMath(data);
  } catch (error) {
    this.log.error(`[${this.id}] Calculation failed: ${error.message}`);
    return null;
  }
}

// BAD: Let errors crash strategy
next(data) {
  const result = this._complexCalculation(data); // May throw
  return this._generateSignal(result);
}
```

---

## Common Pitfalls

### 1. Look-Ahead Bias

```javascript
// BAD: Using future data
next(data) {
  const closes = this.series(symbol, "close");
  const futurePrice = closes[closes.length + 1]; // WRONG!
  
  if (data.close < futurePrice) {
    return this.entryLong({ symbol, quantity: 1 });
  }
}

// GOOD: Only use past and current data
next(data) {
  const closes = this.series(symbol, "close");
  const currentPrice = closes[closes.length - 1];
  const previousPrice = closes[closes.length - 2];
  
  if (currentPrice > previousPrice) {
    return this.entryLong({ symbol, quantity: 1 });
  }
}
```

### 2. Overfitting

```javascript
// BAD: Too many parameters, too specific
this.schema = {
  param1: { type: "number", min: 12.345, max: 12.346, default: 12.3455 },
  param2: { type: "number", min: 26.789, max: 26.790, default: 26.7895 },
  // ... 20 more hyper-specific parameters
};

// GOOD: Reasonable parameter ranges
this.schema = {
  fastPeriod: { type: "integer", min: 5, max: 50, default: 12 },
  slowPeriod: { type: "integer", min: 10, max: 100, default: 26 }
};
```

### 3. Ignoring Transaction Costs

```javascript
// BAD: Ignore costs
// High-frequency strategy that trades 100 times per day
// without considering commissions and slippage

// GOOD: Account for costs
this.schema = {
  minProfitTarget: {
    type: "number",
    min: 0,
    max: 10,
    default: 0.5, // Minimum profit to cover costs
    description: "Minimum profit target as % to cover transaction costs"
  }
};

_shouldTakeProfit(pnlPct) {
  return pnlPct >= this.params.minProfitTarget;
}
```

### 4. Not Handling Warmup

```javascript
// BAD: Trade before warmup
next(data) {
  const ema = this.indicators.EMA.calculate({
    period: 200,
    values: this.series(symbol, "close") // May have < 200 bars!
  });
  
  return this.entryLong({ symbol, quantity: 1 });
}

// GOOD: Check warmup
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.isWarmedUp(symbol)) return null;
  if (!this.requireBars(symbol, 200, "ema_guard")) return null;
  
  const ema = this.indicators.EMA.calculate({
    period: 200,
    values: this.series(symbol, "close")
  });
  
  return this.entryLong({ symbol, quantity: 1 });
}
```

---

## Production Readiness

### Checklist

Before deploying to production:

- [ ] **Backtested** on 2+ years of data
- [ ] **Validated** on out-of-sample data
- [ ] **Paper traded** for 1-3 months
- [ ] **Parameter sensitivity** tested
- [ ] **Stop losses** implemented
- [ ] **Position sizing** based on risk
- [ ] **Maximum drawdown** limits set
- [ ] **Logging** comprehensive and structured
- [ ] **Error handling** robust
- [ ] **Code reviewed** by peer
- [ ] **Validated** with validation tool
- [ ] **Documentation** complete
- [ ] **Monitoring** plan in place
- [ ] **Emergency stop** procedure defined

### Monitoring

```javascript
// Implement monitoring hooks
next(data) {
  // Track performance metrics
  this._updateMetrics(data);
  
  // Check health
  if (!this._isHealthy()) {
    this.log.error(`[${this.id}] Strategy health check failed`);
    return null;
  }
  
  // Continue with logic
  return this.safeRule(() => {
    // Strategy logic
  }, null);
}

_isHealthy() {
  // Check for anomalies
  if (this._state.signals.consecutiveLosses > 10) {
    return false;
  }
  
  if (this._state.risk.dailyLoss > this.params.maxDailyLoss) {
    return false;
  }
  
  return true;
}
```

---

## Examples

### Complete Production-Ready Strategy

See [`docs/examples/ADX_FILTERED_TSL_COREX.js`](./examples/ADX_FILTERED_TSL_COREX.js) for a complete example of a production-ready strategy that follows all best practices.

### Key Features

- ✓ Comprehensive parameter schema
- ✓ Multi-indicator confirmation
- ✓ Dynamic position sizing
- ✓ Trailing stop loss
- ✓ Breakeven management
- ✓ Risk state tracking
- ✓ Structured logging
- ✓ Error handling
- ✓ State management
- ✓ Performance optimization

---

## Conclusion

Following these best practices will help you build strategies that are:

- **Robust**: Handle edge cases gracefully
- **Maintainable**: Easy to understand and modify
- **Performant**: Optimized for speed and memory
- **Profitable**: Based on sound trading principles
- **Production-Ready**: Suitable for live trading

Remember: **Start simple, test thoroughly, and iterate based on results.**

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Maintained By:** CoreX Development Team
