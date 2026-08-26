# AGENTS.md — corex-gateway

Package: `corex-gateway` — Socket_X protocol, account model, connection lifecycle, auth/risk injection points.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@events`, `@utils`, `@config`, `@core`, `@broker`, `@gateway`.
- One commit per component change (protocol, account, test). Run tests after each commit.

## Architecture

### Socket_X Protocol Layer
Socket_X is the external client protocol boundary. It sits **above** BrokerContract in the stack:

```
External clients (AI agents, bots, apps)
        ↓ commands ↑ signals/fills
    Socket_X broker (protocol, mode-agnostic)
        ↓ validated commands ↑ signals, fills
    Risk & portfolio gate (same rules, every mode)
        ↓ execute
    BrokerContract (adapter interface) — owned by corex-broker-contract
        ↓
    Paper adapter | Live adapter
```

- Solid arrows = inbound command path (client → Socket_X → risk gate → BrokerContract → adapter).
- Dashed arrows = outbound event path (adapter/risk gate → Socket_X → client), running in parallel alongside the solid path at each layer.
- Every layer is one-directional in responsibility: a layer only talks to its immediate neighbor above or below, never skips a layer.
- Risk & portfolio gate is the only layer with "same rules, every mode" — Paper and Live both pass through it identically before reaching BrokerContract.
- BrokerContract is the single branch point: everything above it is one path; below it splits to exactly one of two adapters (Paper or Live) based on `mode` in the envelope.

### Socket_X Components
- `src/socketx/MessageEnvelope.js` — envelope schema, validation, factory methods (helloAck, reject, snapshot, ping, fill, positionUpdate, ack).
- `src/socketx/SocketXConnection.js` — per-connection state (runtimeId claim, heartbeat, rate limiter).
- `src/socketx/SocketXServer` — connection lifecycle, handshake (HELLO → HELLO_ACK + SNAPSHOT), command routing, **idempotency cache keyed by runtimeId** (persists across reconnects), **observer role support**, **injected auth verifier**.
- `src/socketx/RiskGateway` — routes validated commands through `broker.handle()` which enforces risk floor + margin guardrails before execution.

### Account Model
- `src/account/Account.js` — Account model with validation (type, brokerBinding, status).
- `src/account/AccountId.js` — Structured account ID generation (`cx_pap_<ulid>` / `cx_liv_<ulid>`) and parsing.
- `src/account/TradingAccountRepository.js` — PostgreSQL-backed CRUD with per-user account limits.
- `src/account/InMemoryAccountRepository.js` — In-memory implementation for testing.

### HTTP Routes
- `src/http/accountRoutes.js` — Exportable Express router for account management.

### Dependency Injection Pattern
Socket_X uses dependency injection for external dependencies to avoid duplicating logic owned by other packages:

**Risk Engine** — `RiskGateway.setRiskEngine(engine)`:
- The engine (e.g., `SocketXRiskEngine`) is injected at startup by the engine core.
- If no engine is injected: test environment logs a warning and uses a default fallback; production throws immediately.
- This prevents a missing integration from failing silently.

**Auth Verifier** — `SocketXServer.setAuthVerifier(fn)`:
- The verifier function is injected at startup by the engine core (wired to `corex-auth`).
- If no verifier is injected: test environment logs a warning and uses a default fallback (which delegates to `corex-auth`); production throws immediately.
- This eliminates the duplicate auth path risk — corex-gateway contains zero standalone JWT verification logic.

## Boundaries (do not violate without asking Owen)
- `runtimeId` is now `accountId` in the Socket_X protocol — mode is resolved server-side from the account record, never client-asserted.
- Socket_X policy rules (non-negotiable):
  1. **Idempotency** — duplicate `messageId` rejected with `DUPLICATE_COMMAND` (persists across reconnects).
  2. **Exclusivity** — one controller per `accountId`; second gets `SESSION_CONFLICT`.
  3. **Rate limiting** — token-bucket per connection; over-limit commands get `RATE_LIMITED`.
  4. **Mode-agnostic** — Paper and Live share identical protocol behavior; mode resolved server-side from account.
  5. **Risk gate enforcement** — every command passes through `RiskGateway` → `broker.handle()`.
- **Connection roles:** controller (exclusive, can trade) and observer (read-only, max 5 per account).
- **Account model:** Account ID format `cx_pap_<ulid>` / `cx_liv_<ulid>`; mode resolved server-side.
- **Namespace separation:** Socket_X `accountId` is NOT the same as strategy runtimeId (`userId::strategyName::symbol::mode`). They are distinct namespaces — Socket_X is a direct trade-command channel that routes through `RiskGateway` → `broker.handle()`, separate from the strategy pipeline. Do not conflate them; do not pass a strategy runtimeId where a Socket_X accountId is expected or vice versa.
- **Broker credential failures:** `BROKER_UNAUTHORIZED` keeps connection open; `ACCOUNT_DEGRADED` reserved.

## Related Packages
- `corex-broker-contract` — BrokerContract interface, drivers, RuntimeBrokerFactory (this package depends on it)
- `corex-auth` — JWT signing/verification, AES-256-GCM encryption (verifier injected into SocketXServer)
- `corex-market-data` — Market data providers

## Human verification required
- Socket_X: handshake and command routing verified against mock brokers. Real WebSocket transport integration not yet verified end-to-end.
- Account ownership: verified via injected authToken → userId check against accountId ownership.