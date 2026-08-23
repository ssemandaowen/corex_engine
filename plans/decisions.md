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

---

**2026-08-22** — Target architecture defined (modular monolith roadmap):

Before further extraction, defined target architecture to avoid "organized piles without a plan." Core decisions:

1. **Engine becomes thin composition root** — `engine/` owns only HTTP/WebSocket I/O, wiring, lifecycle. No business logic.
2. **7 target packages** — strategy-engine, execution, portfolio, jobs, risk, notifications, settings (see `plans/target-architecture.md` for full map).
3. **Event-driven communication** — Packages communicate via `@events/bus`, not direct imports. Loose coupling = add features without touching existing code.
4. **Leaf-first extraction order** — Extract packages with no dependents first, work up the dependency tree.
5. **Professional rebuild, not fixing** — We are NOT fixing old monolith tests. We are rebuilding toward a clear target. Old tests testing package internals will be deleted, replaced by integration tests.

Open decisions flagged for Owen: event bus granularity, DB access pattern, frontend coupling, migration approach, testing strategy.

**Next step**: Extract `corex-strategy-engine` — the core trading logic package.

---

**2026-08-23** — Socket_X account model + operational fixes added to `corex-broker-contract`:

1. **Account model** — New `Account` model with structured IDs (`cx_pap_<ulid>` / `cx_liv_<ulid>`). Mode is resolved server-side from the account record — client cannot assert mode anywhere in the protocol.
2. **Connection roles** — Controller (exclusive, can trade) and observer (read-only, receives SNAPSHOT, max 5 per account). Observers cannot submit trading commands.
3. **HELLO revision** — Client sends `{ accountId, role }` instead of `mode`. Server resolves account type from accountId via DB lookup.
4. **ACK event** — Emitted immediately when command passes validation and is handed to RiskGateway, before broker responds. Gives client instant receipt distinct from FILL.
5. **FILL.originalMessageId** — Added so clients can deterministically map async fills back to triggering commands.
6. **BROKER_UNAUTHORIZED** — Broker auth failures emit REJECT but keep the connection open and retain controller claim. `ACCOUNT_DEGRADED` reserved for future use.
7. **Idempotency fix** — Moved from per-connection to per-runtimeId (persists across reconnects).
8. **Risk gateway fix** — Changed from `broker.submit()` to `broker.handle()` to enforce risk floor + margin guardrails.
9. **Migration** — New `trading_accounts` table in `db/migrations/025_trading_accounts.sql`.
10. **Tests** — 210 tests pass across 12 suites.

---

**2026-08-23** — Socket_X protocol layer added to `corex-broker-contract`:

1. **New architecture** — Socket_X is a protocol boundary that sits **above** BrokerContract, not a replacement for it. The stack is: External clients → Socket_X → Risk Gateway → BrokerContract → Adapter (Paper or Live). See `plans/socket_x arch.txt` for the topology diagram.
2. **5 non-negotiable policy rules** enforced at the Socket_X layer:
   - Idempotency: duplicate `messageId` rejected with `DUPLICATE_COMMAND`
   - Exclusivity: one connection per `runtimeId`; second gets `SESSION_CONFLICT`
   - Rate limiting: token-bucket per connection; over-limit gets `RATE_LIMITED`
   - Mode-agnostic: Paper and Live share identical protocol behavior
   - Risk gate enforcement: every command passes through RiskGateway before BrokerContract
3. **Components** — `MessageEnvelope.js` (schema + validation + factory methods), `SocketXConnection.js` (per-connection state), `SocketXServer.js` (connection lifecycle + handshake), `RiskGateway.js` (policy enforcement).
4. **RestDriver deprecated** — the REST/MQL5 driver is no longer useful given the new Socket_X architecture. It remains in the codebase but is no longer referenced as a primary path.
5. **Tests** — 181 tests pass (11 suites). Socket_X verified against mock brokers; real WebSocket transport integration not yet end-to-end verified.

---

**2026-08-23** — RestDriver and RestConnector removed from `corex-broker-contract`:

The REST/MQL5 driver and its connector were deprecated when Socket_X was introduced. Removed:
- `src/drivers/RestDriver.js` — deleted
- `src/connectors/RestConnector.js` — deleted
- `src/RuntimeBrokerFactory.js` — removed REST/MT5/MQL5 from DRIVER_REGISTRY, removed REST switch case, simplified `_resolveDriverType` to always return METAAPI for LIVE mode
- `index.js` — removed exports
- `test/connectors.test.js` — removed RestConnector test block
- `test/factory.test.js` — removed RestDriver test
- `engine/services/connectorSettingsService.js` — removed `oanda` connector reference
- `AGENTS.md` — removed REST references

The package now has exactly 3 drivers: Backtest, Paper (CoreX), Live (MetaApi). Socket_X supersedes the old REST path.

---

**2026-08-23** — Socket_X envelope schema finalized:

- `schemaVersion`: "1.0" (only supported version)
- Required fields: `messageId`, `runtimeId`, `mode` (paper|live), `type` (command|event), `payload` (object), `timestamp` (ISO8601)
- Command actions: BUY, SELL, MODIFY, CANCEL, HELLO
- Event types: HELLO_ACK, SNAPSHOT, PING, PONG, FILL, REJECT, POSITION_UPDATE
- Reason codes: RISK_LIMIT_EXCEEDED, INVALID_SYMBOL, DUPLICATE_COMMAND, BROKER_ERROR, RATE_LIMITED, SESSION_CONFLICT, INVALID_ENVELOPE, UNAUTHORIZED
