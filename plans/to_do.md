# CoreX — Active Task Tracking

> Status board lives in `plans/STATUS.md`. This file tracks completed work and the real remaining backlog.

## Done

### Socket_X Protocol Layer — corex-broker-contract / corex-gateway
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
- [x] Portfolio-level risk enforcement — `RiskGateway.setRiskEngine(SocketXRiskEngine)` injects `SignalProcessingEngine`
- [x] Account ownership verification — `_handleHello` validates authToken via injected verifier
- [x] Account CRUD endpoints — `createAccountRouter()` with POST/GET/PATCH
- [x] Auth verifier injection — `SocketXServer.setAuthVerifier()`; old `tokenVerifier.js` removed
- [x] Socket_X + Account model + REST controller moved to `packages/corex-gateway/`; engine wiring via `@broker/corex-gateway` (commit 31c1faf)

### Package extractions (merged to main)
- [x] corex-market-data — 70 tests, 6 suites
- [x] corex-portfolio — tradeHistoryService.js extracted with account_id scoping; migration 031; 7 new tests; analytics regression verified
- [x] corex-accounts — package structure, services, migrations, re-export shims; multiple accounts per user, independent connection credentials
- [x] corex-auth — JWT TTL 30 days, API key system removed, 300 tests pass

### Symbol-Level Runtime Exclusivity
- [x] Enforced symbol-level exclusivity per account+mode at the session coordinator layer (`RuntimeLifecycle`, `RuntimeRegistry`, `RuntimeBrokerFactory`)
- [x] Verified all 4 test scenarios in `test/runtimeExclusivity.test.js`

### corex-strategy-engine extraction — COMPLETED
- [x] Gap analysis: `plans/Audit/corex-strategy-engine-gap-analysis.md`
- [x] Package shell: `Strategy.js`, `ContextBuilder.js`, `IndicatorManager.js`, `ParamSchema.js`, `ta.js`, `util.js`, `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`, `Position.js`, `StrategyIntrospection.js`
- [x] `ContextBuilder` zero-allocation per-tick ctx (50k ticks: 0.873 µs/tick, negative heap growth)
- [x] `utils/strategy/StrategyPluginRegistry.js` deleted (dead code — 0 DB strategies use it)
- [x] `@events` alias added to package jest config + `_moduleAliases`; `corex-broker-contract` mapping added for test imports
- [x] `ContextBuilder.test.js` — persistent ctx, zero-allocation benchmark, ctx.go.* delegation
- [x] All 8 package test suites pass (ContextBuilder, Indicators, ParamSchema, PluggableRegistry, Position, Strategy, ta, util) — 67 tests total
- [x] Position.add() O(1) incremental aggregate maintenance — 50k benchmark ~398ms
- [x] factory.test.js session-exclusivity test updated to Phase 3 per-account-per-mode-per-symbol scoping
- [x] Phase C: Indicator Registry — `IndicatorRegistry.js` with `globalIndicatorRegistry`; 41 indicators implemented and exported from package `index.js`; `Indicators.test.js` with 40+ tests
- [x] `IndicatorManager.js` uses `globalIndicatorRegistry` instead of if/else chain

### Legacy deletion (`chore/legacy-deletion`, PR #16 — OPEN, do not merge)
- [x] Step 0: Boot fix — `engine/services/tradeHistoryService.js` alias `@portfolio/corex-portfolio` → `corex-portfolio`; added `test/bootSmoke.test.js` (4b61e26)
- [x] Step 1: Deleted orphan `broker/backtest/SignalGenerationEngine.js`, `broker/backtest/BacktestFeed.js`, dangling `@strategies` alias (4a94d18)
- [x] Step 2: Deleted `utils/strategy/StrategyManifest.js` + `utils/strategy/StrategyValidator.js` shims; rewired 3 consumers (39b9f5b)
- [x] Step 3: Moved `engine/core/strategy/StrategyContract.js` into `packages/corex-strategy-engine/src/`; repointed 6 consumers; ownership test (2b951b7)
- [x] Step 4: Made `corex-strategy-engine` self-contained — package-local `StrategyStateStore`/`StrategyDataManager`/`StrategyParamUtils` (5c68400)
- [x] Phase 1 DB evidence: read-only audit (`scripts/phase1-db-audit.js`) — dev `corex_engine` DB has 0 legacy `script_body` rows. Evidence: `plans/Audit/db-legacy-strategy-evidence.md` (3793776)
- [x] Deleted `test/round7.comprehensive.test.js`
- [x] Step 5: BaseStrategy cascade — deleted `utils/BaseStrategy.js`, `utils/DeclarativeStrategy.js`, `utils/strategy/RuleChain.js`, `utils/strategy/IncrementalIndicators.js`; migrated consumers to `corex-strategy-engine` `Strategy` and package indicators; security scanner allows `corex-strategy-engine`, blocks legacy `BaseStrategy` (7c709df)
- [x] Full suite green after cascade: 52 suites, 521 tests passed

## Next (real remaining backlog)

### (a) Position/Order shared-type ownership — needs Owen decision
`packages/corex-broker-contract/src/base/BaseBroker.js:6` imports `@utils/strategy/StrategyPositionManager` (domain leakage). Decide whether the shared Position/Order/Signal types move to a shared package or stay in `corex-strategy-engine` with `corex-broker-contract` depending on it. Blocked on Owen — not for unattended agents.

### (b) corex-risk consolidation — needs Owen decision
Issue #4. Touches risk enforcement, a protected boundary. Held for Owen/Kilo Code.

### (c) Broadcaster extraction — needs Owen decision
Issue #7. 787 lines, tied to the frontend event contract. Held for Owen/Kilo Code.

### (d) corex-jobs and the stuck-in-queued bug — ready
Issue #8. J9 investigates the job-queue lifecycle (enqueue → pick up → run → complete/fail) and reproduces the most likely cause with a failing test.

### (e) Engine kernel/boot/runtime design — needs Owen decision
Issue #9. Design comparison with ChatGPT pending. Held for Owen/Kilo Code.

### (f) Frontend modularization — needs Owen decision
Issue #10. Held for Owen/Kilo Code.

### (g) External-environment legacy-strategy confirmation — needs Owen decision
PR #16's gate: dev DB proven clean (0 legacy `script_body` rows), but other environments cannot be proven absent. Owen to confirm before deploying `chore/legacy-deletion`. See `plans/Audit/db-legacy-strategy-evidence.md`.

## Stale GitHub issues (created 2026-08-18) — do not edit the issues themselves
- #5 (corex-strategy-engine) is **complete** — package extracted and self-contained; the issue was never closed.
- #6 (corex-state) is **superseded** — `StrategyStateStore` now lives in `corex-strategy-engine`.
