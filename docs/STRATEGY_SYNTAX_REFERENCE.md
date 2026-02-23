# CoreX Strategy Syntax Reference (In-Depth)

## 1. Scope
This is the authoritative syntax and API reference for writing strategies that run in CoreX across backtest, paper, and live environments.

Companion language-features document:
- `docs/STRATEGY_LANGUAGE_FEATURES.md`
- `docs/LOGGING_REFERENCE.md` (for log interpretation)
- `docs/STRATEGY_METHOD_CHEATSHEET.md` (one-page method lookup)

---

## 2. Minimal Strategy Template

```js
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

class MyStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "my_strategy",
      symbols: ["BTC/USD"],
      timeframe: "1m",
      lookback: 100
    });

    this.schema = {
      fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
      slowPeriod: { type: "integer", min: 5, max: 400, default: 26 },
      riskPct: { type: "number", min: 0.1, max: 10, default: 1 }
    };
    this._applyDefaults();
  }

  next(data) {
    const symbol = data.symbol || this.symbols[0];
    if (!this.isWarmedUp(symbol)) return null;
    return null;
  }
}

module.exports = MyStrategy;
```

---

## 3. Runtime Contract

### 3.1 Contract Layer
`engine/core/strategy/StrategyContract.js` enforces/adapts strategy behavior.

Expected contract method:
- `generateSignal(packet, context)` (required by contract model)

Legacy strategy methods are adapted automatically:
- `onTick(packet, isWarmup)`
- `onBar(packet)`
- `next(packet)`

### 3.2 Why this matters
You can keep writing idiomatic `BaseStrategy` logic, while the engine executes a standardized contract path in the signal pipeline.

---

## 4. BaseStrategy Runtime Model

File: `utils/BaseStrategy.js`

### 4.1 Core fields
- `id`, `name`
- `symbols` (required; non-empty array)
- `timeframe` (e.g. `1m`, `15m`, `1h`)
- `lookback` (minimum data before trading logic)
- `params` (runtime parameter values from `schema`)
- `dataManager` (historical + active candle state)

### 4.2 Processing flow
`onTick` / `onBar` -> `_processData` -> `next` -> optional signal.

When a signal is returned, BaseStrategy enriches it with:
- `symbol`
- `time`
- `barTime`
- `tf`

---

## 5. Signal Syntax (Required Shape)

A valid signal object must include:
- `strategyId` (string)
- `symbol` (string)
- `intent` (`ENTER` or `EXIT`)

Recommended full signal:
```js
{
  strategyId: "ema_crossover",
  symbol: "BTC/USD",
  intent: "ENTER",
  side: "long",
  quantity: 1,
  price: 101234.5,
  timestamp: 1739875200000,
  barTime: 1739875200000,
  tf: "1m"
}
```

`SignalAdapter` normalizes and validates this before execution.

### 5.1 Field-by-field interpretation
| Field | Type | Required | Meaning in runtime |
|---|---|---|---|
| `strategyId` | string | yes | Strategy identity for routing, locking, persistence, telemetry. |
| `symbol` | string | yes | Instrument to execute against (`BTC/USD`, `EUR/USD`, etc.). |
| `intent` | string | yes | `ENTER` opens/increases exposure, `EXIT` closes/reduces exposure. |
| `side` | string | recommended | Direction intent (`long`, `short`, `flat`). |
| `quantity` | number | recommended | Position size used by adapter/broker execution path. |
| `price` | number | optional | Decision/reference price at emission time. |
| `timestamp` | number | optional | Event time in ms epoch; used for tracing and ordering. |
| `barTime` | number | optional | Candle boundary time used for once-per-bar logic. |
| `tf` | string | optional | Strategy timeframe context (`1m`, `15m`, etc.). |

### 5.2 Intent and side usage rules
- `ENTER + long`: open/increase long.
- `ENTER + short`: open/increase short.
- `EXIT + long`: close long leg.
- `EXIT + short`: close short leg.
- `EXIT + flat` (or `exitAll` helper): close active exposure regardless of side.

---

## 6. Built-in Signal Helpers

