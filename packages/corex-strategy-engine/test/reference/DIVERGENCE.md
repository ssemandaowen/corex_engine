# Indicator Reference Divergence Report

Status: **50/50 registry types rechecked; 30 match and 20 diverge at 1e-9 tolerance. The full-series harness covers 49 incremental types bar-by-bar plus Fibonacci's per-bar static calculation across three seeds.**

This report merges the C1 and C2 independent references. It does not change production indicator code and does not decide whether a differing convention is acceptable.

## Reproduction

Harness: `test/characterisation/full-parity.test.js` (49 incremental types, every ready bar, plus Fibonacci per bar, 3 seeds).

Fixture contains 64 bars:
- close[i] = 100 + 0.35i + 2 sin(0.71i) + 0.8 cos(0.19i)
- open[i] = close[i] − 0.25 + 0.2 sin(0.31i)
- high[i] = max(close[i], open[i]) + 0.7 + 0.1(i mod 3)
- low[i] = min(close[i], open[i]) − 0.6 − 0.1(i mod 4)
- volume[i] = 1000 + 137(i mod 7) + 3i

The full-series harness feeds all 49 incremental registry types bar-by-bar and compares every overlapping ready output at absolute tolerance 1e-9 across: (1) deterministic trending data, (2) flat/zero-volume data, and (3) data containing zero-range and zero-volume segments. Ichimoku compares Tenkan, Kijun, Senkou A/B, Chikou and cloud bounds; MACD, Bollinger, Keltner, Donchian and Stochastic compare their companion outputs. Fibonacci is checked on every bar as a static calculation. DPO remains the C1 control.

Measured output:
- Registry types compared: **50**
- Matches: **30**
- Divergences: **20**
- Execution errors: **0**

## Confirmed / material divergences

| Type | Production result | Reference result | Delta | Source-level explanation |
|---|---:|---:|---:|---|
| InstantTrend | 0 | 122.5839438294591 | −122.5839438294591 | Production uses undefined `this._alpha`; recursive result becomes NaN/0 and then remains stuck at zero after initialization. |
| Coppock | 81.261438307064 | 8.929667187966748 | +72.33177111909725 | Production sums a rolling single ROC stream; Coppock is WMA(10) of ROC(14)+ROC(11). |
| ADX | 42.5437337486607 | 41.75659491819413 | +0.7871388304665672 | Production TR uses current close instead of previous close and uses rolling/simple smoothing rather than Wilder-smoothed TR/+DM/−DM and ADX. |
| STC | 0.03474351102017948 | 93.84011035762848 | −93.8053668466083 | Production is a price-envelope/average-difference oscillator; it does not implement the double-stochastic MACD Schaff Trend Cycle. |
| TSI | not ready on flat series | 0 | — | On a flat, zero-momentum series, the reference becomes ready with a zero TSI value after warmup; production never becomes ready because the zero denominator path is not defined. |
| RVI | 0.16829620467754014 | 0.11886696812847931 | +0.049429236549060826 | Production uses close-to-close change and candle body against absolute close change; selected Relative Vigor Index uses weighted OHLC body/range and weighted signal. |
| FDI | −0.19897784671578997 | 1.5179335264855665 | −1.7169113732013563 | Production uses a custom box-counting expression that can produce negative values; selected Sevcik estimator is constrained to [1,2]. |
| ParabolicSAR | 119.2208954365 | 118.13485294531837 | +1.0860424911816295 | Production chooses initial direction from close<=low on the first bar and only clamps against one prior extreme; selected Wilder convention infers direction from the first two closes and clamps against the prior two bars. Initialization convention must be settled explicitly. |
| SuperTrend | 125.10883918150564 | 117.36062557458884 | +7.748213606916806 | Production begins with zero final bands/supertrend and derives first direction from that uninitialized state; selected reference seeds final bands and initial direction at the first ATR-ready bar. |
| LinearRegression | 117.19168974189088 | 123.67257320992482 | −6.480883468033937 | Production's value is the regression intercept at x=0; selected Linear Regression Curve value is the fitted point at the newest x. Production exposes slope separately. |
| Fisher | 0.5986376725424046 | 0.8581334401395428 | −0.2594957675971382 | Production feeds prior Fisher output into normalization and omits the second recursive Fisher smoothing term; selected Ehlers form smooths normalized x and Fisher output separately. |
| LaguerreRSI | 50.742801914589776 | 97.1455377987245 | −46.40273588413473 | Production's L0 recurrence uses prior L3, and output uses (L0−L3)/(|L0|+|L3|); selected Laguerre RSI uses the four-stage recurrence and CU/CD sums across adjacent stages. |
| ConnorsRSI | 63.447771531663086 | 61.51958848993888 | +1.9281830417242034 | Production averages streak RSI with RSI of a change-based ROC stream; selected Connors RSI averages price RSI, streak RSI and percent-rank of one-bar ROC. |
| OBV | 17943 | 16943 | +1000 | Production seeds the first value with first-bar volume and takes absolute volume; selected reference starts at zero and ignores non-positive volume. The measured difference is a constant first-bar baseline offset on this positive-volume fixture; subsequent directional increments agree. |
| CMF | NaN | 0.17423337557837956 | NaN | On a zero-range/zero-volume segment, production emits NaN while the reference carries a finite CMF value. Edge-case divergence requires explicit zero-denominator semantics. |
| EoM | −0.21095159228708393 | 9.51353207281905 | −9.724483665106135 | Production computes boxMove × scale / volume but omits multiplication by the current high-low box range. It also lacks a non-positive-volume guard. |
| Vortex | 0.5776141839570756 | 1.2587669535893529 | −0.6811527696322772 | Production uses abs(high−previousHigh) and abs(previousLow−low), and TR uses current close; Vortex movement uses cross-extreme distances and TR uses previous close. |
| Choppiness | −14.17627060897804 | 27.903525966883436 | −42.07979657586148 | Production negates the logarithmic expression and sums only period−1 TR transitions. The conventional formula is positive 100×log(sumTR/range)/log(period), with a defined period window. |
| KAMA | 121.23988317646132 | 121.23988315766793 | +1.8793386402649048e−8 | Strictly outside the 1e-9 parity gate, but the discrepancy is small compared with other divergences. Check arithmetic/seed alignment before treating it as a formula defect. |
| Ichimoku cloud bounds | upper=0, lower=0 | upper=121.74702301551446, lower=121.30086902380464 | −121.74702301551446 / −121.30086902380464 | Tenkan, Kijun, Senkou A/B and Chikou match. Production only populates cloud bounds when buffer length >= conversionPeriod+basePeriod, but the buffer is capped at laggingPeriod; with (3,5,7,2), 3+5>7 so bounds remain zero forever. Readiness should be based on the actual required components. |

