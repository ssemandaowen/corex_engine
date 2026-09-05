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

---

**2026-08-24** — Auth verifier injection pattern for Socket_X:

The previous implementation had a standalone `tokenVerifier.js` in `corex-broker-contract` with `resolveUserIdFromToken()` — a duplicate JWT verification path that could silently drift from `corex-auth`. This is the same risk class as the RiskGateway duplication fixed earlier.

**Decision:** Socket_X now uses dependency injection for auth verification, mirroring the RiskGateway pattern:
- `SocketXServer.setAuthVerifier(fn)` — injects the verifier at startup
- Engine wires the real `corex-auth` verifier in `_wireSocketX()`
- Safety check: test environment logs warning + uses fallback; production throws immediately
- Old `tokenVerifier.js` removed — no standalone JWT logic remains in `corex-broker-contract`
- Fallback verifier delegates to `corex-auth` (not a duplicate implementation)

**Reason:** Eliminates the duplicate auth path risk. The package now contains zero standalone JWT verification logic — only the injected verifier is used.

---

**2026-08-28** — Account model split-brain resolution: consolidate on `trading_accounts`, drop duplicate `accounts` table, prune dead connector schemas.

**Decision:** `trading_accounts` (corex-gateway, migration 025) is the single source of truth for account identity. The duplicate `accounts` table (corex-accounts, migration 026) is dropped.

**Reason:** Two parallel account tables existed with identical purpose. `trading_accounts` has a FK to `users`, a richer schema (label, broker_binding, status, timestamps), and is what `POST /accounts` actually writes to. The `accounts` table was empty in practice — nothing wrote to it except the unused `AccountsService.createAccount()` path. The `connections` table's FK pointed at the wrong (empty) table, causing `PUT /api/settings/connectors/:type` to 500 when saving connector settings for a real account.

**Changes:**
1. New migration `027_drop_accounts_repoint_connections.sql`: drops `accounts`, repoints `connections.account_id` FK to `trading_accounts.account_id`.
2. Deleted `packages/corex-accounts/src/accountsService.js` and its test file — the only consumer of the dropped table.
3. `engine/services/connectorSettingsService.js` shim updated to resolve accounts via `TradingAccountRepository` (corex-gateway) instead of the deleted `AccountsService`.
4. `CONNECTOR_SCHEMAS` in `connectionsService.js` pruned to `twelvedata` and `metaapi` only — `mt5_bridge` and `oanda` removed entirely (not commented out).

**Permanent prohibition:** `mt5_bridge` and `oanda` must NOT be re-added as live-selectable connector types under any circumstance. This is the second time they have been removed (first: 2026-08-23, re-added silently). `mt5_bridge` has zero real instantiation in the codebase — confirmed dead as a live execution path. This is a locked boundary, not a scope decision to revisit.

**Zero-diff verification:** `TradingAccountRepository.js`, `RuntimeRegistry.js`, `SignalProcessingEngine.js`, `SignalGenerationEngine.js`, and `SocketXServer.js` all have zero diff — the correct reference was left untouched.

---

**2026-08-30** — corex-auth extraction: task opened, discovery that it was already executed.

This task (extract `authService.js` + `secretsVault.js` to `packages/corex-auth/`) was assumed never executed per the 2026-08-21 decision. On investigation, it **was** completed in commit `cc86c34` (2026-08-22) "Package 3: Extract corex-auth package". No code changes were required — only verification and documentation.

**Discovery:**
- `packages/corex-auth/` exists with both source files, index.js, package.json, AGENTS.md, and 23 unit tests.
- Re-export shims at `engine/services/authService.js` and `engine/services/secretsVault.js` already point to the package.
- `@auth` alias already present in root `package.json`.
- Both source files are pure `node:crypto` — no imports from `engine/`, `pgStore`, or any Express/DB-coupled module. No cross-package reference needed.
- Restricted files (`pgStore.js`, `authGuard.js`, `authController.js`, `roleGuard.js`) have zero diff vs the extraction commit — confirmed untouched.

**Verification performed:**
- Auth unit tests: 23/23 pass.
- Shim round-trips (sign/verify token, hash/verify password, encrypt/decrypt) through `@core/services/` paths: all PASS.
- Full suite: 414 pass, 11 fail — only the 2 previously-confirmed pre-existing failures remain.
- All callers (`server.js`, `authController.js`, `authGuard.js`, `systemController.js`, `migrate.js`, `corex-accounts/connectionsService.js`, `configService.js`) work unchanged through the shim.