From `BaseStrategy` + helper mixins:
- `entryLong(params)`
- `entryShort(params)`
- `exitLong(params)`
- `exitShort(params)`
- `exitAll(params)`
- `flipToLong(params)`
- `flipToShort(params)`

Aliases:
- `buy`, `sell`, `long`, `short`, `close`, `exit`

### 6.1 Example
```js
if (crossUp) return this.entryLong({ symbol, quantity: 1 });
if (crossDown) return this.exitAll({ symbol });
return null;
```

### 6.2 Which helper to choose
- Use `entryLong/entryShort` for explicit directional entries.
- Use `exitLong/exitShort` if you track side explicitly.
- Use `exitAll` when strategy should flatten regardless of current side.
- Use `flipToLong/flipToShort` when your logic is reversal-first (exit now, enter next bar).

---

## 7. RuleChain DSL

File: `utils/strategy/RuleChain.js`

Fluent helpers:
- `when(condition)`
- `whenPos(state, symbol)`
- `whenCrossUp(a, b, key?)`
- `whenCrossDown(a, b, key?)`
- `enterLong`, `enterShort`, `exitLong`, `exitShort`, `exitAll`, `flipToLong`, `flipToShort`
- finalize with `.value()` or `.end()`

### 7.1 Example
```js
return this.rule(data)
  .whenPos("flat", symbol).whenCrossUp(fast, slow, "ma_cross").enterLong({ symbol, quantity: 1 })
  .whenPos("long", symbol).whenCrossDown(fast, slow, "ma_cross").exitLong({ symbol })
  .value();
```

### 7.2 RuleChain interpretation model
- Chain is evaluated top-to-bottom.
- First matched action wins (`_matched` guard in RuleChain).
- This avoids multiple contradictory signals in the same evaluation call.
- Use separate explicit chains only when you intentionally want independent branches.

---

## 8. Indicator + Series Helpers

### 8.1 Price series
```js
const closes = this.series(symbol, "close");
```

### 8.2 Technical indicators
`this.indicators` is from `technicalindicators`.

```js
const fast = this.indicators.SMA.calculate({ period: this.params.fastPeriod, values: closes });
const slow = this.indicators.SMA.calculate({ period: this.params.slowPeriod, values: closes });
```

### 8.3 Signal utility predicates
From `StrategySignalUtils`:
- `crossover`, `crossunder`
- `above`, `below`
- `rising`, `falling`
- `between`
- `pctChange`

---

## 9. Position / State APIs

### 9.1 Position checks
- `this.pos("flat", symbol)`
- `this.pos("long", symbol)`
- `this.pos("short", symbol)`

### 9.2 Raw position manager
- `this.positions.get(symbol)`
- `this.positions.open(...)`
- `this.positions.close(...)`

Use helper methods where possible to keep adapter contract consistent.

---

## 10. Parameter Schema (Runtime Tuning)

File: `utils/strategy/StrategyParamUtils.js`

### 10.1 Supported types
- `boolean`
- `integer`
- `number` / `float`
- fallback treated as string-like values

### 10.2 Constraints
- `min`
- `max`
- `default`

### 10.3 Example schema
```js
this.schema = {
  enableShorts: { type: "boolean", default: true },
  fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
  riskPct: { type: "number", min: 0.1, max: 5, default: 1.0 }
};
this._applyDefaults();
```

### 10.4 Runtime update behavior
- Invalid values are ignored.
- Type coercion is applied.
- `min/max` bounds are enforced.
- Update endpoint: `PATCH /api/execution/params/:id`.

---

## 11. Timeframe Syntax

Accepted by runtime utilities:
- `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- Also normalizes longer labels like `minute`, `hours`, etc in engine normalization paths.

Internally converted to milliseconds via `_getTFMs`.

---

## 12. Warmup and Data Integrity

A strategy should not trade until warm:
```js
if (!this.isWarmedUp(symbol)) return null;
```

Engine warmup:
- Loads cached/fetched bars
- Replays bars into `onBar`/`onTick`
- Moves state `WARMING_UP -> ACTIVE` only when warmup succeeds

### 12.1 Why warmup matters
Without warmup guards, indicators may compute on too few bars and emit misleading entries.  
Always combine:
- `isWarmedUp(symbol)`
- minimal series length checks (`fast.length`, `slow.length`, etc.)

---

## 13. Advanced Example: EMA Crossover

```js
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

