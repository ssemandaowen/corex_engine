# CoreX Architectural Decisions Log

This file is a running log of locked architectural decisions. New entries are appended (never overwrite past reasoning).

---

**2026-08-20** — Broker contract went through multiple design revisions during this session (symbol normalization scope, account-state ownership, native paper broker, data-source flexibility). This Issue (#1) now reflects the final locked version. Going forward, any time a locked architectural decision here is later changed, append a new dated entry to this file explaining what changed and why — never silently overwrite past reasoning, append to the log.

Key locked decisions for broker layer:
1. BrokerContract = unified async interface: submit/modify/cancel/query_status. Standardized payload (Symbol, Volume, OrderType, StopLoss, TakeProfit) in, standardized OrderResult out.
2. Strategy code is mode-agnostic — same strategy runs against any BrokerContract-implementing driver.
3. Drivers: BacktestDriver, CoreXPaperDriver (native sandbox ledger), MetaApiDriver, RestDriver (MQL5 bridge). Each declares supports_trading + supports_streaming_data. Unsupported operations throw typed UnsupportedOperationError.
4. Global symbol normalization: canonical schema (uppercase, no separators, e.g. EURUSD) with pip_scale/digits metadata. Every driver AND every data source normalizes at its boundary.
5. CoreXPaperDriver owns local virtual ledger; shares fill-sim module with BacktestDriver (one implementation).
6. Paper data source assignable per session: live real-time feed OR file replay. Never touches MetaAPI/REST.
7. Account state ownership is mode-specific: Live queries external broker; Paper/Backtest use CoreX local ledger. Each session has its own isolated instance.
8. Historical data provider: one active provider at a time in settings. Internal pagination auto-chunks to fulfill 5000-candle blocks. Errors caught/logged, never surfaced.
9. Backtest fill simulation (shared with paper): market orders fill at next-candle-open; limit/stop fill if bar range crossed trigger; spread/commission applied to bid/ask series.
10. Live mode: strict push via WebSocket. Polling wrapped internally to emit pushed events.
11. REST/MQL5 driver: execution/order-routing only. Never carries market data.
12. Market Data ownership: all ticks route through central Market Data manager. Drivers never serve pricing directly to strategy code.
13. Session scoped to (mode, symbol, driver). Same symbol cannot run two drivers simultaneously — enforced at session creation by RuntimeBrokerFactory.

---

**2026-08-20** — MetaApiDriver async/sync fix: connector methods `getPositionSnapshot` and `getEquity` are async (REST/WebSocket), but were called synchronously in MetaApiDriver, causing them to always return null/0 (Promises, not resolved values). Fixed by adding `_cachedEquity`/`_cachedPositions`/`_cachedAccount` fields; `initialize()` calls new `refreshState()` to fetch initial broker state asynchronously; synchronous getters (`getEquity`, `getPosition`, `getPositionSnapshot`, `getAccount`) return cached values. Push events (`onFill`, `onBar`, `onTick`) update the cache. Live mode `setCash`/`setInitialCash`/`resetAccount` return `false` (broker owns ledger — spec #7). MetaApiConnector remains a skeleton stub — needs real credentials for end-to-end verification (spec #16).

---

**2026-08-20** — Package 2 (corex-market-data) design decisions:
1. Provider lifecycle: TwelveData singleton treated as shared resource behind idempotent `connect()`; factory does not own raw connections. Must test backtest→paper→live mode-switch race conditions.
2. Pagination: `DataProviderFactory.fetchHistorical` wraps `DataPaginationLayer.fetchall` by default; optional `max_candles` bypasses chunking for small warmup fetches.
3. Symbol normalization: at each provider boundary (TwelveDataProvider, YahooFinanceProvider, FileDataProvider), not centrally. No sink-side normalization in MarketFeed.
4. FileDataProvider config: structured object `{ type:"file", path:string, speed:number=1.0, loop:boolean=false, startOffset:datetime|null=null }`.
5. Error unification: extend `DataProviderError` with `MAX_CANDLES_EXCEEDED` to retire `backtestDataResolver`'s generic `Error("LIMIT_EXCEEDED")` and all untyped throws in the package.

---

**2026-08-20** — Package 2 (corex-market-data) completed implementation:
- Extracted DataProviderContract, TwelveDataProvider, backtestDataResolver, MarketFeed, twelvedata singleton to `packages/corex-market-data/`
- TwelveDataProvider normalizes symbols at boundary via SymbolNormalizer (wraps singleton's _normalize + fetchLatestPrice)
- DataProviderFactory: idempotent connect, single active provider, transparent DataPaginationLayer chunking with max_candles bypass
- FileDataProvider: CSV/JSON/JSONL parsing, tick-by-tick replay, supports {type:"file", path, speed, loop, startOffset}
- YahooFinanceProvider: new provider (needs real Yahoo API keys for verification)
- CoreXPaperDriver.dataSource wired to FileDataProvider for paper-mode file replay (lazy require to avoid circular dep)
- Integration points updated: RuntimeLifecycle._warmup, engine.js warmup cache, backtestManager._fetchFromBroker
- Root package.json updated with @data alias
- 64 tests pass; 294 total pass, 11 pre-existing failures (MetaApiDriver live mode + security guards)

---

**2026-08-21** — YahooFinanceProvider rewritten to use `yahoo-finance2` v4 npm package (per user instruction).
- Replaced raw fetch to query1.finance.yahoo.com with `yahoo-finance2` YahooFinance instance
- Provider uses lazy-loaded YahooFinance (require on first connect) with injected `yahooImpl` for testing
- API key auto-read from process.env.YAHOO_API_KEY (optional — yahoo-finance2 uses crumb auth by default)
- Error mapping: 404→SYMBOL_NOT_FOUND, 429/rate-limit→RATE_LIMITED, others→PROVIDER_UNAVAILABLE
- 21 tests pass using injected mock (no real API calls)
- Sample integration tests added: FileDataProvider loads real files from data/sample/
- 70 total Package 2 tests pass across 6 suites

---

**2026-08-21** — Auth simplification (Package 3 pre-work):

1. JWT TTL extended from 12 hours to 30 days (`authService.js:5`) — enables "stay logged in" like Gemini without refresh token complexity. Revocation still works via `corex_sessions` table check on every request.
2. API key system removed from auth flow:
   - Removed `/apikeys` routes (GET/POST/DELETE) from `authController.js`
   - Removed API key issuance from signin (`rememberMe`/`issueAuthKey` block)
   - Removed API key auth path from `authGuard.js` (simplified to JWT-only)
   - Removed unused `readApiKey` function and API key cache
   - Kept `pgStore` API key methods and `user_api_keys` table (no destructive DB changes — protected boundary)
3. Rationale: API keys are unnecessary complexity for a solo-dev system where the web UI is the primary interface. Single JWT path is cleaner, easier to maintain, and sufficient for the use case.

---

**2026-08-21** — Server package split analysis (Package 3 scope decision):

Existing packages (corex-broker-contract, corex-market-data) are **pure-logic** — no Express.js, no PostgreSQL. They extract trading/broker logic and data provider logic respectively, with re-export shims in `engine/`.

Auth is fundamentally different: `authService.js` (97 lines) and `secretsVault.js` (413 lines) are pure crypto (Node.js `crypto` only) — extractable. But `pgStore.js` (767 lines), `authGuard.js` (233 lines), `authController.js` (344 lines), `roleGuard.js`, and `connectorSettingsService.js` (275 lines) are all tightly coupled to Express middleware + PostgreSQL queries. The `authGuard` middleware protects ALL engine routes in `server.js` — it cannot function without the server context.

**Decision**: Follow the existing Package 1/2 pattern — extract only the two pure-logic files (authService, secretsVault) to `packages/corex-auth/`. Keep DB/Express-coupled code (pgStore auth methods, authGuard, authController) in `engine/` with re-export shims. Do NOT create a separate server package — this would be a fundamentally different scope from the existing pure-logic packages and add unnecessary complexity. See `plans/server-split-analysis.md` for full analysis.
