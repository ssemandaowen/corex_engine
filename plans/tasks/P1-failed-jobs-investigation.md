# P1 — Failed Jobs Investigation — Classify the 79 Failed corex_jobs

**Status:** COMPLETE  
**Priority:** P1 (investigation)  
**Source:** Provider Integration Verification findings — DB inspection showed `corex_jobs`: 48 succeeded, 79 failed, 1 cancelled  
**Repository:** `C:\Users\SBUM\Desktop\corex`  
**Branch:** Do not create a new branch unless required; preserve all existing uncommitted work

## Findings

All 79 failed jobs are `backtest.run` type, spanning Mar 2026 – Nov 2026 (~8 months).

| Error pattern | Count | Assessment |
|---|---|---|
| `VALIDATION_FAILED: Offline mode requires a valid file path or uploadId` | 21 | Config/UI issue — offline backtest without file |
| `No bars in selected range` | 13 | Symbol/timeframe has no data |
| `WORKER_STALE` | 11 | Worker lifecycle issue |
| `ENOENT: missing upload/backtest file` | 9 | Data file cleanup/missing |
| `DATA_UNAVAILABLE: Symbol 'EURUSD' not found (HTTP 404)` | 6 | Symbol format or provider not active at time |
| `No active data provider` | 2 | Provider not registered/active |
| `Strategy code rejected by security scanner` | 2 | B3 scanner blocking legacy imports |
| `dataForge.readFileSync(...).fromCSV is not a function` | 2 | dataForge API mismatch |
| `DATA_UNAVAILABLE: Symbol 'BTCUSD' not found (HTTP 404)` | 2 | Symbol format (no slash) |
| Other (Stringify, rule API, compile, DNS) | 4 | Misc |

- 77/79 exhausted both retry attempts (2/2)
- 2/79 used only 1/2 attempts
- All failures are `backtest.run` — no other job types failed

## Assessment

The failures are predominantly historical/configuration-related, not a current systemic defect:
- 21/79 (27%) are offline-mode validation failures — user configuration, not system
- 13/79 (16%) are "no bars in range" — symbol/data availability
- 9/79 (11%) are missing files — data lifecycle cleanup
- 8/79 (10%) are provider/symbol issues — some may be resolved by Twelve Data being active now (our live verification showed EUR/USD and BTC/USD work)
- 11/79 (14%) are WORKER_STALE — worker lifecycle, worth monitoring

**Recommendation:** No immediate fix required. The failures are largely historical and configuration-driven. Monitor WORKER_STALE and "no active data provider" as potential current issues.

## Evidence

Read-only DB queries against `corex_jobs` table: status distribution, failed-by-type, failed-by-error-pattern, time range, attempts distribution, sample failed jobs. No user IDs, connection strings, or secrets exposed.