class EmaCrossover extends BaseStrategy {
  constructor() {
    super({
      name: "ema_crossover",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 200
    });
    this.schema = {
      fastPeriod: { type: "integer", min: 2, max: 100, default: 12 },
      slowPeriod: { type: "integer", min: 3, max: 300, default: 26 },
      riskPct: { type: "number", min: 0.1, max: 5, default: 1.0 }
    };
    this._applyDefaults();
  }

  next(bar) {
    const symbol = bar.symbol || this.symbols[0];
    if (!this.isWarmedUp(symbol)) return null;

    const closes = this.series(symbol, "close");
    const fast = this.indicators.EMA.calculate({ period: this.params.fastPeriod, values: closes });
    const slow = this.indicators.EMA.calculate({ period: this.params.slowPeriod, values: closes });
    if (fast.length < 2 || slow.length < 2) return null;

    const qty = this.sizePosition({
      symbol,
      price: bar.close,
      riskPct: this.params.riskPct,
      fallbackQty: 1
    });

    return this.rule(bar)
      .whenPos("flat", symbol).whenCrossUp(fast, slow, "ema_x").enterLong({ symbol, quantity: qty })
      .whenPos("long", symbol).whenCrossDown(fast, slow, "ema_x").exitLong({ symbol })
      .value();
  }
}

module.exports = EmaCrossover;
```

---

## 14. Execution Semantics by Mode

- `BACKTEST`: uses backtest context (`enter`/`exit`)
- `PAPER`: routes to paper broker execution methods
- `LIVE`: inserts pending order records for live bridge execution

You do not write separate strategy logic for each mode.

### 14.1 How one signal is interpreted by mode
- `BACKTEST`: interpreted synchronously against simulation context (`enter/exit`).
- `PAPER`: interpreted against paper broker API (`execute/openPosition/closePosition`).
- `LIVE`: interpreted as a persisted order request (`orders` table -> bridge execution).

---

## 15. Common Errors and Fixes

### 15.1 `Missing required method`
Provide one of:
- `next`
- `onTick`
- `onBar`
- `_processData` (usually inherited from `BaseStrategy`)

### 15.2 `INVALID_SCHEMA` from adapter
Ensure signal has:
- `strategyId`
- `symbol`
- `intent`

### 15.3 No signals emitted
Check:
- `isWarmedUp(symbol)` state
- indicator array lengths
- symbol/timeframe consistency

### 15.4 Strategy in `ERROR`
Inspect:
- compile logs
- runtime signal exceptions
- broker/feed connectivity logs

---

## 16. Best Practices
- Keep `next()` deterministic and side-effect light.
- Use helper signal methods instead of hand-rolled raw objects when possible.
- Guard against insufficient indicator history.
- Validate schema ranges tightly.
- Prefer one clear signal per bar/event (RuleChain helps avoid duplicates).
- Use explicit symbol in multi-symbol strategies.
- Emit at most one decisive signal per evaluation call unless intentionally designing multi-leg behavior.
- Keep side/intent combinations explicit for easier post-trade audit.

---

## 17. Robust Helper APIs (New)

These helpers are available via `BaseStrategy` through `StrategyDevHelpers`.
Core set (one line each):
- `resolveSymbol`: consistent symbol resolution from packet/defaults.
- `hasBars` / `requireBars`: depth guards for reliable indicator input.
- `safeSeries`: non-throwing series access with fallback.
- `oncePerBar`: de-dup actions within the same bar.
- `safeRule`: contain exceptions in complex logic blocks.
- `describe`: metadata for UI/telemetry.
- `logDecision` / `logSignal` / `logGuard`: structured runtime logs.

Minimal usage pattern:
```js
const symbol = this.resolveSymbol({ packet: data });
if (!this.isWarmedUp(symbol) || !this.requireBars(symbol, 100, "warmup_guard")) return null;

const closes = this.safeSeries(symbol, "close");
if (closes.length < 100 || !this.oncePerBar("entry", data.time)) return null;

