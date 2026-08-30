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

### Package 3 — corex-auth extraction
- Extract authService.js + secretsVault.js to packages/corex-auth/
- Keep DB/Express-coupled code in engine/ with re-export shims

### corex-accounts extraction — IN PROGRESS
- [x] Create plans/corex-accounts-implementation.md
- [x] Implement corex-accounts package structure and services (scaffolded)
- [x] Create database migration for accounts/connections tables
- [x] Implement accountsService and connectionsService
- [x] Implement re-export shims for brokerPersistence/connectorSettingsService (initial scaffold)
- [ ] Verify bug fix with tests: multiple accounts per user, independent connection credentials
- [ ] Ensure no forbidden files were touched (verify with git status)


