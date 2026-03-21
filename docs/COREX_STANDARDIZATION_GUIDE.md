# CoreX Strategy Standardization Guide

**Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Status:** Official Standard

---

## Table of Contents

1. [Introduction](#introduction)
2. [Philosophy & Principles](#philosophy--principles)
3. [Coding Conventions](#coding-conventions)
4. [Architectural Patterns](#architectural-patterns)
5. [Error Handling & Validation](#error-handling--validation)
6. [API Design Standards](#api-design-standards)
7. [Template System](#template-system)
8. [Documentation Standards](#documentation-standards)
9. [State Management](#state-management)
10. [Performance Optimization](#performance-optimization)
11. [Version Control & Code Review](#version-control--code-review)
12. [Migration Guide](#migration-guide)
13. [Validation Tools](#validation-tools)
14. [Quick Reference](#quick-reference)

---

## Introduction

This guide establishes the official syntax, architectural patterns, and best practices for CoreX strategy development. It ensures consistency, maintainability, and scalability across the entire codebase while supporting both beginner-friendly simple strategies and advanced multi-component systems.

### Goals

- **Consistency**: Uniform code structure across all strategies
- **Maintainability**: Easy to understand, modify, and extend
- **Scalability**: Support growth from simple to complex strategies
- **Accessibility**: Clear patterns for all skill levels
- **Reliability**: Robust error handling and validation
- **Performance**: Optimized execution patterns

### Scope

This guide applies to:
- Strategy class implementations
- Helper utilities and mixins
- Data management components
- Signal generation logic
- Risk management modules
- Integration patterns

---

## Philosophy & Principles

### Core Principles

1. **Explicit Over Implicit**: Code should be self-documenting and clear
2. **Fail Fast**: Validate early, catch errors at the boundary
3. **Single Responsibility**: Each component has one clear purpose
4. **Composition Over Inheritance**: Build complex behavior from simple parts
5. **Immutability Where Possible**: Reduce side effects
6. **Defensive Programming**: Guard against invalid states
7. **Performance Awareness**: Optimize hot paths, profile before optimizing

### Design Philosophy

```javascript
// GOOD: Clear, explicit, guarded
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.isWarmedUp(symbol)) return null;
  if (!this.requireBars(symbol, 100, "warmup_guard")) return null;
  
  return this.safeRule(() => {
    // Strategy logic here
    return this.entryLong({ symbol, quantity: 1 });
  }, null);
}

// BAD: Implicit, unguarded, unclear
next(data) {
  const closes = this.series(data.symbol, "close");
  const fast = this.indicators.EMA.calculate({ period: 12, values: closes });
  return { intent: "ENTER", side: "long", symbol: data.symbol };
}
```

---

## Coding Conventions

### File Structure

```
strategies/
├── my_strategy.js           # Strategy implementation
├── my_strategy.test.js      # Unit tests
└── my_strategy.md           # Strategy documentation

utils/strategy/
├── MyStrategyHelper.js      # Reusable helper
└── MyStrategyHelper.test.js # Helper tests
```

### Naming Conventions

#### Classes
```javascript
// PascalCase for class names
class EmaCrossover extends BaseStrategy { }
class ADXFilteredTSL extends BaseStrategy { }
class MeanReversionStrategy extends BaseStrategy { }
```

#### Variables & Functions
```javascript
// camelCase for variables and functions
const fastPeriod = 12;
const slowPeriod = 26;
function calculateSignal(data) { }
function resolveSymbol(options) { }
```

#### Constants
```javascript
// UPPER_SNAKE_CASE for constants
const MAX_LOOKBACK = 500;
const DEFAULT_RISK_PCT = 1.0;
const SIGNAL_THRESHOLD = 0.75;
```

#### Private Members
```javascript
// Prefix with underscore for private/internal
class MyStrategy extends BaseStrategy {
  constructor() {
    super();
    this._internalState = {};
    this._riskManager = null;
  }
  
  _calculateInternalMetric() { }
  _resetState() { }
}
```

### Indentation & Formatting

```javascript
// 2 spaces for indentation (no tabs)
// Opening brace on same line
// Space after keywords

if (condition) {
  doSomething();
} else {
  doSomethingElse();
}

// Function declarations
function myFunction(param1, param2) {
  return param1 + param2;
}

// Object literals - align for readability
const config = {
  name: "my_strategy",
  symbols: ["BTC/USD"],
  timeframe: "15m",
  lookback: 200
};

// Array literals
const indicators = [
  "SMA",
  "EMA",
  "RSI",
  "MACD"
];
```

### Comment Structure

```javascript
/**
 * Multi-line JSDoc comment for classes and public methods
 * @param {Object} config - Configuration object
 * @param {string} config.symbol - Trading symbol
 * @param {number} config.period - Indicator period
 * @returns {number[]} Array of indicator values
 */
function calculateIndicator(config) {
  // Single-line comment for implementation details
  const values = config.values || [];
  
  /* 
   * Multi-line comment for complex logic explanation
   * that requires more context
   */
  return values.map(v => v * 2);
}
```

### Import Statements

```javascript
// Standard library first
"use strict";

// External dependencies
const math = require('mathjs');
const indicators = require('technicalindicators');

// Internal core modules
const BaseStrategy = require("@utils/BaseStrategy");
const { INTENTS, SIDES } = require("@config/constants");

// Internal utilities
const { RiskManager } = require("@utils/riskManager");
const { PositionSizer } = require("@utils/strategy/PositionSizer");

// Blank line before class definition
class MyStrategy extends BaseStrategy {
  // ...
}
```

### Function Organization

```javascript
class MyStrategy extends BaseStrategy {
  // 1. Constructor
  constructor() { }
  
  // 2. Lifecycle methods
  next(data) { }
  onTick(tick) { }
  onBar(bar) { }
  
  // 3. Public methods (alphabetical)
  calculateSignal(data) { }
  validateInput(data) { }
  
  // 4. Private methods (alphabetical)
  _calculateIndicators(data) { }
  _resetState() { }
  _updateRiskMetrics() { }
}
```

---

## Architectural Patterns

### Strategy Class Structure

```javascript
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

/**
 * Strategy Name - Brief description
 * 
 * Strategy Type: [Trend Following | Mean Reversion | Breakout | etc.]
 * Timeframe: Recommended timeframe(s)
 * Complexity: [Simple | Intermediate | Advanced]
 * 
 * @extends BaseStrategy
 */
class MyStrategy extends BaseStrategy {
  constructor() {
    // 1. Call super with configuration
    super({
      name: "my_strategy",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 200
    });
    
    // 2. Define parameter schema
    this.schema = {
      fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
      slowPeriod: { type: "integer", min: 5, max: 400, default: 26 },
      riskPct: { type: "number", min: 0.1, max: 10, default: 1.0 }
    };
    this._applyDefaults();
    
    // 3. Initialize internal state
    this._state = {
      lastSignalTime: null,
      consecutiveLosses: 0
    };
    
    // 4. Initialize helper modules
    this._riskManager = null; // Initialize if needed
  }
  
  /**
   * Main strategy logic entry point
   * @param {Object} data - Market data packet
   * @returns {Object|null} Signal object or null
   */
  next(data) {
    // 1. Resolve symbol and validate warmup
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.lookback, "warmup_guard")) return null;
    
    // 2. Ensure once-per-bar execution
    const barTime = Number(data.time || this.currentBar?.time || 0);
    if (!this.oncePerBar(`${symbol}_bar`, barTime)) return null;
    
    // 3. Wrap logic in safeRule for error containment
    return this.safeRule(() => {
      // 4. Get data series
      const closes = this.safeSeries(symbol, "close");
      if (closes.length < this.lookback) return null;
      
      // 5. Calculate indicators
      const indicators = this._calculateIndicators(closes);
      if (!indicators) return null;
      
      // 6. Generate signal using rule chain
      return this._generateSignal(symbol, indicators, data);
    }, null);
  }
  
  /**
   * Calculate all required indicators
   * @private
   */
  _calculateIndicators(closes) {
    const fast = this.indicators.EMA.calculate({
      period: this.params.fastPeriod,
      values: closes
    });
    
    const slow = this.indicators.EMA.calculate({
      period: this.params.slowPeriod,
      values: closes
    });
    
    // Validate indicator output
    if (fast.length < 2 || slow.length < 2) return null;
    
    return { fast, slow };
  }
  
  /**
   * Generate trading signal based on indicators
   * @private
   */
  _generateSignal(symbol, indicators, data) {
    const { fast, slow } = indicators;
    const qty = this._calculateQuantity(symbol, data.close);
    
    return this.rule(data)
      .whenPos("flat", symbol)
      .whenCrossUp(fast, slow, "ema_cross")
      .enterLong({ symbol, quantity: qty })
      
      .whenPos("long", symbol)
      .whenCrossDown(fast, slow, "ema_cross")
      .exitLong({ symbol })
      
      .value();
  }
  
  /**
   * Calculate position size
   * @private
   */
  _calculateQuantity(symbol, price) {
    return this.sizePosition({
      symbol,
      price,
      riskPct: this.params.riskPct,
      fallbackQty: 1
    });
  }
}

module.exports = MyStrategy;
```

### Modular Component Pattern

```javascript
// Separate complex logic into reusable modules

// utils/strategy/TrendFilter.js
class TrendFilter {
  constructor(config = {}) {
    this.longTermPeriod = config.longTermPeriod || 200;
    this.threshold = config.threshold || 0;
  }
  
  isUptrend(closes) {
    const ema = this.indicators.EMA.calculate({
      period: this.longTermPeriod,
      values: closes
    });
    const current = closes[closes.length - 1];
    const emaValue = ema[ema.length - 1];
    return current > emaValue + this.threshold;
  }
  
  isDowntrend(closes) {
    return !this.isUptrend(closes);
  }
}

// Use in strategy
class MyStrategy extends BaseStrategy {
  constructor() {
    super({ /* config */ });
    this._trendFilter = new TrendFilter({
      longTermPeriod: 200,
      threshold: 0
    });
  }
  
  next(data) {
    const closes = this.safeSeries(symbol, "close");
    const isUptrend = this._trendFilter.isUptrend(closes);
    // Use trend filter in logic
  }
}
```

### State Management Pattern

```javascript
class StatefulStrategy extends BaseStrategy {
  constructor() {
    super({ /* config */ });
    
    // Centralized state object
    this._state = {
      // Position tracking
      position: {
        entry: null,
        stop: null,
        target: null,
        breakeven: false
      },
      
      // Signal tracking
      signals: {
        lastEntry: null,
        lastExit: null,
        consecutiveWins: 0,
        consecutiveLosses: 0
      },
      
      // Risk tracking
      risk: {
        dailyLoss: 0,
        maxDrawdown: 0,
        riskMultiplier: 1.0
      }
    };
  }
  
  _resetPositionState() {
    this._state.position = {
      entry: null,
      stop: null,
      target: null,
      breakeven: false
    };
  }
  
  _updateRiskState(pnl) {
    if (pnl < 0) {
      this._state.signals.consecutiveLosses++;
      this._state.signals.consecutiveWins = 0;
      this._state.risk.dailyLoss += Math.abs(pnl);
    } else {
      this._state.signals.consecutiveWins++;
      this._state.signals.consecutiveLosses = 0;
    }
  }
}
```

---

## Error Handling & Validation

### Input Validation Pattern

```javascript
class MyStrategy extends BaseStrategy {
  next(data) {
    // 1. Validate input structure
    if (!data || typeof data !== 'object') {
      this.log.warn(`[${this.id}] Invalid data packet received`);
      return null;
    }
    
    // 2. Validate required fields
    if (!data.symbol || typeof data.time !== 'number') {
      this.log.warn(`[${this.id}] Missing required fields in data packet`);
      return null;
    }
    
    // 3. Validate data ranges
    if (data.close <= 0 || !Number.isFinite(data.close)) {
      this.log.warn(`[${this.id}] Invalid price data: ${data.close}`);
      return null;
    }
    
    // 4. Proceed with logic
    return this.safeRule(() => {
      // Strategy logic
    }, null);
  }
}
```

### Error Containment Pattern

```javascript
// Use safeRule for error containment
next(data) {
  return this.safeRule(() => {
    // Complex logic that might throw
    const result = this._complexCalculation(data);
    return this._generateSignal(result);
  }, null); // Fallback value on error
}

// Validate indicator outputs
_calculateIndicators(closes) {
  try {
    const ema = this.indicators.EMA.calculate({
      period: this.params.period,
      values: closes
    });
    
    // Validate output
    if (!Array.isArray(ema) || ema.length === 0) {
      this.log.warn(`[${this.id}] Invalid EMA output`);
      return null;
    }
    
    // Check for NaN values
    if (ema.some(v => !Number.isFinite(v))) {
      this.log.warn(`[${this.id}] EMA contains invalid values`);
      return null;
    }
    
    return ema;
  } catch (error) {
    this.log.error(`[${this.id}] Indicator calculation failed: ${error.message}`);
    return null;
  }
}
```

### Type Checking Pattern

```javascript
// Parameter validation
updateParams(newParams) {
  if (!newParams || typeof newParams !== 'object') {
    this.log.warn(`[${this.id}] Invalid params object`);
    return;
  }
  
  // Validate each parameter
  Object.keys(newParams).forEach(key => {
    const schema = this.schema[key];
    if (!schema) {
      this.log.warn(`[${this.id}] Unknown parameter: ${key}`);
      return;
    }
    
    const value = newParams[key];
    
    // Type checking
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      this.log.warn(`[${this.id}] Parameter ${key} must be integer`);
      return;
    }
    
    if (schema.type === 'number' && !Number.isFinite(value)) {
      this.log.warn(`[${this.id}] Parameter ${key} must be finite number`);
      return;
    }
    
    // Range checking
    if (schema.min !== undefined && value < schema.min) {
      this.log.warn(`[${this.id}] Parameter ${key} below minimum: ${schema.min}`);
      return;
    }
    
    if (schema.max !== undefined && value > schema.max) {
      this.log.warn(`[${this.id}] Parameter ${key} above maximum: ${schema.max}`);
      return;
    }
    
    // Apply valid parameter
    this.params[key] = value;
  });
}
```

---

## API Design Standards

### Signal API

```javascript
// Standard signal structure
const signal = {
  // Required fields
  strategyId: "my_strategy",
  symbol: "BTC/USD",
  intent: "ENTER",        // ENTER | EXIT
  
  // Recommended fields
  side: "long",           // long | short | flat
  quantity: 1,
  price: 50000.0,
  timestamp: Date.now(),
  
  // Optional metadata
  barTime: 1234567890000,
  tf: "15m",
  meta: {
    reason: "EMA_CROSSOVER",
    confidence: 0.85,
    indicators: {
      fast: 50100,
      slow: 49900
    }
  }
};

// Use helper methods (preferred)
return this.entryLong({
  symbol,
  quantity: qty,
  meta: { reason: "EMA_CROSSOVER" }
});
```

### Helper Method Design

```javascript
// Good: Clear, single purpose, well-documented
/**
 * Calculate position size based on risk percentage
 * @param {Object} options - Sizing options
 * @param {string} options.symbol - Trading symbol
 * @param {number} options.price - Current price
 * @param {number} options.riskPct - Risk percentage (0-100)
 * @param {number} options.fallbackQty - Fallback quantity if calculation fails
 * @returns {number} Position size
 */
calculatePositionSize(options) {
  const { symbol, price, riskPct, fallbackQty = 1 } = options;
  
  // Validation
  if (!price || price <= 0) return fallbackQty;
  if (!riskPct || riskPct <= 0) return fallbackQty;
  
  // Calculation
  const accountSize = this.getAccountBalance();
  const riskAmount = accountSize * (riskPct / 100);
  const quantity = Math.floor(riskAmount / price);
  
  return Math.max(1, quantity);
}

// Bad: Unclear, multiple responsibilities, no validation
calc(s, p, r) {
  return Math.floor((this.bal * r) / p) || 1;
}
```

### Fluent API Pattern (RuleChain)

```javascript
// Chainable, readable, self-documenting
return this.rule(data)
  .whenPos("flat", symbol)
  .when(isUptrend)
  .whenCrossUp(fast, slow, "entry")
  .enterLong({ symbol, quantity: qty })
  
  .whenPos("long", symbol)
  .when(stopHit || targetHit)
  .exitLong({ symbol })
  
  .value();
```

---

## Template System

### Basic Strategy Template

```javascript
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

/**
 * [Strategy Name]
 * 
 * Description: [Brief description of strategy logic]
 * Type: [Trend Following | Mean Reversion | Breakout | etc.]
 * Timeframe: [Recommended timeframe]
 * Complexity: [Simple | Intermediate | Advanced]
 */
class StrategyTemplate extends BaseStrategy {
  constructor() {
    super({
      name: "strategy_template",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 100
    });
    
    this.schema = {
      // Define parameters here
      period: { type: "integer", min: 2, max: 200, default: 20 },
      threshold: { type: "number", min: 0, max: 100, default: 50 }
    };
    this._applyDefaults();
  }
  
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.lookback, "warmup")) return null;
    
    return this.safeRule(() => {
      // Implement strategy logic here
      return null;
    }, null);
  }
}

module.exports = StrategyTemplate;
```

### Advanced Strategy Template

```javascript
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

/**
 * [Advanced Strategy Name]
 * 
 * Description: [Detailed description]
 * Type: [Strategy type]
 * Timeframe: [Recommended timeframe]
 * Complexity: Advanced
 * 
 * Features:
 * - Multi-indicator confirmation
 * - Dynamic position sizing
 * - Trailing stop loss
 * - Risk management
 */
class AdvancedStrategyTemplate extends BaseStrategy {
  constructor() {
    super({
      name: "advanced_strategy_template",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 200
    });
    
    this.schema = {
      // Indicator parameters
      fastPeriod: { type: "integer", min: 2, max: 100, default: 12 },
      slowPeriod: { type: "integer", min: 5, max: 200, default: 26 },
      
      // Risk parameters
      riskPct: { type: "number", min: 0.1, max: 10, default: 1.0 },
      stopMultiplier: { type: "number", min: 0.5, max: 10, default: 2.0 },
      
      // Filter parameters
      trendFilter: { type: "boolean", default: true },
      volumeFilter: { type: "boolean", default: false }
    };
    this._applyDefaults();
    
    // Internal state
    this._state = {
      position: { entry: null, stop: null, target: null },
      signals: { lastEntry: null, lastExit: null },
      risk: { dailyLoss: 0, maxDrawdown: 0 }
    };
  }
  
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.lookback, "warmup")) return null;
    
    const barTime = Number(data.time || this.currentBar?.time || 0);
    if (!this.oncePerBar(`${symbol}_bar`, barTime)) return null;
    
    return this.safeRule(() => {
      // Get data
      const closes = this.safeSeries(symbol, "close");
      const highs = this.safeSeries(symbol, "high");
      const lows = this.safeSeries(symbol, "low");
      
      if (closes.length < this.lookback) return null;
      
      // Calculate indicators
      const indicators = this._calculateIndicators({ closes, highs, lows });
      if (!indicators) return null;
      
      // Apply filters
      if (!this._passesFilters(indicators, data)) return null;
      
      // Generate signal
      return this._generateSignal(symbol, indicators, data);
    }, null);
  }
  
  _calculateIndicators({ closes, highs, lows }) {
    // Implement indicator calculations
    return null;
  }
  
  _passesFilters(indicators, data) {
    // Implement filter logic
    return true;
  }
  
  _generateSignal(symbol, indicators, data) {
    // Implement signal generation
    return null;
  }
}

module.exports = AdvancedStrategyTemplate;
```

---

## Documentation Standards

### Inline Documentation

```javascript
/**
 * Calculate exponential moving average crossover signal
 * 
 * This method implements a dual EMA crossover strategy with the following logic:
 * - Enter long when fast EMA crosses above slow EMA
 * - Exit long when fast EMA crosses below slow EMA
 * 
 * @param {Object} data - Market data packet
 * @param {string} data.symbol - Trading symbol
 * @param {number} data.close - Current close price
 * @param {number} data.time - Bar timestamp
 * 
 * @returns {Object|null} Signal object or null if no signal
 * 
 * @example
 * const signal = strategy.next({
 *   symbol: "BTC/USD",
 *   close: 50000,
 *   time: Date.now()
 * });
 */
next(data) {
  // Implementation
}
```

### Strategy Documentation Template

```markdown
# Strategy Name

## Overview
Brief description of the strategy, its purpose, and expected behavior.

## Strategy Type
- **Category**: Trend Following / Mean Reversion / Breakout / etc.
- **Timeframe**: Recommended timeframe(s)
- **Complexity**: Simple / Intermediate / Advanced
- **Risk Level**: Low / Medium / High

## Logic Description
Detailed explanation of the strategy logic, including:
- Entry conditions
- Exit conditions
- Position sizing rules
- Risk management approach

## Parameters
| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| fastPeriod | integer | 2-100 | 12 | Fast EMA period |
| slowPeriod | integer | 5-200 | 26 | Slow EMA period |
| riskPct | number | 0.1-10 | 1.0 | Risk per trade (%) |

## Indicators Used
- EMA (Exponential Moving Average)
- RSI (Relative Strength Index)
- ATR (Average True Range)

## Performance Characteristics
- **Win Rate**: Expected win rate range
- **Risk/Reward**: Typical risk/reward ratio
- **Drawdown**: Expected maximum drawdown
- **Best Markets**: Market conditions where strategy performs well

## Usage Example
\`\`\`javascript
const strategy = new MyStrategy();
strategy.updateParams({
  fastPeriod: 10,
  slowPeriod: 20,
  riskPct: 1.5
});
\`\`\`

## Backtest Results
Summary of backtest performance on different timeframes and symbols.

## Known Limitations
- List of known limitations or edge cases
- Market conditions where strategy may underperform

## Version History
- v1.0.0 (2026-02-25): Initial implementation
```

---

## State Management

### State Initialization

```javascript
constructor() {
  super({ /* config */ });
  
  // Centralized state object
  this._state = {
    // Position state
    position: {
      entry: null,
      stop: null,
      target: null,
      breakeven: false,
      trailingStop: null
    },
    
    // Signal state
    signals: {
      lastEntry: null,
      lastExit: null,
      consecutiveWins: 0,
      consecutiveLosses: 0
    },
    
    // Risk state
    risk: {
      dailyLoss: 0,
      weeklyLoss: 0,
      maxDrawdown: 0,
      riskMultiplier: 1.0
    },
    
    // Indicator state (for stateful indicators)
    indicators: {
      lastCross: null,
      trendDirection: null
    }
  };
}
```

### State Reset Patterns

```javascript
// Reset position state on exit
_resetPositionState() {
  this._state.position = {
    entry: null,
    stop: null,
    target: null,
    breakeven: false,
    trailingStop: null
  };
}

// Reset daily state at day boundary
_resetDailyState() {
  this._state.risk.dailyLoss = 0;
  this._state.signals.consecutiveWins = 0;
  this._state.signals.consecutiveLosses = 0;
}

// Partial state update
_updatePositionStop(newStop) {
  this._state.position.stop = newStop;
  this._state.position.breakeven = true;
}
```

### State Persistence Pattern

```javascript
// Get state snapshot for persistence
getStateSnapshot() {
  return {
    id: this.id,
    name: this.name,
    symbols: this.symbols,
    timeframe: this.timeframe,
    params: { ...this.params },
    state: JSON.parse(JSON.stringify(this._state)) // Deep clone
  };
}

// Restore state from snapshot
restoreState(snapshot) {
  if (!snapshot || !snapshot.state) return;
  
  this._state = {
    ...this._state,
    ...snapshot.state
  };
  
  if (snapshot.params) {
    this.updateParams(snapshot.params);
  }
}
```

---

## Performance Optimization

### Hot Path Optimization

```javascript
// Cache frequently accessed values
next(data) {
  // Cache symbol resolution
  const symbol = this._cachedSymbol || (this._cachedSymbol = this.symbols[0]);
  
  // Early returns for common cases
  if (!this.isWarmedUp(symbol)) return null;
  
  // Cache series access
  if (!this._seriesCache || this._seriesCache.time !== data.time) {
    this._seriesCache = {
      time: data.time,
      closes: this.series(symbol, "close"),
      highs: this.series(symbol, "high"),
      lows: this.series(symbol, "low")
    };
  }
  
  const { closes, highs, lows } = this._seriesCache;
  
  // Continue with logic
}
```

### Indicator Caching

```javascript
// Cache indicator calculations
_getIndicators(closes, barTime) {
  // Check cache validity
  if (this._indicatorCache && this._indicatorCache.time === barTime) {
    return this._indicatorCache.values;
  }
  
  // Calculate indicators
  const fast = this.indicators.EMA.calculate({
    period: this.params.fastPeriod,
    values: closes
  });
  
  const slow = this.indicators.EMA.calculate({
    period: this.params.slowPeriod,
    values: closes
  });
  
  // Update cache
  this._indicatorCache = {
    time: barTime,
    values: { fast, slow }
  };
  
  return this._indicatorCache.values;
}
```

### Memory Management

```javascript
// Limit internal state size
_addToHistory(item) {
  if (!this._history) this._history = [];
  
  this._history.push(item);
  
  // Keep only last N items
  const MAX_HISTORY = 1000;
  if (this._history.length > MAX_HISTORY) {
    this._history = this._history.slice(-MAX_HISTORY);
  }
}

// Clear caches periodically
_clearCaches() {
  this._seriesCache = null;
  this._indicatorCache = null;
  this._cachedSymbol = null;
}
```

---

## Version Control & Code Review

### Git Workflow

```bash
# Feature branch naming
feature/ema-crossover-strategy
feature/add-risk-manager
fix/position-sizing-bug
docs/update-strategy-guide

# Commit message format
type(scope): subject

body (optional)

footer (optional)

# Examples
feat(strategy): add EMA crossover strategy
fix(position): correct quantity calculation
docs(guide): update standardization guide
refactor(helpers): extract trend filter to module
```

### Code Review Checklist

- [ ] Follows naming conventions
- [ ] Proper error handling and validation
- [ ] Includes warmup guards
- [ ] Uses helper methods appropriately
- [ ] Documented with JSDoc comments
- [ ] Includes unit tests
- [ ] No hardcoded values (use schema)
- [ ] Proper state management
- [ ] Performance considerations addressed
- [ ] Backward compatible (if modifying existing code)

---

## Migration Guide

### Migrating Legacy Strategies

```javascript
// BEFORE (Legacy)
class OldStrategy {
  constructor() {
    this.symbol = "BTC/USD";
    this.period = 20;
  }
  
  onTick(tick) {
    const closes = this.getCloses();
    const sma = this.calculateSMA(closes, this.period);
    
    if (tick.price > sma) {
      return { action: "buy", symbol: this.symbol };
    }
    return null;
  }
}

// AFTER (Standardized)
class NewStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "new_strategy",
      symbols: ["BTC/USD"],
      timeframe: "1m",
      lookback: 100
    });
    
    this.schema = {
      period: { type: "integer", min: 2, max: 200, default: 20 }
    };
    this._applyDefaults();
  }
  
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.params.period, "sma_guard")) return null;
    
    return this.safeRule(() => {
      const closes = this.safeSeries(symbol, "close");
      const sma = this.indicators.SMA.calculate({
        period: this.params.period,
        values: closes
      });
      
      const currentPrice = data.close || data.price;
      const smaValue = sma[sma.length - 1];
      
      return this.rule(data)
        .whenPos("flat", symbol)
        .when(currentPrice > smaValue)
        .enterLong({ symbol, quantity: 1 })
        .value();
    }, null);
  }
}
```

### Migration Steps

1. **Extend BaseStrategy**: Change class to extend `BaseStrategy`
2. **Update Constructor**: Use standardized config object
3. **Add Schema**: Define parameter schema with types and bounds
4. **Update Method Signature**: Change to `next(data)` pattern
5. **Add Guards**: Include warmup and bar requirement guards
6. **Use Helpers**: Replace custom logic with helper methods
7. **Wrap in safeRule**: Add error containment
8. **Use RuleChain**: Convert signal logic to rule chain pattern
9. **Add Logging**: Include structured logging
10. **Test**: Verify behavior matches original

---

## Validation Tools

### Strategy Validator

```javascript
// utils/strategy/StrategyValidator.js
class StrategyValidator {
  static validate(strategy) {
    const errors = [];
    const warnings = [];
    
    // Check class structure
    if (!(strategy.prototype instanceof BaseStrategy)) {
      errors.push("Strategy must extend BaseStrategy");
    }
    
    // Check required methods
    if (typeof strategy.prototype.next !== 'function') {
      errors.push("Strategy must implement next() method");
    }
    
    // Check configuration
    const instance = new strategy();
    
    if (!Array.isArray(instance.symbols) || instance.symbols.length === 0) {
      errors.push("Strategy must define at least one symbol");
    }
    
    if (!instance.timeframe) {
      warnings.push("Strategy should define timeframe");
    }
    
    if (!instance.lookback || instance.lookback < 10) {
      warnings.push("Strategy should define adequate lookback period");
    }
    
    // Check schema
    if (!instance.schema || Object.keys(instance.schema).length === 0) {
      warnings.push("Strategy should define parameter schema");
    }
    
    // Check for common anti-patterns
    const source = strategy.toString();
    
    if (source.includes('throw new Error') && !source.includes('safeRule')) {
      warnings.push("Consider using safeRule for error containment");
    }
    
    if (!source.includes('isWarmedUp')) {
      warnings.push("Strategy should check warmup status");
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
```

### Linting Rules

```javascript
// .eslintrc.js additions for strategy files
module.exports = {
  rules: {
    // Enforce use of strict mode
    'strict': ['error', 'global'],
    
    // Require JSDoc comments for classes and methods
    'require-jsdoc': ['warn', {
      require: {
        FunctionDeclaration: true,
        MethodDefinition: true,
        ClassDeclaration: true
      }
    }],
    
    // Enforce consistent naming
    'camelcase': ['error', { properties: 'never' }],
    
    // Require error handling
    'no-throw-literal': 'error',
    'no-unmodified-loop-condition': 'error',
    
    // Performance
    'no-loop-func': 'error',
    'no-await-in-loop': 'warn'
  }
};
```

---

## Quick Reference

### Essential Patterns Checklist

```javascript
// ✓ Minimal viable strategy
class MinimalStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "minimal",
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
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    
    return this.safeRule(() => {
      // Your logic here
      return null;
    }, null);
  }
}
```

### Common Helper Methods

```javascript
// Symbol resolution
const symbol = this.resolveSymbol({ packet: data });

// Warmup guards
if (!this.isWarmedUp(symbol)) return null;
if (!this.requireBars(symbol, 100, "context")) return null;

// Safe data access
const closes = this.safeSeries(symbol, "close");

// Once per bar
if (!this.oncePerBar("key", data.time)) return null;

// Error containment
return this.safeRule(() => { /* logic */ }, null);

// Signal generation
return this.entryLong({ symbol, quantity: 1 });
return this.exitLong({ symbol });
return this.exitAll({ symbol });

// Rule chain
return this.rule(data)
  .whenPos("flat", symbol)
  .whenCrossUp(fast, slow, "key")
  .enterLong({ symbol, quantity: 1 })
  .value();
```

### Signal Structure

```javascript
{
  strategyId: "my_strategy",  // Required
  symbol: "BTC/USD",          // Required
  intent: "ENTER",            // Required: ENTER | EXIT
  side: "long",               // Recommended: long | short | flat
  quantity: 1,                // Recommended
  price: 50000,               // Optional
  timestamp: Date.now(),      // Optional
  barTime: 1234567890000,     // Optional
  tf: "15m",                  // Optional
  meta: { /* custom */ }      // Optional
}
```

---

## Appendix

### Related Documentation

- [`STRATEGY_SYNTAX_REFERENCE.md`](./STRATEGY_SYNTAX_REFERENCE.md) - Complete API reference
- [`STRATEGY_GUIDE.md`](./STRATEGY_GUIDE.md) - Getting started guide
- [`STRATEGY_METHOD_CHEATSHEET.md`](./STRATEGY_METHOD_CHEATSHEET.md) - Quick method lookup
- [`STRATEGY_LANGUAGE_FEATURES.md`](./STRATEGY_LANGUAGE_FEATURES.md) - Language features
- [`LOGGING_REFERENCE.md`](./LOGGING_REFERENCE.md) - Logging standards

### Support & Contribution

For questions, issues, or contributions:
- Review existing documentation
- Check example strategies in `docs/examples/`
- Follow the standardization guide for new contributions
- Submit pull requests with proper documentation

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Maintained By:** CoreX Development Team