return this.safeRule(() => this.entryLong({ symbol, quantity: 1 }), null);
```

Reference:
- `docs/STRATEGY_METHOD_CHEATSHEET.md` for a one-page quick lookup of all methods.

---

## 18. Strategy Reading Guide (How to Interpret Any Strategy Quickly)

When reviewing a strategy file, read in this order:
1. `super({...})`:
   - symbols/timeframe/lookback tell market scope and signal cadence.
2. `schema`:
   - shows tunable surface area and risk of overfitting.
3. guards in `next()`:
   - warmup/bars checks indicate data safety discipline.
4. indicator build:
   - identify the core hypothesis (trend, mean-reversion, breakout).
5. signal emit line:
   - confirm exact entry/exit semantics and quantity logic.
6. logging:
   - confirm decision/signal traceability for production debugging.

---

## 19. Strategy Patterns and Their Syntax Shapes

### 19.1 Trend-following shape
- Indicators: moving averages, ADX, momentum slope.
- Syntax signature: `whenCrossUp` for entry, `whenCrossDown` for exit.

### 19.2 Mean-reversion shape
- Indicators: z-score, Bollinger mean distance, RSI extremes.
- Syntax signature: enter at deviation extremes, exit near mean.

### 19.3 Breakout shape
- Indicators: rolling high/low, range compression.
- Syntax signature: enter on boundary break, exit on invalidation/re-entry.

---

## 20. Common Misinterpretations (and correct meaning)

- Misread: `quantity` is optional and ignored.
  - Correct: it is strongly used in paper/live execution; invalid quantity can reject signals.

- Misread: `side` alone triggers execution.
  - Correct: `intent` controls action class; `side` refines direction.

- Misread: warmup is just performance optimization.
  - Correct: warmup is correctness-critical for indicator validity.

- Misread: RuleChain evaluates all actions.
  - Correct: first matching action commits signal; others are skipped in that chain.

---

## 21. Production-ready Strategy Checklist

- Contract compatible (`next`/`onTick`/`onBar` present).
- Warmup and bar guards in place.
- Uses helper signal methods (not ad-hoc object shapes).
- Quantity calculation deterministic and bounded.
- One clear action path per evaluation.
- Logs include guard + decision + signal traces.
- Parameters bounded (`min/max`) and defaults set.
- Behavior verified in backtest before paper/live.

---

## 22. Complete Method Reference (What Each Method Does)

This section is explicit and implementation-aligned.  
For every method: signature, behavior, side effects, return value, and usage.

### 22.1 BaseStrategy Core Methods

#### `constructor(config)`
- Purpose: initialize strategy identity, symbols, timeframe, data stores, params, and helpers.
- Required config:
  - `symbols` must be a non-empty array.
- Important fields created:
  - `id`, `name`, `symbols`, `timeframe`, `lookback`, `params`, `dataManager`, `positions`.
- Side effects:
  - throws error if `symbols` is missing/empty.

#### `series(symbol, field = "close")`
- Purpose: read historical values for indicator input.
- Returns: `Array<number|any>` from lookback window.
- Side effects: none.
- Use when: computing moving averages, RSI, ATR, etc.

#### `_processData(packet, meta = {})`
- Purpose: single internal data-processing entry point.
- Behavior:
  - Detects tick vs bar (`meta.source`).
  - Updates candle state via `dataManager`.
  - Calls `next(packet)`.
  - Applies delayed flip logic (`_flipNext`) if needed.
  - Enriches signal with `symbol`, `time`, `barTime`, `tf`.
- Returns: signal object or `null`.
- Side effects:
  - mutates internal data state (`lastTick`, `currentBar`, candles).

#### `onTick(tick)`
- Purpose: process live tick packets.
- Returns: signal or `null`.
- Side effects: routes through `_processData`.

#### `onBar(bar)`
- Purpose: process completed bar packets.
- Returns: signal or `null`.
- Side effects: routes through `_processData`.

#### `onMarketData(packet, context = {})`
- Purpose: contract-level generic market data handler.
- Behavior:
  - if `context.source === "bar"` -> `onBar`.
  - else -> `onTick`.

#### `generateSignal(packet, context = {})`
- Purpose: standardized contract method used by generation engine.
- Behavior: delegates to `onMarketData`.

#### `next(data)`
- Purpose: your strategy logic function (override this).
- Default: returns `null`.
- Expected output: signal object or `null`.

#### `rule(bar)`
- Purpose: create fluent `RuleChain` for controlled one-signal evaluation.
- Returns: `RuleChain`.

#### `pos(state, symbol, set = false)`
- Purpose: read or mutate position state quickly.
- Modes:
  - read mode (`set=false`): returns boolean (`true` if position matches `state`).
  - write mode (`set=true`): mutates position (`flat` closes, otherwise opens side with qty `1`).
- Side effects:
  - in write mode, mutates `positions`.

### 22.2 Signal Helper Methods

#### `entryLong(params = {})`
- Purpose: build a long-entry signal and open local position state.
- Quantity behavior:
  - uses `params.quantity` if valid.
  - otherwise auto-sizes with `sizePosition(...)`.
- Returns: signal object.
- Side effects:
  - opens position in `positions` manager.

#### `entryShort(params = {})`
- Same as `entryLong`, but short direction.

#### `exitLong(params = {})`
- Purpose: emit long-exit signal and close local position state for symbol.
- Returns: signal object.
- Side effects:
  - closes position for symbol.

#### `exitShort(params = {})`
- Same semantics as `exitLong`, short-specific intent label.

#### `exitAll(params = {})`
- Purpose: flatten position for symbol regardless of side.
- Returns: signal object.

#### `flipToLong(params = {})`
- Purpose: schedule reversal to long on next bar.
- Behavior:
  - emits `exitAll` now.
  - stores pending flip in `_flipNext`.
- Important:
  - true same-bar flip is not supported in this design.

#### `flipToShort(params = {})`
- Mirror behavior for short reversal.

#### `applyFlip(symbol)`
- Purpose: internal executor for queued flip.
- Behavior:
  - consumes `_flipNext`.
  - emits corresponding entry signal.
- Returns: signal or `null`.

#### Aliases
- `buy` -> `entryLong`
- `sell` -> `entryShort`
- `long` -> `entryLong`
- `short` -> `entryShort`
- `exit` -> `exitAll`
- `close` -> `exitAll`

### 22.3 Runtime Utility Methods (StrategyRuntimeUtils)

#### `_getTFMs(tfInput = this.timeframe)`
- Purpose: convert timeframe string to milliseconds.
- Returns: integer ms.

#### `_createSignal(intent, side, params = {})`
- Purpose: construct canonical signal object.
- Adds:
  - `strategyId`, `timestamp`, `barTime`, `tf`, resolved price.

#### `_resolveCurrentPrice(params = {})`
- Purpose: determine current actionable price.
- Source order:
  1. `params.price`
  2. `lastTick.price`
  3. active candle close
  4. `currentBar.close`
  5. `0`

#### `isWarmedUp(symbol)`
- Purpose: confirm lookback requirement is satisfied.

#### `getLookbackWindow(symbol)`
- Purpose: fetch bar window for symbol.

#### `getAccountSnapshot()`
- Purpose: obtain broker account snapshot from execution context if available.

#### `sizePosition({...})`
- Purpose: compute quantity from equity/risk.
- Inputs:
  - `price`, `riskPct`, optional min/max/step.
- Returns: numeric qty or fallback.

### 22.4 Parameter Methods (StrategyParamUtils)

#### `_applyDefaults()`
- Purpose: initialize `params` from schema defaults.
- Side effects: sets values in `this.params`.

#### `updateParams(newParams = {})`
- Purpose: runtime safe parameter update.
- Behavior:
  - validates known keys
  - coerces by declared type
  - applies numeric bounds
  - ignores invalid values
- Side effects:
  - mutates `this.params`.

#### `_coerceBoolean(v)` and `_coerceNumber(v, integer = false)`
- Purpose: internal type coercion helpers.

### 22.5 Signal Logic Methods (StrategySignalUtils)

#### `crossover(a, b, opts = {})`
- Purpose: detect upward cross.
- Input forms:
  - arrays (`[...values]`)
  - direct previous/current values.
- Duplicate guard:
  - uses bar-time keyed state to avoid repeated true on same bar.

#### `crossunder(a, b, opts = {})`
- Purpose: detect downward cross.

#### `above(a, b)` / `below(a, b)`
- Purpose: compare latest values.

#### `rising(series)` / `falling(series)`
- Purpose: slope direction check for latest 2 values.

#### `between(val, min, max, inclusive = true)`
- Purpose: range gate helper.

#### `pctChange(series)`
- Purpose: percent change between last two values.

### 22.6 Developer Robustness Methods (StrategyDevHelpers)

#### `resolveSymbol({ symbol, packet } = {})`
- Purpose: reliable symbol selection fallback chain.

#### `hasBars(symbol, n = 1)`
- Purpose: quick historical depth check.

#### `requireBars(symbol, n = 1, context = "requireBars")`
- Purpose: guard helper with debug logging.
- Returns: `true/false`.

#### `safeSeries(symbol, field = "close", fallback = [])`
- Purpose: non-throwing series access.

#### `oncePerBar(key, barTime)`
- Purpose: execute code once per bar/key.
- Returns: `true` only first time for that bar.

#### `describe(features = {})`
- Purpose: return metadata for UI/telemetry.

#### `safeRule(fn, fallback = null)`
- Purpose: protect strategy logic block from exceptions.
- Returns: result or fallback.

#### `logDecision(message, meta = {}, level = "info")`
- Purpose: standardized strategy decision logs.

#### `logSignal(signal, stage = "EMIT", level = "info")`
- Purpose: standardized signal trace logs.

#### `logGuard(name, passed, details = {})`
- Purpose: standardized guard pass/fail logs.

### 22.7 RuleChain Methods

#### `when(condition)`
- Sets current condition state.

#### `whenPos(state, symbol)`
- Condition based on current position side.

#### `whenCrossUp(a, b, key = "default")`
- Condition using crossover helper.

#### `whenCrossDown(a, b, key = "default")`
- Condition using crossunder helper.

#### Action methods
- `enterLong`, `enterShort`, `exitLong`, `exitShort`, `exitAll`, `flipToLong`, `flipToShort`.
- Behavior:
  - first matching action commits signal.
  - later actions in same chain are skipped.

#### Terminal methods
- `value()` / `end()` / `valueOf()`
- Returns committed signal or `null`.

### 22.8 Position Manager Methods (StrategyPositionManager)

#### `open(symbol, side, quantity, price)`
- Opens or adds to same-side position.
- If opposite side exists, old side is replaced.

#### `get(symbol)` / `all()`
- Read one/all positions.

#### `getState(symbol)`
- Returns `long|short|flat`.

#### `close(symbol, exitPrice)`
- Closes full symbol position and returns realized PnL.

#### `is(symbol, side)`
- Boolean side check.

#### `reset()`
- Clears all positions.

#### `applyDelta(symbol, quantityDelta, price)`
- Delta-based update utility:
  - positive delta increases long or reduces short.
  - negative delta increases short or reduces long.

---

## 23. Practical Interpretation Example

```js
next(data) {
  const symbol = this.resolveSymbol({ packet: data });   // symbol resolution
  if (!this.isWarmedUp(symbol)) return null;             // warmup gate
  if (!this.requireBars(symbol, 50, "ema")) return null; // data depth gate

  const closes = this.safeSeries(symbol, "close");       // safe series read
  const fast = this.indicators.EMA.calculate({ period: this.params.fastPeriod, values: closes });
  const slow = this.indicators.EMA.calculate({ period: this.params.slowPeriod, values: closes });
  if (fast.length < 2 || slow.length < 2) return null;   // indicator validity gate

  return this.safeRule(() =>
    this.rule(data)
      .whenPos("flat", symbol).whenCrossUp(fast, slow, "ema").enterLong({ symbol })
      .whenPos("long", symbol).whenCrossDown(fast, slow, "ema").exitLong({ symbol })
      .value()
  );
}
```

How to interpret this:
- It cannot trade before warmup and minimum bars.
- It only emits one action per evaluation call.
- It is resilient to transient runtime exceptions.
- Entry/exit semantics are explicit and adapter-friendly.
