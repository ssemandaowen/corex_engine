# CoreX — Active Task Tracking

## Open Blockers (before Socket_X is production-usable)

### 1. Portfolio-level risk enforcement
- `broker.handle()` only checks `_passesRiskFloor()` per-trade
- `SignalProcessingEngine` (drawdown limits, portfolio-level position validation) is NOT invoked in the Socket_X path
- An external agent can send multiple individually-valid trades that together exceed account risk limits
- **Needed:** Integrate portfolio-level validation into the `RiskGateway` → `broker.handle()` path

### 2. Account ownership verification
- `_handleHello` validates accountId format and existence but NEVER verifies the authenticated user owns the accountId
- `authToken` in HELLO payload is never validated
- **Needed:** Verify authToken → userId, then check accountId belongs to that userId before granting controller/observer access

### 3. Account CRUD endpoints (REST)
- `TradingAccountRepository` exists but is not exposed through any REST API
- Clients cannot create an account before sending HELLO with an accountId
- **Needed:** Build `engine/routes/accountController.js` with `POST /api/accounts`, `GET /api/accounts`, `PATCH /api/accounts/:id/archive`
- **Important:** Endpoints must derive `userId` from the authenticated session, NOT accept it as a request field

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
- [x] 210 tests pass across 12 suites

### Package 2 (corex-market-data)
- [x] Merged to main — 70 tests, 6 suites

### Auth simplification
- [x] JWT TTL 30 days, API key system removed, 300 tests pass

## Next (after blockers closed)

### Extract corex-gateway package
- Socket_X (SocketXServer/SocketXConnection/MessageEnvelope/RiskGateway), Account model + repository, and account REST controller currently live in `corex-broker-contract`
- These are transport/gateway logic, not broker execution contract — they *use* the broker contract, not part of it
- **Target:** New `corex-gateway` (or `corex-server`) package owning all Socket_X + account + REST controller code
- **Depends on:** `corex-broker-contract` (for BrokerContract/adapters), `corex-auth` (for ownership verification)
- **Do not start until:** The three open blockers above are closed — moving files now adds motion without fixing the safety/security gaps

### Package 3 — corex-auth extraction
- Extract authService.js + secretsVault.js to packages/corex-auth/
- Keep DB/Express-coupled code in engine/ with re-export shims