**Conclusion:** Extraction is complete and verified. No code changes made. See `plans/corex-auth-extraction-notes.md` for full discovery log.

---

**[2026-08-30 15:21] Feature: Scope getDefaultForUser and setDefault to (user, account type); require ?mode= on GET convenience route**

Decision: `getDefaultForUser(userId, accountType)` now requires `accountType` (no default). Throws if omitted or not `paper`/`live`. `setDefault` now scopes its `is_default = false` clear to `WHERE user_id = $1 AND type = <target's type>` so setting a live default cannot clobber a paper default. `InMemoryAccountRepository` mirrors both changes. The GET `/api/settings/connectors/:type` convenience route now reads `req.query.mode` and returns 400 `mode query param required (paper|live)` if missing/invalid, otherwise passes mode through as `accountType`.

Reason: Migration 029 corrected the data model so every user has at most one default per type (one paper, one live). The application code still assumed one default total per user — `getDefaultForUser(userId)` with no type was ambiguous when two valid defaults exist. The fix closes the remaining application-code half of the split-brain: reads and writes of `is_default` are now correctly scoped to `(user, type)`.

Consequence: Any caller that previously invoked `getDefaultForUser(userId)` without a type now throws — all such callers (the two convenience routes) were updated. Account-scoped routes (`/api/accounts/:accountId/connectors/:type`) were already accountId-based and required no change. Backfill from migration 029 already populated correct per-type defaults, so no new migration is needed.

---

**[2026-08-30 18:03] Phase 1 — Remove dead broker/oanda.js and broken broker/connectors/RestConnector.js**

Decision: Delete `broker/oanda.js` (53 lines, full OANDA WebSocket broker) and `broker/connectors/RestConnector.js` (broken shim requiring a non-existent path in `corex-broker-contract`). Both were already unplugged from `CONNECTOR_SCHEMAS` but never deleted. The locked prohibition against `mt5_bridge`/`oanda` as live-selectable connector types (decisions.md 2026-08-23) remains in force — this removal enforces it at the file level.

Reason: Previous sessions removed these from the connector schema but left the files on disk, creating drift between the documented prohibition and the actual codebase. Grep confirmed zero code imports either file before deletion.

Consequence: `@oanda/v20` npm dependency in package.json is now unused but left in place (harmless; removable in a separate cleanup). No code references removed files.

---

