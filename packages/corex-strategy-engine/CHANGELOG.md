# Changelog

## 2026-11-23 — Strategy package closeout and next-package handoff

- Finalised the package documentation map for lifecycle, API, architecture, indicators, benchmark methodology and known issues.
- Clarified that `ta.js` is the small strategy-facing helper facade; indicator implementations remain separate for lazy loading, formula ownership and independent versioning.
- Recorded the 50-type full-series parity baseline and the 20 outstanding divergence cases for future indicator agents.
- Recorded independent reference coverage (50 helpers / 50 tests; C2 40 suites / 134 tests; combined C1+C2 50 suites / 161 tests) and clarified that the failed Kilo C2 process was followed by a separate successful verification.
- Recorded the historical 14-indicator / 200,000-bar / seven-run dispatch benchmark and warmed memory-smoke result, explicitly as microbenchmark evidence rather than an end-to-end speedup claim.
- Documented workspace-alias, mutable mathjs, legacy indicator dispatch, cost-metadata, standalone-packaging and tick/bar semantic debt.
- No indicator formula corrections or backtesting-package extraction are claimed by this closeout.
