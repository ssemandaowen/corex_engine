# Known issues and future hardening

This is the package-level handoff for APEX TRAIT LABS. It records accepted structural boundaries, known correctness debt and the evidence required before future changes are considered complete.

## Package closeout boundary

The strategy package owns strategy lifecycle, context, strategy parameters, per-runtime candle history, indicator implementations/registry, authoring metadata and validation helpers.

The host engine continues to own execution authority, broker/provider connections, risk, jobs/workers, database persistence, reports and runtime supervision. Do not move backtest orchestration or persistence into this package.

The package layout is intentionally modular:
- `src/ta.js` is the small strategy-facing helper facade (crossovers, extrema, rising/falling and change predicates).
- `src/indicators/<type>.js` contains one lazily loaded implementation per registered indicator.
- `src/indicators/core/` contains shared smoothing primitives.
- `src/kernel/` owns Frame normalisation, typed-array windows, CandleStore and numeric primitives.
- `src/params/` owns parameter collection, validation, resolution and patching.

Do not merge all 50 indicator implementations into `ta.js`. That would defeat lazy loading, isolate neither formula ownership nor versioning, and create a large shared failure surface. The current one-file-per-indicator structure is deliberate, not accidental fragmentation. Consolidate duplicated algorithms into shared cores only when parity tests prove equivalence.

## Correctness work intentionally deferred

The recorded full-series parity baseline has **20 known divergences** (three seeds, every overlapping ready bar, absolute tolerance `1e-9`):

`InstantTrend`, `Coppock`, `ADX`, `STC`, `TSI`, `RVI`, `FDI`, `ParabolicSAR`, `SuperTrend`, `LinearRegression`, `Fisher`, `LaguerreRSI`, `ConnorsRSI`, `OBV`, `CMF`, `EoM`, `Vortex`, `Choppiness`, `KAMA`, `Ichimoku`.

Specific future review points:
- KAMA seed alignment and strict 1e-9 drift.
- STC carry-forward behavior when the stochastic range is zero.
- RVGI formula: add the conventional SMA(10) signal and rename the period parameter to `signalPeriod` only after checking consumers.
- VIDYA: expose and apply `cmoPeriod` independently of the smoothing period.
- HMA: choose floor/round semantics for half-periods and document the choice.
- McGinley: clamp the denominator/input ratio to prevent pathological values.
- Ichimoku: component-specific readiness; review the lagging-span parameter name and compatibility impact before renaming it to `spanBPeriod`.
- CMF: define zero-range and zero-volume denominator behavior.
- TSI: define flat-series readiness/output behavior.

These are open consultation/fix items, not completed fixes. Each formula change must ship with its independent reference test, static metadata version bump and changelog entry. Keep one `test.failing` per known divergence until that specific reference passes; do not weaken tolerances or alter fixtures to reduce the count.

## Reference baseline and verification record — 2026-11-23

The reference baseline is complete as test evidence, not as production formula certification:

- Registry coverage: **50 types / 50 independent helpers / 50 reference test files**; no missing or extra entries.
- C2-only reference run: **40 suites / 134 tests passed**.
- Combined C1+C2 reference run: **50 suites / 161 tests passed**.
- Full-series comparison: **49 incremental types plus Fibonacci's static calculation**, across three deterministic seeds; **30 match / 20 diverge** at absolute tolerance `1e-9`; **0 execution errors**.
- The 20 current divergences are listed above and expanded with actual values/reasons in [DIVERGENCE.md](../test/reference/DIVERGENCE.md).
- C2's managed Kilo run exited before writing its final report. The completed artifacts were independently rerun and verified; see the workspace handoff report `.corex-handoff/reports/C2.md`. Do not attribute that independent verification to a successful Kilo process.
- These are reference/test results only. No production formula correction is claimed by the reference lanes.

The historical benchmark and memory figures below are retained as measured snapshots, not fresh release certification. Re-run them on the target machine before making current performance guarantees.

## Structural / integration debt