**[2026-08-30 18:12] Phase 2 — Invert MarketFeed.js reverse dependency on engine/**

Decision: `packages/corex-market-data/src/MarketFeed.js` no longer requires `@core/core/runtime/RuntimeRegistry` or `@core/core/engine` directly. Dependencies are injected at startup via `marketFeed.setDeps({ registry, onStrategyCrash })`, following the same pattern as `RiskGateway.setRiskEngine()` and `SocketXServer.setAuthVerifier()`. `engine/core/engine.js` wires `RuntimeRegistry` and `handleStrategyCrash` in `_wireSocketX()`. Test environment falls back to no-op stubs with a warning; production throws if not injected.

Reason: Every other package depends on engine/ one-directionally. MarketFeed was the exception — it reached back into engine/ for `RuntimeRegistry.forSymbol()` / `.get()` and `engine.handleStrategyCrash()`. The inversion makes the dependency explicit and matches the established injection pattern.

Consequence: `corex-market-data` now follows the same dependency rule as all other packages. The singleton export (`module.exports = new MarketFeed()`) is unchanged — `setDeps` is an instance method, not static.

---

**[2026-08-30 18:21] Phase 3 — Resolve brokerPersistenceService duplication**

Decision: `packages/corex-accounts/src/brokerPersistenceService.js` now holds the real, live implementation (using `pgStore.upsertBrokerSettingsForUser()` — the centralized data access path). The orphaned class-based stub with raw `pg` Pool SQL is gone. `engine/services/brokerPersistence.js` is now a re-export shim pointing at the package, preserving the `{ persistBrokerSettings }` function signature. `engine/routes/systemController.js` has zero diff.

Reason: Two parallel implementations existed: the live engine version (function-based, used `pgStore`) and an orphaned package stub (class-based, raw `pg` Pool, zero consumers). The package stub was stale and duplicated logic. Following the established shim pattern (authService, secretsVault, etc.), the package now owns the logic and engine re-exports it.

Consequence: `corex-accounts/index.js` exports `persistBrokerSettings` (function) instead of `BrokerPersistenceService` (class instance). No caller changes required.

---

**[2026-08-30 18:30] Phase 4 — Socket_X commands bypass SignalGenerationEngine/SignalExecutionEngine (intentional, locked)**

Decision: Socket_X BUY/SELL commands represent externally-submitted orders (from clients), not strategy-generated signals. They are NOT a bug or missing integration. The two order paths are intentionally separate:

1. **Strategy pipeline** (`runPipeline.js`): For strategy-generated signals. Flows through all three stages — `SignalGenerationEngine` (strategy's `next()`) → `SignalProcessingEngine` (risk/filter) → `SignalExecutionEngine` (queue) → `broker.execute()`.
2. **Socket_X direct path** (`RiskGateway.submit()`): For client-submitted commands. Routes through `broker.handle()` → `driver.submit()`. Only `SignalProcessingEngine` (via `SocketXRiskEngine`) is invoked — for portfolio risk validation (drawdown, position checks) only. Generation and execution engines are correctly bypassed.

Reason: Reading the code confirms this is intentional. `runPipeline.js:93-98` uses `broker.execute()` (the strategy pipeline's execution interface). `RiskGateway.js:128` uses `broker.handle()` (the direct command interface). These are distinct `BrokerContract` entry points for distinct order sources. Socket_X clients are external actors issuing orders directly — they do not need signal generation (the signal comes from the client) nor queue-based execution (the order is already validated and ready). They DO need portfolio-level risk enforcement, which `SignalProcessingEngine` provides via `SocketXRiskEngine`.

Consequence: Do not "fix" Socket_X orders flowing through `SignalGenerationEngine`/`SignalExecutionEngine`. Doing so would conflate two fundamentally different order sources and break the clean separation between internal strategy signals and external client commands.

---

**[2026-08-31 00:30] Fix: universal risk validator gate in BaseBroker.handle() — closes the live-strategy risk gap**

Decision: `BaseBroker.handle()` now invokes an injected, synchronous risk validator after `_passesRiskFloor()`. The validator is wired once at startup via `BaseBroker.setRiskValidator(fn)` in `engine/core/engine.js:_wireSocketX()`, using `SignalProcessingEngine.validateForCommand({ broker, intent, runtimeId })` — the exact same drawdown/position-conflict check Socket_X commands already get via `SocketXRiskEngine`. Live/paper strategy signals now pass through the identical risk gate.

**Fail-closed by default:** If no validator is injected, `handle()` rejects every order with `RISK_VALIDATOR_NOT_CONFIGURED`. This is the opposite of `_passesRiskFloor()`'s default-pass behavior and is intentional — an unconfigured risk gate must block trading, not allow it.

**Performance:** The validator is a synchronous function call reading only cached `broker.getEquity()` / `broker.getPositionSnapshot()` values (no Promises, no DB, no event bus). Measured at ~0.045ms per `handle()` call — negligible against the existing path.

**Scope:** `_passesRiskFloor()` is untouched and still runs as a first-pass backstop. `RuntimeRegistry.js`, `SocketXServer.js`, `RiskGateway.js`, `SocketXRiskEngine.js` all have zero diff — the Socket_X path is unchanged. Backtest mode gains a redundant second check (defense-in-depth, acceptable).

Reason: The risk-gap analysis (2026-08-30) confirmed live/paper strategy signals flowed `MarketFeed → broker.handle()` with only the weak `_passesRiskFloor()` check (which defaults to no-check when `riskFloor=0`), while Socket_X commands got the full `SignalProcessingEngine` drawdown + position-conflict gate. This closed the gap at the single convergence point (`BaseBroker.handle()`) so all order paths — current and future — inherit identical protection automatically.

Consequence: Any test or code path that constructs a broker without engine.js wiring must set a validator via `BaseBroker.setRiskValidator(fn)` or `handle()` will fail closed. Package-level tests (BaseBroker.test.js, socketx.test.js) set a permissive validator in `beforeEach`.

---

**[2026-09-05 11:30] Manual boot verification revealed four startup-blocking bugs not caught by tests**

Decision: Fixed four pre-existing shim/alias issues that prevented `npm start` from completing. None were caught by the test suite because jest's `moduleNameMapper` resolves aliases differently from `module-alias` at runtime.

1. **`engine/core/runtime/RuntimeBrokerFactory.js`** — relative path was `../../packages/...` (resolves to `engine/packages/...`); correct depth from `engine/core/runtime/` is `../../../packages/...`. Required depth is 3 levels up to reach project root.

2. **`packages/corex-market-data/src/MarketFeed.js`** — `require("../DataProviderFactory")` resolved to wrong directory; `DataProviderFactory.js` is a sibling, not a parent's child. Changed to `require("./DataProviderFactory")`.

3. **`packages/corex-gateway/src/socketx/RiskGateway.js`** — `require("@broker/RuntimeBrokerFactory")` works in jest (where `moduleNameMapper` maps it) but fails at runtime where `module-alias` only maps `@broker/*` to `./broker/*` (no `corex-gateway` subdirectory). Changed to relative path `../../../corex-broker-contract/src/RuntimeBrokerFactory`.

4. **`package.json _moduleAliases`** — was missing runtime mappings for extracted package names (`corex-accounts`, `corex-broker-contract`, `corex-market-data`, `corex-auth`, `corex-gateway`) and the specific `@broker/corex-gateway` / `@broker/corex-broker-contract` / `@broker/RuntimeBrokerFactory` overrides. Added all.

Reason: The unit test suite passed 428/439 throughout package extraction, but the server itself could not start — these bugs were invisible to jest. Manual boot verification (`npm start`) surfaced them immediately. This reinforces the rule that unit tests cannot reveal integration/wiring issues across package boundaries.

Consequence: All four fixes are purely path/alias changes with zero logic modification. After the fixes, `npm start` completes bootstrap successfully: migrations applied, all engine components wired (including the new `BaseBroker risk validator: SignalProcessingEngine (universal gate)`), strategies compiled and ACTIVE, server listening on port 3000. Test suite after fixes: 428 pass / 11 fail (same 2 pre-existing failures, no new regressions). The `_moduleAliases` entry must be kept in sync with the `jest.moduleNameMapper` entry in `package.json` going forward — these two configs are now coupled and must be updated together when adding a new package.

---

**[2026-09-05 12:10] Security fix: stop returning decrypted connector secrets in API responses**

Decision: Replaced the `getPublicConfig()` stub with a real implementation that returns `{ hasSecrets, maskedKeys, config }`. Both `GET /api/accounts/:accountId/connectors/:type` and `GET /api/settings/connectors/:type` now call `getPublicConfig()` instead of the raw `getConnectorConfig()`. The raw `getConnectorConfig()` is retained for internal server-side use only and is no longer returned in any HTTP response.

`getPublicConfig()` fetches the connection, decrypts the stored credentials, then masks them using `secretsVault.maskSecrets(secrets, CONNECTOR_SCHEMAS[type].secrets)` — passing the **connector-specific** secret field list (`["apiKey"]` for twelvedata, `["token"]` for metaapi) rather than the shallow `DEFAULT_SECRET_PATHS` from the global secrets vault config. The schema is the source of truth for which fields are secret, per connector type.

Reason: The settings-config audit (2026-09-05, `plans/settings-config-audit.md`, Findings 1-2) identified two real credential leaks: (1) the account-scoped GET route returned `{ config: {}, secrets }` with the secrets object containing raw decrypted API keys/tokens; (2) the convenience GET route and the list endpoint both had the same flaw. The masking infrastructure (`secretsVault.maskSecrets`) already existed and was used correctly by `GET /api/settings` (`systemController.js:476-491`) — this fix applies the same pattern to the connector routes.

Consequence: No frontend changes required — the response shape `{ hasSecrets, maskedKeys, config }` is the same shape the frontend `AccountView.tsx:139-140` was already expecting (and that the `getPublicConfig` stub was supposed to provide). The internal `getConnectorConfig()` is unchanged and still available for any future server-side connector driver that needs raw credentials. The write path (`saveConnectorConfig` / `PUT` route) is untouched — encryption and storage continue exactly as before. All masked values are the literal string `"<redacted>"`, not a partial redacted form like `sk-***` — chosen to match the existing `secretsVault.maskSecrets` behavior so a single masking utility is the source of truth.
