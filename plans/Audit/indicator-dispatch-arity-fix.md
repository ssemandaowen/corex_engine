# Indicator Dispatch Arity Mismatch — Fix Report

**Date:** 2026-09-30
**Branch:** `fix/indicator-dispatch-arity`
**Scope:** Fix `IndicatorManager` live dispatch-arity mismatches, add a startup safeguard, and remove two duplicated constants. No indicator math was changed.

---

## 1. The Bug Class

`IndicatorManager.updateIndicators()` dispatches every indicator's live per-tick update through a
fixed set of argument shapes keyed by the indicator module's `static updateMode`. Each module also
declares its real `update()` signature. When those two disagree, the dispatcher calls `update()`
with the wrong fields — passing `undefined` where the body does arithmetic on the value — and the
indicator silently produces `NaN` or wrong numbers on every tick. No error is raised anywhere.

`reseed()` / warm-up was **not** affected: each module's own `reseed()` reads fields directly off
candle objects. That is why live values and reseeded values disagreed.

`packages/corex-strategy-engine/test/Indicators.test.js` could not catch this: it calls
`update()` / `reseed()` directly with hand-supplied, correct arguments, never going through the
manager's dispatch. This task adds `test/IndicatorDispatch.test.js`, which drives the real
`updateIndicators()` path with real packet objects.

## 2. Dispatch Modes (final table)

| mode | dispatches | arity | indicators |
|---|---|---|---|
| `single` | `update(value)` (value resolved from `def.source`) | 1 | most |
| `hl` | `update(high, low)` | 2 | Fibonacci |
| `volume` | `update(close, volume)` | 2 | VWAP, AnchoredVWAP, OBV |
| `multi` | `update(high, low, close)` | 3 | ATR, SuperTrend, Stochastic, ADX, Ichimoku, … |
| `hlv` | `update(high, low, volume)` | 3 | **EoM** (new mode) |
| `mfi` | `update(typicalPrice, typicalPrice * volume, volume)` | 3 | **MFI** (new mode) |
| `rvi` | `update(close, open, high, low)` | 4 | RVI |
| `hlcv` | `update(high, low, close, volume)` | 4 | **AD, CMF** (new mode) |

`CANDLE_DISPATCH_MODES` (modes whose `reseed()` consumes full candles rather than a flat value
series) is now a single exported set, so a newly added mode cannot silently skip the candle branch
in `reseedIndicators()`.

## 3. Systematic Arity Check — Full Results

Method: for every class in `globalIndicatorRegistry`, compare `static updateMode` (defaulting to
`single`) against `prototype.update.length` using the arity table above.

### 3.1 Before this fix — 7 mismatches across 50 indicators

| Indicator | Declared mode | `update()` arity | Actual signature | Live effect |
|---|---|---|---|---|
| **EoM** | `volume` (2) | 3 | `update(high, low, volume)` | `high=close, low=volume, volume=undefined` → `emv = boxMove * scale / undefined` → **`NaN` every tick** |
| **AD** | `volume` (2) | 4 | `update(high, low, close, volume)` | `close`/`volume` land as `undefined` → **`NaN` every tick** |
| **CMF** | `volume` (2) | 4 | `update(high, low, close, volume)` | same as AD → **`NaN` every tick** |
| **BollingerBands** | `multi` (3) | 1 | `update(price)` | `price` received `high`, ignoring `def.source` → bands computed off the wrong field |
| **ParabolicSAR** | `single` (1) | 3 | `update(high, low, close)` | `low`/`close` `undefined` → **`NaN` every tick** |
| **MFI** | `volume` (2) | 3 | `update(typicalPrice, moneyFlow, volume)` | `moneyFlow` received raw `volume`, `volume` `undefined` → wrong money-flow, no raw volume |
| **Fibonacci** | `single` (1) | n/a | **no `update()` method at all** | `instance.update(val)` → **`TypeError: instance.update is not a function` thrown into the live tick** |