## Types matching the selected reference on this fixture

All matched within 1e-9:
`SMA`, `EMA`, `WMA`, `StandardDeviation`, `MACD`, `ROC`, `Momentum`, `WilliamsR`, `UltimateOscillator`, `CCI`, `CMO`, `BollingerBands`, `KeltnerChannels`, `DonchianChannels`, `Stochastic`, `VWAP`, `AnchoredVWAP`, `MFI`, `AD`, `Hurst`, `ZScore`, `DPO`, `Fibonacci`, `SuperSmoother`, `ATR`, `RSI`, `VIDYA`, `McGinley`, `ALMA`, `HMA`.

DPO control matched: production −1.7300002754401476 vs reference −1.730000275440176 (delta +2.84e−14).

## Third-party and manual verification

- `technicalindicators` is used as a third opinion in tests for 17 types: EMA, RSI, ATR, CCI, Coppock, MACD, OBV, ParabolicSAR, ROC, SMA, StandardDeviation, Stochastic, VWAP, WMA, WilliamsR, ADX and BollingerBands.
- Five matching references were also hand-checked from small worked examples in `test/characterisation/hand-verified-references.test.js`: SMA(3), EMA(3), WMA(3), ATR(2) and RSI(3). Each test records the manual arithmetic and checks both the independent reference and production output.

## Variant and edge-case qualifications

- Parabolic SAR, SuperTrend and Fisher have implementation variants; the selected definitions and seed rules are recorded in C1/C2 reference headers. The current production outputs are not numerically equivalent to those selected definitions on the fixture.
- KAMA remains outside the strict 1e-9 parity gate on the full-series harness; resolve seed alignment and arithmetic drift in H1.
- OBV's +1000 is the first-bar seed convention, not a directional increment mismatch. Decide whether absolute baseline parity is required.
- VWAP and Anchored VWAP matched on positive volumes. Their all-zero-volume flat fixture has no ready output in either implementation, so the harness records it as a no-data segment rather than treating it as a numeric mismatch. Production uses absolute volume while the reference ignores non-positive volume.
- The earlier one-fixture scan reported 22 divergences. The newer full-series three-seed harness reclassified four of those as matching and exposed CMF's zero-volume edge divergence plus TSI's flat-series readiness gap, leaving 20 current failures. This is not a universal proof for all parameter boundaries or malformed inputs.

## Migration gate

H1-H5 must not merely move code into BaseIndicator/Frame. Each of the 20 remaining divergences must be corrected in the same lane as its reference-backed tests, or be explicitly documented as an intentional variant with a reproducible rationale. VIDYA, McGinley, ALMA and HMA currently pass these three fixtures; the separate requested parameter/edge hardening (VIDYA cmoPeriod, McGinley clamp, HMA rounding convention) remains in the H-lane task list. Do not change the selected reference to make production pass. No owner decisions are made by this report.
