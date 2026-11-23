# Indicator catalogue and status

The default registry currently exposes **50 types**. The one-file-per-indicator layout is deliberate: each implementation has its own recurrence, readiness and output contract and is lazy-loaded by the registry.

## Catalogue

| Family | Registered types |
|---|---|
| Moving averages / smoothing | SMA, EMA, WMA, HMA, McGinley, ALMA, KAMA, VIDYA, SuperSmoother |
| Volatility / range / channel | ATR, StandardDeviation, BollingerBands, KeltnerChannels, DonchianChannels, ZScore, Choppiness |
| Momentum / oscillators | RSI, CMO, TSI, MACD, ROC, Momentum, WilliamsR, Stochastic, CCI, Coppock, STC, RVI, ConnorsRSI, LaguerreRSI, Fisher, UltimateOscillator |
| Trend / direction | ADX, ParabolicSAR, SuperTrend, Vortex, Ichimoku, InstantTrend, LinearRegression, DPO, Hurst, FDI |
| Volume / flow | VWAP, AnchoredVWAP, OBV, MFI, CMF, AD, EoM |
| Levels | Fibonacci |

## Registry contract

Each entry exposes:

- canonical type name;
- zero or more aliases;
- complexity label (`O(1)` or `O(n)`);
- implementation metadata version.

The registry lazy-loads the implementation. `listTypes()` and `listMetadata()` do not require callers to eagerly import every implementation. Unknown types throw `UnknownIndicatorError`.

Complexity metadata is descriptive. It is not a substitute for benchmarking or mathematical parity tests.

## Output contract

Frame-based indicators receive a reusable Frame. Their `value` and `prev` are `NaN` before readiness, with `ready === false`. Multi-output indicators expose their documented component properties; consumers should check readiness before reading them.

## Current correctness gate

The authoritative parity suite is `test/characterisation/full-parity.test.js`:

- 49 incremental registry types are fed bar-by-bar;
- Fibonacci's static calculation is checked on each bar;
- every overlapping ready output is compared against a separately implemented reference at absolute tolerance `1e-9`;
- three deterministic seeds exercise trend, flat/zero-volume and zero-range/zero-volume cases;
- multi-output indicators compare their component outputs as well as the primary value.

Current baseline: **30 match / 20 known divergences**. The 20 expected failures are individual `test.failing` cases and are listed in `test/characterisation/known-broken.json`. Do not reduce the baseline by changing fixtures or loosening tolerance. Fix the formula/readiness/seed convention, prove parity, then convert that specific test to a normal passing test.

See [Known issues](KNOWN_ISSUES.md) and [DIVERGENCE.md](../test/reference/DIVERGENCE.md) for the exact outstanding types and explanations.