1. **Workspace aliases remain.** `Strategy.js` imports `@utils/logger` and `@config/constants`; `StrategyDataManager.js` and `StrategyRuntimeUtils.js` import `@config/constants`. Package manifest/Jest config also contains monorepo alias mappings. Future work should inject the logger at the host boundary and internalise only strategy-owned constants without changing engine behavior.
2. **Shared mathjs instance.** `Strategy.math` returns a shared mutable `mathjs` instance. Decide whether to remove it or expose a frozen, reviewed subset. Do not remove the dependency before checking strategy usage.
3. **Manifest dependency.** `StrategyManifest` reads the `technicalindicators` export surface to generate editor metadata. Confirm whether this editor catalogue remains a supported feature before replacing/removing the dependency.
4. **Temporary manager compatibility.** `IndicatorManager` retains a legacy dispatch path for indicator classes not yet migrated to the Frame/`BaseIndicator` contract. Remove it only after all 50 registry implementations are migrated and verified.
5. **Cost metadata.** Registry complexity labels are coarse and require algorithm-level review. A cost label is descriptive, not a performance guarantee.
6. **Security boundary.** Strategy code is not sandboxed by this package. Host scanner/module resolver limitations and worker validation gaps remain application-level security work.
7. **Tick/bar semantics.** The standard indicator pipeline is bar-close oriented. Raw tick hooks are supported, but tick-level indicator updates and stop logic based on `ctx.price` must remain explicitly distinguished.
8. **Parameter reconfiguration.** The BaseIndicator reconfigure/reseed contract has focused EMA-based coverage. Each migrated family must test its own period/source changes against a fresh instance.
9. **Standalone packaging.** The package is a CoreX workspace package, not yet a clean-room standalone npm package. Resolve host aliases and validate installation outside the monorepo before publishing it independently.

## Benchmark and memory evidence

The package contains an explicit bar-close dispatch benchmark at `bench/bar-close-benchmark.js`:
- 14 Frame-based indicators;
- 200,000 measured bars per path and 10,000 warmup bars;
- seven measured runs per path;
- Map-first/dense-first execution order alternates;
- explicit GC and GC observation;
- reports min/median/max, bars/second, GC count/duration and heap growth;
- compares the legacy Map-backed entries with compiled dense-instance dispatch.

**Recorded benchmark snapshot (prior run; not rerun during this package closeout):**
- Map median: 3,624.447 ms; minimum: 2,493.751 ms.
- Dense median: 3,023.138 ms; minimum: 2,039.707 ms.
- Dense/Map median ratio: 0.8341 (about 16.6% lower median elapsed time in this fixture).
- GC: Map 405 collections / 621.012 ms; dense 335 / 343.020 ms.

Treat this only as a historical dispatch microbenchmark. It is not a whole-engine, end-to-end, or indicator-algorithm speedup claim. The variance between runs is material; future performance work should retain raw samples, run on a documented machine/runtime, and compare identical validation, normalisation, history writes and checksums. **Do not claim 2.5x faster.**

The recorded warmed memory smoke used 100,000 warmup ticks plus 100,000 measured ticks and reported 9,768 bytes (0.009 MiB) retained heap growth, below the 2 MiB gate. Re-run on the target environment before using this as a release guarantee.

## Next package handoff

The strategy package boundary is documented for the next CoreX package implementation. Keep the backtesting package separate: it may consume strategy manifests, indicator APIs and strategy lifecycle contracts, but must not silently take ownership of strategy indicators or parameter validation.

The backtesting package's extraction scope, runtime/broker contracts, job ownership, persistence and report/artifact boundaries must follow its own approved design and roadmap tasks. Do not move `backtestManager` or database responsibilities merely to make package imports convenient.

## Closeout verification note

This document is a debt register, not a claim that every known issue is fixed. The package test suite and benchmark should be rerun from the current checkout before a release or merge. Any failure should be added here with the exact failing test/command and reproduction details rather than hidden by relaxing a gate.
