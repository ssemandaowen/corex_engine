# CoreX Strategy Guide

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
