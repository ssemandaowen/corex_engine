# CoreX Strategy Method Cheat Sheet (Quick Lookup)

This is a one-page method index for strategy authoring. See `docs/STRATEGY_SYNTAX_REFERENCE.md` for full semantics and examples.

## Core Strategy API

| Method | Category | Input | Returns | Use When |
|---|---|---|---|---|
| `next(data)` | Lifecycle | packet | signal or `null` | Main decision loop. |
| `onTick(tick)` | Lifecycle | tick | signal or `null` | Raw tick ingest (candleBased optional). |
| `onBar(bar)` | Lifecycle | bar | signal or `null` | Bar ingest path. |
| `isWarmedUp(symbol)` | Guard | symbol | boolean | Before indicators or signal logic. |
| `series(symbol, field)` | Data | symbol, field | number[] | Fetch OHLCV series. |
| `getLookbackWindow(symbol)` | Data | symbol | bar[] | Direct access to bar objects. |
| `pos(state, symbol)` | Position | state, symbol | boolean | Position state checks (`long/short/flat`). |
| `rule(data)` | Control | packet | RuleChain | Fluent rule-based gating. |

## Signal Factories

| Method | Category | Input | Returns | Use When |
|---|---|---|---|---|
| `entryLong(params)` | Signal | meta | signal | Open/increase long exposure. |
| `entryShort(params)` | Signal | meta | signal | Open/increase short exposure. |
| `exitLong(params)` | Signal | meta | signal | Reduce/close long leg. |
| `exitShort(params)` | Signal | meta | signal | Reduce/close short leg. |
| `exitAll(params)` | Signal | meta | signal | Flatten regardless of side. |
| `flipToLong(params)` | Signal | meta | signal | Reversal: short to long. |
| `flipToShort(params)` | Signal | meta | signal | Reversal: long to short. |

## RuleChain

| Method | Category | Input | Returns | Use When |
|---|---|---|---|---|
| `when(condition)` | Rule | boolean | RuleChain | Gate next action on condition. |
| `whenPos(state, symbol)` | Rule | state, symbol | RuleChain | Gate on current position. |
| `whenCrossUp(a,b,key?)` | Rule | arrays/values | RuleChain | Cross-up gate for indicators. |
| `whenCrossDown(a,b,key?)` | Rule | arrays/values | RuleChain | Cross-down gate for indicators. |
| `value()` / `end()` | Rule | none | signal or `null` | Finalize chain and return signal. |

## Robust Helpers (StrategyDevHelpers)

| Method | Category | Input | Returns | Use When |
|---|---|---|---|---|
| `resolveSymbol({symbol, packet})` | Guard | symbol/packet | string | Normalize symbol choice. |
| `hasBars(symbol, n)` | Guard | symbol, n | boolean | Pre-check data depth. |
| `requireBars(symbol, n, context?)` | Guard | symbol, n | boolean | Guard with debug logging. |
| `safeSeries(symbol, field, fallback?)` | Guard | symbol, field | number[] | Non-throwing series access. |
| `oncePerBar(key, barTime?)` | Guard | key, time | boolean | Prevent duplicate same-bar actions. |
| `safeRule(fn, fallback?)` | Guard | function | any | Contain exceptions in complex blocks. |
| `describe(features?)` | Metadata | object | object | UI/telemetry metadata. |
| `logDecision(msg, meta?, level?)` | Logging | message | void | Structured decision logging. |
| `logSignal(signal, stage?, level?)` | Logging | signal | void | Structured signal logging. |
| `logGuard(name, passed, details?)` | Logging | name | void | Guard pass/fail logging. |

## Indicator Providers (`this.indicators`)

Common inputs are `{ values, period }` or OHLC arrays. Examples:

| Indicator | Example Input | Notes |
|---|---|---|
| `SMA` / `EMA` | `{ values, period }` | Returns array of values. |
| `RSI` | `{ values, period }` | Returns array of RSI values. |
| `MACD` | `{ values, fastPeriod, slowPeriod, signalPeriod }` | Returns objects `{MACD, signal, histogram}`. |
| `ATR` | `{ high, low, close, period }` | Volatility measure. |
| `BollingerBands` | `{ values, period, stdDev }` | Returns `{ upper, middle, lower }`. |

---

If you need a richer reference for a specific method, jump to `docs/STRATEGY_SYNTAX_REFERENCE.md`.
