# CoreX — Active Task Tracking

## Done

### Socket_X Protocol Layer — corex-broker-contract
- [x] MessageEnvelope.js — schema validation + factory methods (including ACK, FILL.originalMessageId)
- [x] SocketXConnection.js — per-connection state
- [x] RiskGateway.js — routes through broker.handle() for risk enforcement
- [x] SocketXServer.js — connection lifecycle, handshake, exclusivity, observer role
- [x] Account model (Account, AccountId, TradingAccountRepository, InMemoryAccountRepository)
- [x] Structured account IDs: cx_pap_<ulid> / cx_liv_<ulid>
- [x] Connection roles: controller (exclusive) + observer (read-only)
- [x] HELLO revised: client sends { accountId, role }, server resolves mode
- [x] ACK event for immediate command receipt
- [x] FILL.originalMessageId for deterministic mapping
- [x] BROKER_UNAUTHORIZED handling (connection stays open)
- [x] Migration: db/migrations/025_trading_accounts.sql (applied)
- [x] TradingAccountRepository tested against real Postgres (28 tests pass)

### Socket_X Blockers — RESOLVED
- [x] **Portfolio-level risk enforcement** — `RiskGateway.setRiskEngine(SocketXRiskEngine)` injects `SignalProcessingEngine` for full portfolio risk checks
- [x] **Account ownership verification** — `_handleHello` validates authToken via injected verifier and verifies `accountId.userId === authResult.userId`
- [x] **Account CRUD endpoints** — `createAccountRouter()` with POST/GET/PATCH endpoints
- [x] **Auth verifier injection** — `SocketXServer.setAuthVerifier()` eliminates duplicate auth path; old `tokenVerifier.js` removed

### Package 2 (corex-market-data)
- [x] Merged to main — 70 tests, 6 suites

### Auth simplification
- [x] JWT TTL 30 days, API key system removed, 300 tests pass

## Next

### corex-gateway extraction — COMPLETED
- [x] Socket_X protocol + Account model + REST controller moved to `packages/corex-gateway/`
- [x] Engine wiring updated to import SocketXServer/RiskGateway via `@broker/corex-gateway`
- [x] Commit 31c1faf pushed to `origin/main`

### Symbol-Level Runtime Exclusivity
- [x] Enforced symbol-level exclusivity per account+mode at the session coordinator layer (`RuntimeLifecycle`, `RuntimeRegistry`, `RuntimeBrokerFactory`)
- [x] Verified all 4 test scenarios (different strategies same symbol/account/mode rejected, different timeframes rejected, different accounts succeed, different modes succeed) in `test/runtimeExclusivity.test.js`

### corex-portfolio extraction — COMPLETED
- [x] Extracted tradeHistoryService.js to packages/corex-portfolio/ with account_id scoping
- [x] Migration 031 adds nullable account_id to orders + order_fills, indexed, FK to trading_accounts
- [x] getHistoryReport supports both accountId-based and legacy userId+environment queries
- [x] Order-insertion call sites updated: systemController.js, mt5Controller.js, mt5Bridge.js
- [x] engine/services/tradeHistoryService.js re-export shim preserves singleton shape
- [x] 7 new tests pass; analytics regression verified
- [x] Full suite: 439 pass, 11 pre-existing failures unchanged

### corex-accounts extraction — COMPLETED
- [x] Package structure, services, migrations, and re-export shims implemented
- [x] Tests verified: multiple accounts per user, independent connection credentials
- [x] No forbidden files touched

### corex-strategy-engine extraction — COMPLETED (in progress — shims + stubs)
- [x] Gap analysis written: `plans/Audit/corex-strategy-engine-gap-analysis.md`
- [x] Package shell created: `packages/corex-strategy-engine/` with `Strategy.js`, `ContextBuilder.js`, `IndicatorManager.js`, `ParamSchema.js`, `ta.js`, `util.js`, `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`, `Position.js`, `StrategyIntrospection.js`
- [x] `ContextBuilder` implements zero-allocation per-tick ctx (50k ticks: 0.873 µs/tick, negative heap growth)
- [x] Shims created in `utils/strategy/` pointing to package: `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`, `StrategyIntrospection.js`, `Position.js`
- [x] `utils/DeclarativeStrategy.js` reduced to 4-line shim re-exporting from `corex-strategy-engine`
- [x] `utils/strategy/StrategyPluginRegistry.js` deleted (dead code — 0 DB strategies use it)
- [x] `@events` alias added to package `package.json` jest config + `_moduleAliases`
- [x] `corex-broker-contract` mapping added to package jest config for test imports
- [x] `StrategyValidator.js` — re-exports from `@utils/strategy/StrategyValidator` (full legacy validation logic)
- [x] `StrategyManifest.js` — re-exports from `@utils/strategy/StrategyManifest` + 12 `ctx.*` entries for Monaco intelligence (ctx.go.*, ctx.flat, ctx.ta, ctx.util, ctx.indicators, ctx.position, ctx.params, ctx.state, ctx.price, ctx.barTime)
- [x] `ContextBuilder.test.js` created — tests persistent ctx, zero-allocation benchmark, ctx.go.* delegation
- [x] All 8 package test suites pass (ContextBuilder, Indicators, ParamSchema, PluggableRegistry, Position, Strategy, ta, util) — 67 tests total
- [x] Position.add() optimized to O(1) incremental aggregate maintenance — 50k benchmark runs in ~398ms (well under 1s)
- [x] factory.test.js session-exclusivity test updated to match Phase 3 per-account-per-mode-per-symbol scoping design (supersession classified and documented)
- [x] Broader suite: `round7.comprehensive.test.js` shows 3 pre-existing failures (KNOWN_ISSUES.md documented), 55 pass — no new regressions
- [x] Phase C: Indicator Registry implemented — `IndicatorRegistry.js` with `globalIndicatorRegistry`
- [x] Indicators implemented: SMA, EMA, ATR, RSI, WMA, HMA, McGinley, ALMA, KAMA, VIDYA, ParabolicSAR, SuperTrend, LinearRegressionCurve, StandardDeviation, MACD, ROC, Momentum, WilliamsR, UltimateOscillator, CCI, TSI, CMO, STC, FisherTransform, LaguerreRSI, RVI, ConnorsRSI, BollingerBands, KeltnerChannels, DonchianChannels, Stochastic, VWAP, AnchoredVWAP, OBV, MFI, CMF, AD, EoM, ADX, Vortex, Choppiness, Hurst, FDI, ZScore, DPO, CoppockCurve, Fibonacci, InstantaneousTrendline, SuperSmoother, IchimokuCloud
- [x] `IndicatorManager.js` refactored to use `globalIndicatorRegistry` instead of if/else chain and `@utils/strategy/IncrementalIndicators`
- [x] Indicators exported from package `index.js`
- [x] `Indicators.test.js` created with 40+ tests covering all indicators
- [next] Wire `engine/` to import from `corex-strategy-engine` for strategy loading path

