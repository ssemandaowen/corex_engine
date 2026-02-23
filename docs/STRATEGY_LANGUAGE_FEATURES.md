# CoreX Strategy Language Features

## 1. Goal
CoreX strategy authoring is JavaScript-based, but with a structured strategy runtime ("strategy language") built from:
- `BaseStrategy`
- Strategy helper mixins
- Rule DSL (`RuleChain`)
- Signal contract + adapter

This document defines the language features clearly for strategy developers.

## 2. Language Model

### 2.1 Program shape
A strategy is a class, typically extending `BaseStrategy`, that returns a signal or `null`.

```js
class MyStrategy extends BaseStrategy {
  constructor() { /* config + schema */ }
  next(data) { /* return signal or null */ }
}
```

### 2.2 Runtime contract
At execution, strategies are adapted to a standardized contract:
- `generateSignal(packet, context)` (standardized)
- optional lifecycle hooks:
  - `init`
  - `onMarketData`
  - `teardown`
  - `getStateSnapshot`

Legacy methods still work:
- `next`
- `onTick`
- `onBar`

## 3. Core Language Features

### 3.1 Data access
- `series(symbol, field)` -> numeric array
- `getLookbackWindow(symbol)` -> candle objects
- `isWarmedUp(symbol)` -> warmup guard

### 3.2 Signal semantics
Required signal keys:
- `strategyId`
- `symbol`
- `intent` (`ENTER|EXIT`)

Common keys:
- `side` (`long|short|flat`)
- `quantity`
- `price`
- `timestamp`

### 3.3 Position semantics
- `pos("flat"|"long"|"short", symbol)`
- `positions.get(symbol)`

### 3.4 Rule DSL
`this.rule(data)` chain:
- conditions: `when`, `whenPos`, `whenCrossUp`, `whenCrossDown`
- actions: `enterLong`, `enterShort`, `exitLong`, `exitShort`, `exitAll`, `flipToLong`, `flipToShort`
- terminal: `.value()`

### 3.5 Parameter schema language
Schema supports:
- `type`: `boolean|integer|number|float|string`
- `default`
- numeric bounds: `min|max`

Runtime update behavior:
- type coercion
- bounds validation
- invalid updates skipped

## 4. New Robust Strategy Helpers

File: `utils/strategy/StrategyDevHelpers.js`  
Available on all `BaseStrategy` strategies.

### 4.1 `resolveSymbol({ symbol, packet })`
Resolves symbol from explicit input, packet, or strategy default.

### 4.2 `hasBars(symbol, n)`
Returns `true` when at least `n` completed bars are available.

### 4.3 `requireBars(symbol, n, context?)`
Guard helper; `false` when insufficient bars.

### 4.4 `safeSeries(symbol, field, fallback?)`
Returns series safely and avoids throw-based failures.

### 4.5 `oncePerBar(key, barTime?)`
Returns `true` once for a bar+key; suppresses duplicate intra-bar actions.

### 4.6 `describe(features?)`
Returns lightweight metadata for UI/telemetry.

### 4.7 `safeRule(fn, fallback?)`
Catches transient logic errors and returns fallback instead of crashing flow.

## 5. Authoring Patterns

### 5.1 Safe entry skeleton
```js
next(data) {
  const symbol = this.resolveSymbol({ packet: data });
  if (!this.isWarmedUp(symbol)) return null;
  if (!this.requireBars(symbol, 50, "ema_guard")) return null;

  const closes = this.safeSeries(symbol, "close");
  if (closes.length < 50) return null;

  return this.safeRule(() => {
    // your logic
    return null;
  });
}
```

### 5.2 Once-per-bar action
```js
if (signal && this.oncePerBar("entry_gate", data.time)) {
  return signal;
}
return null;
```

## 6. Feature Matrix

| Feature | Purpose | API |
|---|---|---|
| Warmup guard | avoid early noisy signals | `isWarmedUp`, `requireBars` |
| Safe data reads | avoid runtime throw | `safeSeries` |
| Signal consistency | enforce adapter contract | helper signal methods |
| Duplicate prevention | block repeated same-bar action | `oncePerBar`, RuleChain |
| Defensive execution | avoid strategy crash loops | `safeRule` |
| Runtime tuning | operator param updates | schema + `updateParams` |

## 7. Suggested Language Style Guide
- Always guard warmup/bars before indicator calculations.
- Prefer helper signal methods (`entryLong`, `exitAll`, etc.) over custom objects.
- Keep one clear decision path per bar.
- Use `safeRule` around complex blocks.
- Use schema defaults and bounds aggressively.

## 8. Versioning Note
The strategy language remains backward compatible:
- Existing `next()` strategies continue to run.
- Contract adaptation bridges legacy strategies to the standardized runtime pipeline.

