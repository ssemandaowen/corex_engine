# Package 2: corex-market-data — Living Status

## What this package does
Multi-provider market data layer: abstract `DataProviderContract`, concrete
providers (TwelveData, Yahoo Finance, File), a factory for active-provider
selection, transparent pagination via `DataPaginationLayer`, unified
`DataProviderError` hierarchy, and the `MarketFeed` tick dispatcher that routes
real-time ticks to active runtimes.

## Extraction sources (existing files to move)
| Source | Destination | Notes |
|---|---|---|
| `engine/core/data/DataProviderContract.js` | `packages/corex-market-data/src/DataProviderContract.js` | Contract + error codes + stubs |
| `engine/core/data/providers/TwelveDataProvider.js` | `packages/corex-market-data/src/providers/TwelveDataProvider.js` | Add `SymbolNormalizer` at boundary |
| `broker/twelvedata.js` | `packages/corex-market-data/src/legacy/twelvedata.js` | Untouched business logic, re-export shim |
| `engine/core/backtestDataResolver.js` | `packages/corex-market-data/src/backtestDataResolver.js` | Unify errors, integrate DataPaginationLayer |
| `engine/core/runtime/MarketFeed.js` | `packages/corex-market-data/src/MarketFeed.js` | Rewire to factory, not legacy singleton |

New files:
- `packages/corex-market-data/src/DataProviderFactory.js`
- `packages/corex-market-data/src/providers/FileDataProvider.js`
- `packages/corex-market-data/src/providers/YahooFinanceProvider.js`

## Locked constraints (from Final Broker Contract + AGENTS.md)
1. Symbol normalization at source — every provider normalizes to canonical
   (uppercase, no separators, e.g. `EURUSD`) at its own boundary before
   emitting `EVENTS.MARKET.TICK`. Uses `SymbolNormalizer` from
   `corex-broker-contract`.
2. Internal pagination — CoreX's own 5000-candle ceiling (not a provider
   limit). `DataProviderFactory.fetchHistorical` wraps
   `DataPaginationLayer.fetchall` internally.
3. Single active provider — exactly one active provider in settings at a time.
4. Provider errors caught and logged only — never surfaced to user.
5. Paper data source assignable per session — live real-time feed OR file
   replay (tick-by-tick, real-time). Never touches MetaAPI/REST.
6. WebSocket-only real-time — push architecture, no polling in the broker
   layer. REST fallback stays in the provider layer only.
7. Human verification — TwelveData and Yahoo Finance providers need real API
   keys to verify; do not self-certify.

## Decisions (settled design answers)
1. **19:30 2026-08-20** Provider lifecycle: TwelveData singleton treated as shared
   resource behind idempotent `connect()`; factory does not own raw connections.
   Must test backtest→paper→live mode-switch race conditions.
2. **19:30 2026-08-20** Pagination: `DataProviderFactory.fetchHistorical` wraps
   `DataPaginationLayer.fetchall` by default; optional `max_candles` bypasses
   chunking for small warmup fetches.
3. **19:30 2026-08-20** Symbol normalization: at each provider boundary
   (`TwelveDataProvider`, `YahooFinanceProvider`, `FileDataProvider`), not
   centrally. No sink-side normalization in `MarketFeed`.
4. **19:30 2026-08-20** FileDataProvider config: structured object
   `{ type:"file", path:string, speed:number=1.0, loop:boolean=false,
   startOffset:datetime|null=null }`.
5. **19:30 2026-08-20** Error unification: extend `DataProviderError` with any
   needed codes to retire `backtestDataResolver`'s generic `Error("LIMIT_EXCEEDED")`
   and all untyped throws in the package.

## Checklist (mirrors GitHub Issue #2)
- [x] 1. Create `packages/corex-market-data/` with package.json (aliases: @data, @core/data legacy)
- [x] 2. Extract `DataProviderContract.js` — contract + `DataProviderError` (extended codes) + stubs
- [x] 3. Add `MAX_CANDLES_EXCEEDED` error code to `DataProviderError` (replaces generic LIMIT_EXCEEDED)
- [x] 4. Extract `twelvedata.js` (legacy) to `src/legacy/twelvedata.js`; add re-export shim at `broker/twelvedata.js`
- [x] 5. Extract `TwelveDataProvider.js` — add `SymbolNormalizer.normalize()` at boundary (spec #4)
- [x] 6. Extract `backtestDataResolver.js` — unify errors under `DataProviderError`, integrate `DataPaginationLayer`
- [x] 7. Build `DataProviderFactory.js` — wraps `DataPaginationLayer.fetchall` internally; optional `max_candles` bypass; single-active-provider enforcement
- [x] 8. Build `YahooFinanceProvider.js` — new provider with `DataProviderContract`, `SymbolNormalizer` at boundary
- [x] 9. Build `FileDataProvider.js` — file replay per decision #4; tick-by-tick real-time replay for paper mode
- [x] 10. Extract `MarketFeed.js` — rewire to factory, not legacy singleton
- [x] 11. Update `RuntimeLifecycle._warmup` (line 202) — use `DataProviderFactory` instead of `twelvedata.fetchHistory()`
- [x] 12. Update `engine.js` warmup cache (line 475) — use factory instead of `broker.fetchHistory()`
- [x] 13. Update `backtestManager.js` (line 406) — pass factory to `fetchGuardedHistory` instead of raw twelvedata singleton
- [x] 14. Wire `CoreXPaperDriver.dataSource` (Package 1) to route through assigned provider, including file-replay
- [x] 15. Write isolation tests for each new component
- [x] 16. Run `npm test` — 64 Package 2 tests pass; 294 total pass, 11 pre-existing failures
- [x] 17. Backward-compatible re-exports at original file locations
- [x] 18. Flag TwelveData + Yahoo Finance for human verification (real API keys)
- [x] 19. Append decision entry to `/plans/decisions.md`

## Status

**2026-08-20 23:08** — Package 2 implementation complete. Feature branch `feature/corex-market-data` has 3 commits:
1. Extract DataProviderContract with MAX_CANDLES_EXCEEDED error code
2. Extract legacy broker + providers with symbol normalization
3. Build DataProviderFactory, FileDataProvider, YahooFinanceProvider

All 6 test suites pass (64 tests). Integration points updated (RuntimeLifecycle, engine.js, backtestManager.js). CoreXPaperDriver.dataSource wired to FileDataProvider for paper-mode file replay.

Root suite: 294 passed, 11 failed (all pre-existing: MetaApiDriver live mode + security loop guards — not caused by this package).

Flagged for human verification: TwelveDataProvider (real Twelve Data API key + WebSocket) and YahooFinanceProvider (real Yahoo Finance API access).
