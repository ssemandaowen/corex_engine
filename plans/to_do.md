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

### corex-strategy-engine extraction — AUDITED & COMPLETED
- [x] Gap analysis written: `plans/Audit/corex-strategy-engine-gap-analysis.md`
- [x] Deep audit report written: `plans/Audit/strategy-engine-deep-audit.md`
- [x] Package shell created: `packages/corex-strategy-engine/` with `Strategy.js`, `ContextBuilder.js`, `IndicatorManager.js`, `ParamSchema.js`, `ta.js`, `util.js`, `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`, `Position.js`, `StrategyIntrospection.js`
- [x] `ContextBuilder` implements zero-allocation per-tick ctx (50k ticks: 0.873 µs/tick, negative heap growth)
- [x] Shims created in `utils/strategy/` pointing to package: `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`, `StrategyIntrospection.js`, `Position.js`
- [x] `utils/DeclarativeStrategy.js` reduced to 4-line shim re-exporting from `corex-strategy-engine`
- [x] `utils/strategy/StrategyPluginRegistry.js` deleted (dead code — 0 DB strategies use it)
- [x] `@events` alias added to package `package.json` jest config + `_moduleAliases`
- [x] `corex-broker-contract` mapping added to package jest config for test imports
- [x] `StrategyValidator.js` — re-exports from `@utils/strategy/StrategyValidator` (full legacy validation logic)
- [x] `StrategyManifest.js` — re-exports from `@utils/strategy/StrategyManifest` + 12 `ctx.*` entries for Monaco intelligence
- [x] `ContextBuilder.test.js` created — tests persistent ctx, zero-allocation benchmark, ctx.go.* delegation
- [x] All 50 indicators implemented in `IndicatorRegistry.js` and audited line-by-line
- [x] `fdi.js` refactored to $O(period)$ length-based Fractal Dimension Index formula
- [x] `vidya.js` readiness flag check fixed (`>= period`)
- [x] `coppock.js` buffer property variable fixed (`_roc11Buffer`)
- [x] Package documentation created: `packages/corex-strategy-engine/README.md`
- [x] All 7 package test suites pass cleanly (66 unit tests total, 100% pass rate in 1.1s)

### Package Ownership Audit — COMPLETED
- [x] Produced `/plans/Audit/package-ownership.md` classifying repository modules into `KEEP`, `MOVE`, `SHIM`, `REPLACE`, `REMOVE`
- [x] Static import graph analysis completed across 264 JS files in `packages/`, `engine/`, `utils/`, `broker/`, `events/`, `config/`
- [x] Staged migration roadmap produced covering Phase 1 through Phase 4

## Next

### CoreX Staged Modularization — Phase 1 (Strategy Engine Internalization)
- [ ] Move `StrategyValidator.js`, `StrategyManifest.js`, `StrategyParamUtils.js` into `packages/corex-strategy-engine/src/validation/`
- [ ] Move `utils/security.js` into `packages/corex-strategy-engine/src/security.js`
- [ ] Retain 1-line re-export shims in `utils/strategy/` and `utils/` to preserve backwards compatibility