### Legacy deletion branch (`chore/legacy-deletion`) — COMPLETED
- [x] Step 0: Boot fix — `engine/services/tradeHistoryService.js` alias `@portfolio/corex-portfolio` → `corex-portfolio` (the `@portfolio/*` alias exists only in Jest moduleNameMapper, not in `package.json _moduleAliases`); added `test/bootSmoke.test.js` (commit 4b61e26)
- [x] Step 1: Deleted orphan `broker/backtest/SignalGenerationEngine.js`, `broker/backtest/BacktestFeed.js`, and dangling `@strategies` alias (commit 4a94d18)
- [x] Step 2: Deleted `utils/strategy/StrategyManifest.js` + `utils/strategy/StrategyValidator.js` shims; rewired `engine/routes/strategyController.js`, `scripts/sync-strategy-manifest.js`, `scripts/validate-strategy.js` to `corex-strategy-engine` (commit 39b9f5b)
- [x] Step 3: Moved `engine/core/strategy/StrategyContract.js` into `packages/corex-strategy-engine/src/`; repointed 6 engine consumers; added `StrategyContractOwnership.test.js` (commit 2b951b7)
- [x] Step 4: Made `corex-strategy-engine` self-contained — `Strategy.js`/`ParamSchema.js` now import package-local `StrategyStateStore`/`StrategyDataManager`/`StrategyParamUtils`; rewired `engine/services/strategyCompiler.js`, `test/SoACandleStore.test.js` (commit 5c68400)
- [x] Phase 1 DB evidence: read-only audit (`scripts/phase1-db-audit.js`) confirmed dev `corex_engine` DB has 0 rows extending/requiring BaseStrategy, 0 using DeclarativeStrategy, 0 legacy `next` definitions, 0 legacy metadata keys. Evidence: `plans/Audit/db-legacy-strategy-evidence.md`. GATE PASSED for audited environment; OPEN DECISION recorded for external environments (commit 3793776)
- [x] Deleted `test/round7.comprehensive.test.js` (legacy test depending on BaseStrategy internals)
- [x] Step 5: BaseStrategy cascade — deleted `utils/BaseStrategy.js`, `utils/DeclarativeStrategy.js`, `utils/strategy/RuleChain.js`, `utils/strategy/IncrementalIndicators.js`; removed RuleChain export from `utils/strategy/index.js`; rewrote `test/runtimeExclusivity.test.js`, `test/DeclarativeStrategy.test.js`, `test/IncrementalIndicators.test.js`, `scripts/bench/engine-micro-bench.js` onto `corex-strategy-engine` `Strategy` and package indicators; security scanner now allows `corex-strategy-engine` and blocks legacy `BaseStrategy` allowlist; updated stale comments in `strategyCompiler.js`/`RuntimeRegistry.js`/`RuntimeLifecycle.js` (commit 7c709df)
- [x] Full suite green after cascade: 52 suites, 521 tests passed
- [next] Open PR into `main` (do not merge)
- [next] Owen to confirm external environments contain no legacy `script_body` before deploying (OPEN DECISION in `plans/Audit/db-legacy-strategy-evidence.md`)
- [next] Out of scope (separate decisions): `packages/corex-broker-contract/src/base/BaseBroker.js:6` still imports `@utils/strategy/StrategyPositionManager` (domain leakage); remaining `utils/strategy/` files (Position, StrategyDataManager, StrategyPositionManager, StrategySignalUtils, StrategyDevHelpers, StrategyParamUtils, StrategyRuntimeUtils, StrategyStateStore, StrategyIntrospection, IndicatorAdapter, SoACandleStore, index.js) are still consumed by BaseBroker and must not be deleted yet


