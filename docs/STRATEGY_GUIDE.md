# CoreX Strategy Guide

For full syntax/API details, see `docs/STRATEGY_SYNTAX_REFERENCE.md`.


This guide explains how to build strategies that run in **backtest**, **paper**, and **live** modes using the same signal output.

## 1) File Location and Naming
- Put strategies in `strategies/`.
- File name must match the class name (by convention) and is used as the strategy ID.
- Example: `strategies/ema_crossover.js` defines `EmaCrossover`.

## 2) Base Structure
All strategies extend `BaseStrategy` and implement `next()`.

```js
"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

class MyStrategy extends BaseStrategy {
  constructor() {
    super({
      name: "my_strategy",
      symbols: ["BTC/USD"],
      lookback: 60,
      timeframe: "1m"
    });

    this.schema = {
      fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
      slowPeriod: { type: "integer", min: 5, max: 400, default: 26 },
      quantity: { type: "integer", min: 1, max: 100000, default: 1 }
    };
    this._applyDefaults();
  }

  next(data) {
    const symbol = data.symbol || this.symbols[0];
    if (!this.isWarmedUp(symbol)) return null;

    // strategy logic...
    return null;
  }
}

module.exports = MyStrategy;
```

## 3) Inputs and Warmup
- `symbols` is required.
- `lookback` controls how many bars are needed before signals are allowed.
- `isWarmedUp(symbol)` ensures enough data exists before generating signals.

## 4) Signal Contract
Strategies return **signals**; execution is handled by `SignalAdapter`.
A signal is a plain object with:

Required:
- `intent`: `ENTER` or `EXIT`
- `side`: `long` or `short`
- `symbol`
- `strategyId`

Auto-filled by BaseStrategy helpers:
- `price`, `timestamp`, `barTime`, `tf`

You should use the built-in helpers to keep output consistent:
- `entryLong()`, `entryShort()`, `exitLong()`, `exitShort()`, `exitAll()`
- `flipToLong()`, `flipToShort()` for flip-on-next-bar logic

## 5) Recommended Pattern (Rule Chain)
`BaseStrategy` provides a fluent rule chain that avoids duplicate signal emits. This is **one** pattern, not a requirement. Use whatever logic makes sense (trend, mean reversion, breakouts, time filters, risk stops).

```js
const qty = this.params.quantity || 1;

return this.rule(data)
  .whenPos("flat", symbol).when(crossUp).enterLong({ symbol, quantity: qty })
  .whenPos("long", symbol).when(crossDown).flipToShort({ symbol, quantity: qty })
  .whenPos("flat", symbol).when(crossDown).enterShort({ symbol, quantity: qty })
  .whenPos("short", symbol).when(crossUp).flipToLong({ symbol, quantity: qty })
  .value();
```

### 5.1) Alternative Patterns (Not Crossovers)
You can express any logic. Here are a few minimal examples:

**Mean Reversion**
```js
const price = data.close ?? data.price;
const sma = this.indicators.SMA.calculate({ period: 20, values: closes }).at(-1);
const z = (price - sma) / (this.math.std(closes.slice(-20)) || 1);

return this.rule(data)
  .whenPos("flat", symbol).when(z < -2).enterLong({ symbol, quantity: qty })
  .whenPos("long", symbol).when(z > 0).exitLong({ symbol })
  .value();
```

**Breakout**
```js
const high = Math.max(...closes.slice(-20));
const low = Math.min(...closes.slice(-20));
const price = data.close ?? data.price;

return this.rule(data)
  .whenPos("flat", symbol).when(price > high).enterLong({ symbol, quantity: qty })
  .whenPos("flat", symbol).when(price < low).enterShort({ symbol, quantity: qty })
  .value();
```

**Time Filter + Trend**
```js
const hour = new Date(data.time).getUTCHours();
const trendUp = fast.at(-1) > slow.at(-1);

return this.rule(data)
  .when(hour >= 12 && hour <= 20).when(trendUp).whenPos("flat", symbol)
  .enterLong({ symbol, quantity: qty })
  .value();
```

