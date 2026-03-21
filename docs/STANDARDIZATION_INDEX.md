# CoreX Strategy Standardization System - Complete Index

**Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Status:** Official Release

---

## Overview

The CoreX Strategy Standardization System is a comprehensive framework for developing, validating, and maintaining trading strategies. This index provides a complete map of all standardization resources, tools, and documentation.

---

## Quick Start

### For New Users

1. Read [`STRATEGY_GUIDE.md`](./STRATEGY_GUIDE.md) - Getting started
2. Review [`COREX_STANDARDIZATION_GUIDE.md`](./COREX_STANDARDIZATION_GUIDE.md) - Core standards
3. Use [`BasicStrategyTemplate.js`](../utils/strategy/templates/BasicStrategyTemplate.js) - Start coding
4. Validate with `node scripts/validate-strategy.js` - Check your work

### For Experienced Developers

1. [`STRATEGY_SYNTAX_REFERENCE.md`](./STRATEGY_SYNTAX_REFERENCE.md) - Complete API reference
2. [`BEST_PRACTICES_GUIDE.md`](./BEST_PRACTICES_GUIDE.md) - Production patterns
3. [`AdvancedStrategyTemplate.js`](../utils/strategy/templates/AdvancedStrategyTemplate.js) - Advanced template
4. [`ADX_FILTERED_TSL_COREX.js`](./examples/ADX_FILTERED_TSL_COREX.js) - Production example

---

## Documentation Structure

### Core Documentation

| Document | Purpose | Audience | Priority |
|----------|---------|----------|----------|
| [`STRATEGY_GUIDE.md`](./STRATEGY_GUIDE.md) | Getting started guide | Beginners | ⭐⭐⭐ |
| [`COREX_STANDARDIZATION_GUIDE.md`](./COREX_STANDARDIZATION_GUIDE.md) | Complete standardization reference | All | ⭐⭐⭐ |
| [`STRATEGY_SYNTAX_REFERENCE.md`](./STRATEGY_SYNTAX_REFERENCE.md) | Detailed API documentation | All | ⭐⭐⭐ |
| [`BEST_PRACTICES_GUIDE.md`](./BEST_PRACTICES_GUIDE.md) | Production best practices | Intermediate+ | ⭐⭐⭐ |
| [`STRATEGY_METHOD_CHEATSHEET.md`](./STRATEGY_METHOD_CHEATSHEET.md) | Quick method lookup | All | ⭐⭐ |
| [`STRATEGY_LANGUAGE_FEATURES.md`](./STRATEGY_LANGUAGE_FEATURES.md) | Language feature reference | Intermediate | ⭐⭐ |
| [`LOGGING_REFERENCE.md`](./LOGGING_REFERENCE.md) | Logging standards | All | ⭐ |

### System Documentation

| Document | Purpose | Audience |
|----------|---------|----------|
| [`SYSTEM_REFERENCE.md`](./SYSTEM_REFERENCE.md) | System-level APIs | Advanced |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System architecture | Developers |
| [`MT5_BRIDGE.md`](./MT5_BRIDGE.md) | MT5 integration | Integration |

---

## Code Resources

### Templates

| Template | Description | Use Case | Location |
|----------|-------------|----------|----------|
| **BasicStrategyTemplate** | Simple strategy template | Learning, simple strategies | [`utils/strategy/templates/BasicStrategyTemplate.js`](../utils/strategy/templates/BasicStrategyTemplate.js) |
| **AdvancedStrategyTemplate** | Complex strategy template | Production strategies | [`utils/strategy/templates/AdvancedStrategyTemplate.js`](../utils/strategy/templates/AdvancedStrategyTemplate.js) |

### Examples