Of these, EoM / AD / CMF / BollingerBands are the mismatches introduced when `updateMode` was
duplicated out of `IndicatorManager`'s central `MULTI_ARG_INDICATORS` / `VOLUME_INDICATORS` sets
into the individual modules. **ParabolicSAR, MFI and Fibonacci are pre-existing** — they were
already mis-tagged under the old central sets and are only being fixed here because they are the
same bug class and would otherwise immediately trip the new startup assertion.

### 3.2 After this fix — 0 mismatches across 50 indicators

```
total indicators: 50
mismatches: 0
unknown mode: 0
no declared mode: 0
```

### 3.3 Same-arity ambiguity (`multi` vs `hlv`, both 3 args) — manual inspection

Arity alone cannot distinguish `update(high, low, close)` from `update(high, low, volume)`. Every
3-argument indicator was inspected manually:

`ParabolicSAR, SuperTrend, WilliamsR, UltimateOscillator, KeltnerChannels, DonchianChannels,
Stochastic, ADX, Vortex, Choppiness, Ichimoku, ATR` — all declare `update(high, low, close)` and
are tagged `multi`. **Correct, high confidence.**

`EoM` declares `update(high, low, volume)` and is now tagged `hlv`. **Correct, high confidence**
(the `volume` argument is a genuine third parameter, not `close`).

## 4. Permanent Safeguard

`IndicatorManager.initialize()` now calls `_assertDispatchArity(type, updateMode, Cls)` for every
indicator of every strategy, before instantiation, and **throws** when:

- `updateMode` is not one of the eight known modes;
- the class has no `update()` method to dispatch to;
- `update.length` does not match the declared mode's arity.

The check runs once per indicator per strategy load — not on the tick path — so a future
mismatch fails loudly at strategy load instead of silently corrupting live values. The error
message names the indicator type, the declared mode, and both arities.

`test/IndicatorDispatch.test.js` proves all three throw paths with deliberately broken fake
classes, and includes a sweep asserting every registered indicator satisfies its declared mode.

## 5. Also Fixed Here (unrelated but adjacent)

- `StrategyValidator` re-typed the lookback ceiling `100000` three times. The constant is now
  `MAX_ALLOWED_LOOKBACK`, exported from `Strategy.js` and imported by the validator, so validation
  and enforcement cannot drift apart.
- `RuntimeRegistry`'s plot interval was `Number(process.env.COREX_WS_PLOT_INTERVAL_MS || 2000)`
  evaluated on every registration. `0`, a negative value, or a non-numeric string degraded into a
  ~1 ms loop per runtime. It is now a module-level `Math.max(1000, Number(... || 2000))`, matching
  the existing `broadcaster.js` convention and resolved once at load.

---

## 6. Open Decision for Owen: SuperTrend multiplier default — NOT changed

`supertrend.js` declares `resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 10), Number(indDef.multiplier || 3)]`.

Before the `IndicatorManager` refactor, a single shared helper in `IndicatorManager._resolveParams`
computed `const multiplier = Number(indDef.multiplier || 2)` and used it for `SUPERTREND`,
`BOLLINGERBANDS` and `KELTNERCHANNELS`. When that value was duplicated into each module, SuperTrend
was written with a default of `3` while its two siblings kept `2`.

**This was deliberately left untouched in this task.** There is a genuine argument each way and it
is not an agent's call:

- Keeping `3` matches the common TradingView SuperTrend default and the module's own constructor
  default `constructor(period = 10, multiplier = 3)`.
- Reverting to `2` preserves the exact behaviour live/backtest results were produced with before
  the refactor.

Changing it either way silently alters live and historical backtest outputs. **Decision required
from Owen**: is SuperTrend's default multiplier `2` (behaviour-preserving) or `3` (TradingView
convention)? Whichever is chosen should live in one shared default so the three multiplier
indicators cannot diverge again.

## 7. Related Open Items (not fixed here)

- The dead `rp ? ... : (indDef.period ?? N)` fallback duplicated across ~30 indicator modules is
  unreachable through `IndicatorManager` (which always passes the resolver) and is left for a
  separate follow-up.
- `stoch.js`, `tsi.js` and `connors_rsi.js` do not accept the `rp` resolver, so `period` /
  `periodKey` no longer reach their first constructor argument (they previously fell through to the
  old shared `[period]` default). Unrelated to arity; tracked separately.