## 6) Position State
`BaseStrategy` exposes `positions` and `pos()`:
- `this.positions.get(symbol)` gives current position info
- `this.pos("long", symbol)` checks if you are long

The position manager is shared with paper broker logic, so you’re using the same position model across backtest/paper/live.

## 7) Parameters (Schema)
Define `schema` to enable UI editing and runtime parameter tuning:

```js
this.schema = {
  fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
  slowPeriod: { type: "integer", min: 5, max: 400, default: 26 },
  quantity: { type: "integer", min: 1, max: 100000, default: 1 }
};
this._applyDefaults();
```

At runtime, params are updated via API:
- `PATCH /run/params/:id`

## 8) Modes
You do not change your strategy per mode. The engine routes signals to the active mode:
- **Backtest**: executes through grademark
- **Paper**: executes through `PaperBroker`
- **Live**: executes through broker interface (future)

## 8.2 Backtest API Usage (Clear + DRY)
The backtest endpoint consumes a single, consistent payload shape. These values drive the run:

Required:
- `symbol` + `interval` (if no dataset upload or uploadId)

Core parameters (always applied):
- `initialCapital`: starting capital for performance + equity.
- `rangeMode`: `points` or `dates`.
- `rangePoints` or `rangeStart`/`rangeEnd`: data range selector.
- `includeTrades`: include trade list in report.
- `params`: strategy parameters (JSON string).

Note: `outputsize` is derived from `rangePoints` in points mode to avoid duplication.

### Example: points-based range (latest N bars)
```bash
curl -X POST http://localhost:3000/api/backtest/ema_crossover \
  -H "Authorization: Bearer <token>" \
  -F "symbol=BTC/USD" \
  -F "interval=1m" \
  -F "initialCapital=10000" \
  -F "rangeMode=points" \
  -F "rangePoints=1500" \
  -F "includeTrades=true" \
  -F "params={\"fastPeriod\":12,\"slowPeriod\":26}"
```

### Example: date range (filter after load)
```bash
curl -X POST http://localhost:3000/api/backtest/ema_crossover \
  -H "Authorization: Bearer <token>" \
  -F "symbol=BTC/USD" \
  -F "interval=15m" \
  -F "initialCapital=25000" \
  -F "rangeMode=dates" \
  -F "rangeStart=2025-01-01T00:00" \
  -F "rangeEnd=2025-02-01T00:00" \
  -F "includeTrades=true"
```

Notes:
- `initialCapital` always drives performance calculations.
- `rangePoints` is used as the fetch size in points mode.
- If `rangeMode=dates` yields zero bars, the API returns `No bars in selected range.`

### 8.1) Broker Account Clarity (Paper vs Live)
- Paper account endpoints:
  - `GET /api/system/account/paper/balance`
  - `GET /api/system/account/paper/settings`
  - `PATCH /api/system/account/paper/settings`
  - `POST /api/system/account/paper/reset`
- Live account endpoints:
  - `GET /api/system/account/live/balance`
  - `GET /api/system/account/live/settings`
  - `PATCH /api/system/account/live/settings`
  - `POST /api/system/account/live/reset`
- Run-mode settings (global execution defaults):
  - `GET /api/system/run/settings`
  - `PATCH /api/system/run/settings`

This keeps strategy code mode-agnostic while account and risk configuration stay explicit at the system layer.
## 9) Debugging
- Keep strategy logic pure and side-effect free.
- Use `this.log.info()` for optional logs.
- If a strategy errors, it’s moved to `ERROR` state.

## 10) Checklist
- `symbols` defined
- `lookback` set
- `schema` defined (if you want params in UI)
- uses `entryLong/entryShort/exit*` helpers (or returns a valid signal object)
- returns a signal or `null`

---

If you want, I can add a template generator so new strategies are created with this structure automatically.