| Example | Description | Complexity | Location |
|---------|-------------|------------|----------|
| **ADX Filtered TSL** | Production-ready trend strategy | Advanced | [`docs/examples/ADX_FILTERED_TSL_COREX.js`](./examples/ADX_FILTERED_TSL_COREX.js) |
| **EMA Crossover** | Simple crossover strategy | Basic | See [`STRATEGY_SYNTAX_REFERENCE.md`](./STRATEGY_SYNTAX_REFERENCE.md#13-advanced-example-ema-crossover) |

### Core Classes

| Class | Purpose | Location |
|-------|---------|----------|
| **BaseStrategy** | Base class for all strategies | [`utils/BaseStrategy.js`](../utils/BaseStrategy.js) |
| **StrategyContract** | Contract enforcement | [`engine/core/strategy/StrategyContract.js`](../engine/core/strategy/StrategyContract.js) |
| **RuleChain** | Fluent rule DSL | [`utils/strategy/RuleChain.js`](../utils/strategy/RuleChain.js) |

### Helper Modules

| Module | Purpose | Location |
|--------|---------|----------|
| **StrategyDevHelpers** | Development helpers | [`utils/strategy/StrategyDevHelpers.js`](../utils/strategy/StrategyDevHelpers.js) |
| **StrategySignalUtils** | Signal utilities | [`utils/strategy/StrategySignalUtils.js`](../utils/strategy/StrategySignalUtils.js) |
| **StrategyParamUtils** | Parameter management | [`utils/strategy/StrategyParamUtils.js`](../utils/strategy/StrategyParamUtils.js) |
| **StrategyPositionManager** | Position tracking | [`utils/strategy/StrategyPositionManager.js`](../utils/strategy/StrategyPositionManager.js) |
| **StrategyDataManager** | Data management | [`utils/strategy/StrategyDataManager.js`](../utils/strategy/StrategyDataManager.js) |
| **StrategyRuntimeUtils** | Runtime utilities | [`utils/strategy/StrategyRuntimeUtils.js`](../utils/strategy/StrategyRuntimeUtils.js) |

---

## Tools & Utilities

### Validation Tools

| Tool | Purpose | Usage |
|------|---------|-------|
| **StrategyValidator** | Validate strategy code | `const StrategyValidator = require('@utils/strategy/StrategyValidator');` |
| **validate-strategy CLI** | Command-line validator | `node scripts/validate-strategy.js <file>` |

#### Validator Usage

```bash
# Validate single strategy
node scripts/validate-strategy.js strategies/my_strategy.js

# Validate all strategies
node scripts/validate-strategy.js --all

# Verbose output
node scripts/validate-strategy.js strategies/my_strategy.js --verbose
```

#### Programmatic Validation

```javascript
const StrategyValidator = require('@utils/strategy/StrategyValidator');
const MyStrategy = require('./strategies/my_strategy');

const result = StrategyValidator.validate(MyStrategy);

if (result.valid) {
  console.log('Strategy is valid!');
  console.log(`Grade: ${result.summary.grade}`);
} else {
  console.log('Validation failed:');
  result.errors.forEach(err => console.log(`- ${err.message}`));
}
```

---

## Standards & Conventions

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| **Class Names** | PascalCase | `EmaCrossover`, `ADXFilteredTSL` |
| **File Names** | snake_case | `ema_crossover.js`, `adx_filtered_tsl.js` |
| **Variables** | camelCase | `fastPeriod`, `slowPeriod` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_LOOKBACK`, `DEFAULT_RISK_PCT` |
| **Private Members** | _prefixed | `_state`, `_calculateIndicators()` |

### File Structure

```
strategies/
├── my_strategy.js           # Strategy implementation
├── my_strategy.test.js      # Unit tests
└── my_strategy.md           # Documentation

utils/strategy/
├── MyHelper.js              # Reusable helper
└── MyHelper.test.js         # Helper tests
```

### Code Organization

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
}
```

---

## API Reference

### Essential Methods

#### Data Access
- `series(symbol, field)` - Get price series
- `getLookbackWindow(symbol)` - Get bar objects
- `safeSeries(symbol, field, fallback)` - Safe series access

#### Guards
- `isWarmedUp(symbol)` - Check warmup status
- `requireBars(symbol, n, context)` - Require minimum bars
- `hasBars(symbol, n)` - Check bar availability
- `oncePerBar(key, barTime)` - Prevent duplicate actions

#### Signal Generation
- `entryLong(params)` - Long entry signal
- `entryShort(params)` - Short entry signal
- `exitLong(params)` - Long exit signal
- `exitShort(params)` - Short exit signal
- `exitAll(params)` - Exit all positions
- `flipToLong(params)` - Flip to long
- `flipToShort(params)` - Flip to short

#### Position Management
- `pos(state, symbol)` - Check position state
- `positions.get(symbol)` - Get position info
- `positions.open(symbol, side, qty, price)` - Open position
- `positions.close(symbol, price)` - Close position

#### Rule Chain
- `rule(data)` - Start rule chain
- `.when(condition)` - Conditional gate
- `.whenPos(state, symbol)` - Position gate
- `.whenCrossUp(a, b, key)` - Crossover gate
- `.whenCrossDown(a, b, key)` - Crossunder gate
- `.value()` - Finalize chain

#### Utilities
- `resolveSymbol({symbol, packet})` - Resolve symbol
- `safeRule(fn, fallback)` - Error containment
- `describe(features)` - Get metadata
- `logDecision(msg, meta, level)` - Log decision
- `logSignal(signal, stage, level)` - Log signal
- `logGuard(name, passed, details)` - Log guard

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

### Parameter Schema

```javascript
this.schema = {
  paramName: {
    type: "integer",          // integer | number | float | boolean | string
    min: 2,                   // Minimum value (numeric types)
    max: 200,                 // Maximum value (numeric types)
    default: 20,              // Default value
    label: "Parameter Name",  // UI label
    description: "..."        // Description
  }
};
```

---

## Validation Standards

### Validation Levels

| Level | Description | Action |
|-------|-------------|--------|
| **ERROR** | Critical issue, strategy will fail | Must fix |
| **WARNING** | Best practice violation | Should fix |
| **INFO** | Informational message | Optional |

### Validation Checks

#### Structure Checks
- ✓ Extends BaseStrategy
- ✓ Implements required methods
- ✓ Defines symbols array
- ✓ Defines parameter schema

#### Best Practice Checks
- ✓ Uses warmup guards
- ✓ Uses helper methods
- ✓ Uses signal helpers
- ✓ Includes error handling
- ✓ Has documentation

#### Anti-Pattern Checks
- ✗ Unguarded throws
- ✗ Missing warmup checks
- ✗ Unsafe series access
- ✗ Hardcoded values
- ✗ Console.log usage
- ✗ Infinite loops

---

## Migration Guide

### From Legacy to Standardized

#### Step 1: Extend BaseStrategy

```javascript
// Before
class OldStrategy {
  constructor() {
    this.symbol = "BTC/USD";
  }
}

// After
class NewStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "new_strategy",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 100
    });
  }
}
```

#### Step 2: Add Parameter Schema

```javascript
// Before
constructor() {
  this.period = 20;
}

// After
constructor() {
  super({ /* config */ });
  
  this.schema = {
    period: { type: "integer", min: 2, max: 200, default: 20 }
  };
  this._applyDefaults();
}
```

#### Step 3: Update Method Signature

```javascript
// Before
onTick(tick) {
  // Logic
}

// After
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.isWarmedUp(symbol)) return null;
  
  return this.safeRule(() => {
    // Logic
  }, null);
}
```

#### Step 4: Use Helper Methods

```javascript
// Before
const closes = this.getCloses();
const sma = this.calculateSMA(closes, 20);

// After
const closes = this.safeSeries(symbol, "close");
const sma = this.indicators.SMA.calculate({ period: 20, values: closes });
```

#### Step 5: Use Signal Helpers

```javascript
// Before
return { action: "buy", symbol: this.symbol };

// After
return this.entryLong({ symbol, quantity: 1 });
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| **Strategy not trading** | Not warmed up | Add `isWarmedUp()` check |
| **Indicator errors** | Insufficient data | Add `requireBars()` check |
| **Duplicate signals** | No bar deduplication | Use `oncePerBar()` |
| **Strategy crashes** | Unhandled errors | Wrap in `safeRule()` |
| **Invalid signals** | Wrong signal structure | Use signal helpers |

### Debug Checklist

1. ✓ Check warmup status
2. ✓ Verify bar count
3. ✓ Validate indicator output
4. ✓ Check position state
5. ✓ Review logs
6. ✓ Inspect state snapshot
7. ✓ Run validator

---

## Performance Guidelines

### Optimization Priorities

1. **Correctness** - Get it working correctly first
2. **Clarity** - Keep code readable and maintainable
3. **Performance** - Optimize only when necessary

### Performance Tips

- Cache indicator calculations per bar
- Minimize series access
- Avoid unnecessary calculations
- Limit lookback window size
- Use early returns
- Profile before optimizing

---

## Support & Resources

### Getting Help

1. **Documentation** - Check relevant docs first
2. **Examples** - Review example strategies
3. **Validation** - Run validator for specific issues
4. **Logs** - Check strategy logs for errors

### Contributing

1. Follow standardization guide
2. Use templates as starting point
3. Validate before submitting
4. Include tests and documentation
5. Follow code review checklist

---

## Version History

### v1.0.0 (2026-02-25)
- Initial release of standardization system
- Complete documentation suite
- Validation tools
- Strategy templates
- Best practices guide

---

## Quick Reference Card

### Minimal Strategy

```javascript
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

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

module.exports = MinimalStrategy;
```

### Essential Imports

```javascript
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");
const { INTENTS, SIDES } = require("@config/constants");
```

### Common Patterns

```javascript
// Symbol resolution
const symbol = this.resolveSymbol({ packet: data });

// Warmup guards
if (!this.isWarmedUp(symbol)) return null;
if (!this.requireBars(symbol, 100)) return null;

// Safe data access
const closes = this.safeSeries(symbol, "close");

// Error containment
return this.safeRule(() => { /* logic */ }, null);

// Signal generation
return this.entryLong({ symbol, quantity: 1 });

// Rule chain
return this.rule(data)
  .whenPos("flat", symbol)
  .whenCrossUp(fast, slow)
  .enterLong({ symbol, quantity: 1 })
  .value();
```

---

## Document Map

```
docs/
├── STANDARDIZATION_INDEX.md          ← You are here
├── COREX_STANDARDIZATION_GUIDE.md    ← Core standards
├── STRATEGY_GUIDE.md                 ← Getting started
├── STRATEGY_SYNTAX_REFERENCE.md      ← Complete API
├── BEST_PRACTICES_GUIDE.md           ← Production patterns
├── STRATEGY_METHOD_CHEATSHEET.md     ← Quick reference
├── STRATEGY_LANGUAGE_FEATURES.md     ← Language features
├── LOGGING_REFERENCE.md              ← Logging standards
└── examples/
    └── ADX_FILTERED_TSL_COREX.js     ← Production example

utils/strategy/
├── StrategyValidator.js              ← Validation tool
├── StrategyDevHelpers.js             ← Development helpers
└── templates/
    ├── BasicStrategyTemplate.js      ← Simple template
    └── AdvancedStrategyTemplate.js   ← Advanced template

scripts/
└── validate-strategy.js              ← CLI validator
```

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Maintained By:** CoreX Development Team

**For questions or contributions, refer to the relevant documentation section above.**
