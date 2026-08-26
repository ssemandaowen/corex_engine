# corex-gateway

**CoreX Gateway Layer** — Socket_X protocol, account model, connection lifecycle, auth/risk injection points.

**Version:** 2026.1.22

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Features](#features)
  - [Socket_X Protocol](#socket_x-protocol)
  - [Account Model](#account-model)
  - [Portfolio Risk Enforcement](#portfolio-risk-enforcement)
  - [Auth Verifier Injection](#auth-verifier-injection)
  - [Connection Lifecycle](#connection-lifecycle)
  - [Account CRUD API](#account-crud-api)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Related Packages](#related-packages)
- [Testing](#testing)
- [Boundaries & Conventions](#boundaries--conventions)

---

## Overview

`corex-gateway` is the gateway/transport layer for the CoreX trading engine. It provides:

1. **Socket_X** — A WebSocket-based protocol for external clients to send trade commands
2. **Account system** — Multi-account support with per-user limits and ownership verification
3. **Portfolio risk gate** — Single enforcement path for drawdown and position validation
4. **Connection lifecycle** — HELLO, CLOSE, PAUSE, RESUME operations
5. **Auth/risk injection points** — Dependency injection pattern for external dependencies

---

## Installation

```bash
npm install
```

### Dependencies

- `ws` ^8.18.3 — WebSocket server
- `winston` ^3.19.0 — Logging
- `pg` ^8.16.3 — PostgreSQL client
- `dotenv` ^17.2.3 — Environment configuration
- `express` ^4.21.0 — HTTP framework (for account routes)
- `corex-broker-contract` — BrokerContract interface and drivers

---

## Features

### Socket_X Protocol

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

#### Components

| File | Description |
|------|-------------|
| `src/socketx/MessageEnvelope.js` | Envelope schema, validation, factory methods |
| `src/socketx/SocketXConnection.js` | Per-connection state (heartbeat, rate limiter) |
| `src/socketx/SocketXServer.js` | Connection lifecycle, handshake, command routing |
| `src/socketx/RiskGateway.js` | Routes commands through risk gate → broker |

#### Policy Rules (non-negotiable)

1. **Idempotency** — Duplicate `messageId` rejected with `DUPLICATE_COMMAND` (persists across reconnects)
2. **Exclusivity** — One controller per `accountId`; second gets `SESSION_CONFLICT`
3. **Rate Limiting** — Token-bucket per connection; over-limit commands get `RATE_LIMITED`
4. **Mode-Agnostic** — Paper and Live share identical protocol behavior; mode resolved server-side from account
5. **Risk Gate Enforcement** — Every command passes through `RiskGateway` → `broker.handle()`

#### Connection Roles

| Role | Description |
|------|-------------|
| **Controller** | Exclusive (one per account), can submit trading commands |
| **Observer** | Read-only, max 5 per account, receives SNAPSHOT/POSITION_UPDATE events |

#### Command Flow

```
Client → HELLO → Server validates authToken + account ownership
                  → HELLO_ACK + SNAPSHOT sent
Client → BUY/SELL/MODIFY/CANCEL → Server checks:
                  1. Rate limit
                  2. Idempotency (duplicate messageId)
                  3. Portfolio risk (drawdown + position)
                  4. Broker execution
                  → ACK sent immediately
                  → FILL/REJECT sent after execution
```

#### Reason Codes

| Code | Description |
|------|-------------|
| `RISK_LIMIT_EXCEEDED` | Portfolio drawdown or position limit exceeded |
| `INVALID_SYMBOL` | Symbol not recognized |
| `DUPLICATE_COMMAND` | messageId already processed |
| `BROKER_ERROR` | Broker execution failed |
| `RATE_LIMITED` | Token bucket exhausted |
| `SESSION_CONFLICT` | Account already has an active controller |
| `INVALID_ENVELOPE` | Malformed message |
| `UNAUTHORIZED` | Authentication/ownership failure |
| `BROKER_UNAUTHORIZED` | Broker credentials invalid |
| `NOT_FOUND` | Account not found |
| `CONNECTION_PAUSED` | Connection is paused |

---

### Account Model

Structured account IDs with server-side mode resolution.

#### Account ID Format

- **Paper:** `cx_pap_<ulid>` (e.g., `cx_pap_01HZX89K329RVTNABCDEF1234`)
- **Live:** `cx_liv_<ulid>` (e.g., `cx_liv_01HZX89K329RVTNABCDEF1234`)

Mode is **never** client-asserted — it's resolved from the account record.

#### Components

| File | Description |
|------|-------------|
| `src/account/AccountId.js` | ULID generation, `generateAccountId(type)`, `parseAccountId()` |
| `src/account/Account.js` | Account model with `validate()`, `validateRole()`, `toJSON()` |
| `src/account/TradingAccountRepository.js` | PostgreSQL-backed CRUD with per-user limits (10 paper / 3 live) |
| `src/account/InMemoryAccountRepository.js` | In-memory implementation for testing |

#### Account Limits

| Type | Per-User Limit |
|------|----------------|
| Paper | 10 |
| Live | 3 |

---

### Portfolio Risk Enforcement

**Single enforcement path** — all risk logic lives in `SignalProcessingEngine`, no duplication.

#### Integration

```
Socket_X command
    ↓
RiskGateway.submit()
    ↓
_checkPortfolioRisk() → SignalProcessingEngine.validateForCommand()
    ↓
broker.handle()
```

#### What It Checks

1. **Drawdown limit** — Blocks when `currentDrawdownPct >= maxDrawdownPct` (default 10%)
2. **Position validation** — Blocks EXIT when FLAT, ENTER when already in position (unless `allowScaling`)

#### Engine Wiring

At startup, the engine **must** inject the risk engine:

```javascript
const { SocketXRiskEngine } = require("./engine/core/pipeline/SocketXRiskEngine");
const { RiskGateway } = require("corex-gateway");

RiskGateway.setRiskEngine(SocketXRiskEngine);
```

#### Safety Check

If `RiskGateway` processes a command with no engine injected:

- **Test environment:** Logs warning, uses default fallback
- **Production:** Throws immediately — fails loud, not quiet

---

### Auth Verifier Injection

**Single auth path** — Socket_X does NOT verify tokens itself. The verifier is injected at startup.

#### Integration

```
Client → HELLO (authToken)
    ↓
SocketXServer._verifyToken(authToken)
    ↓
Injected verifier (corex-auth) → { ok, userId } or { ok: false, error }
    ↓
Account ownership check: accountId.userId === authResult.userId
```

#### Engine Wiring

At startup, the engine **must** inject the auth verifier:

```javascript
const { verifyToken } = require("corex-auth");
const { SocketXServer } = require("corex-gateway");

SocketXServer.setAuthVerifier((token) => {
    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
        return { ok: false, error: "TOKEN_NO_USER" };
    }
    return { ok: true, userId: payload.userId };
});
```

#### Safety Check

If `SocketXServer` processes a HELLO with no verifier injected:

- **Test environment:** Logs warning, uses default fallback (delegates to corex-auth)
- **Production:** Throws immediately — fails loud, not quiet

---

### Connection Lifecycle

| Command | Description |
|---------|-------------|
| **HELLO** | Client authenticates, server sends HELLO_ACK + SNAPSHOT |
| **CLOSE** | Voluntary disconnect, releases runtimeId claim immediately |
| **PAUSE** | Blocks inbound commands, **retains** claim, heartbeat continues |
| **RESUME** | Clears paused state, commands accepted again |

#### Pause vs Close

| Aspect | PAUSE | CLOSE |
|--------|-------|-------|
| Connection | Stays open | Closed |
| Claim | **Retained** | Released |
| Heartbeat | Continues | Stops |
| Trade commands | Rejected with `CONNECTION_PAUSED` | N/A |
| Outbound events (SNAPSHOT) | Still flow | Stop |

---

### Account CRUD API

Exportable Express router for account management.

```javascript
const { createAccountRouter } = require("corex-gateway");

const router = createAccountRouter({ repository });
app.use("/api", router);
```

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/accounts` | Create account (type, label, brokerBinding) |
| `GET` | `/accounts` | List user's accounts |
| `PATCH` | `/accounts/:id/archive` | Archive account |

**Security:** `userId` is derived from the JWT Bearer token — never from request body.

---

## Usage

### Basic Setup

```javascript
const {
    SocketXServer,
    RiskGateway,
    Account,
    TradingAccountRepository,
    createAccountRouter,
} = require("corex-gateway");

// Create server with account resolver for DB lookups
const server = new SocketXServer({
    accountResolver: async (accountId) => {
        const repo = new TradingAccountRepository();
        return repo.getByAccountId(accountId);
    },
});

// Handle connections
server.handleConnection(socket);
```

### Risk Engine Injection (Required at Startup)

```javascript
const { SocketXRiskEngine } = require("./engine/core/pipeline/SocketXRiskEngine");

RiskGateway.setRiskEngine(SocketXRiskEngine);
```

### Auth Verifier Injection (Required at Startup)

```javascript
const { verifyToken } = require("corex-auth");

SocketXServer.setAuthVerifier((token) => {
    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
        return { ok: false, error: "TOKEN_NO_USER" };
    }
    return { ok: true, userId: payload.userId };
});
```

### Account Creation

```javascript
const repo = new TradingAccountRepository();
const result = await repo.create({
    userId: "user_123",
    type: "paper",  // or "live"
    label: "My Paper Account",
});

if (!result.ok) {
    console.error(result.error); // ACCOUNT_LIMIT_EXCEEDED, etc.
}
```

---

## API Reference

### SocketXServer

| Method | Description |
|--------|-------------|
| `handleConnection(socket)` | Register new WebSocket connection |
| `getClaimedRuntimeIds()` | Get all claimed account IDs |
| `getConnectionCount()` | Get active connection count |
| `setAuthVerifier(fn)` | Inject auth verifier (call at startup) |

### RiskGateway

| Method | Description |
|--------|-------------|
| `setRiskEngine(engine)` | Inject risk engine (call at startup) |
| `submit({ connection, command })` | Process command through risk gate |
| `registerBroker(runtimeId, broker)` | Register broker session |
| `unregisterBroker(runtimeId)` | Remove broker session |

### AccountId

| Function | Description |
|----------|-------------|
| `generateAccountId(type)` | Generate `cx_pap_<ulid>` or `cx_liv_<ulid>` |
| `parseAccountId(id)` | Parse and validate account ID |
| `generateUlid()` | Generate raw ULID |

### TradingAccountRepository

| Method | Description |
|--------|-------------|
| `create({ userId, type, label, brokerBinding })` | Create account |
| `listByUser(userId)` | List user's accounts |
| `getByAccountId(id)` | Get account by ID |
| `archive(id)` | Archive account |

---

## Related Packages

| Package | Description | Relationship |
|---------|-------------|--------------|
| `corex-broker-contract` | BrokerContract interface, drivers, RuntimeBrokerFactory | This package depends on it |
| `corex-auth` | JWT signing/verification, AES-256-GCM encryption | Verifier injected into SocketXServer |
| `corex-market-data` | Market data providers | Independent |

---

## Testing

```bash
npm test
```

**Configuration:** Jest with `--passWithNoTests --testTimeout=20000`

### Test Structure

```
test/
├── socketx.test.js              # Socket_X protocol tests
├── account_socketx.test.js      # Account + Socket_X integration
└── socketx.authVerifier.test.js # Auth verifier injection tests
```

### Running Specific Tests

```bash
npm test -- --testNamePattern="SocketXServer handshake"
npm test -- --testPathPattern="socketx.authVerifier"
```

---

## Boundaries & Conventions

### Do Not Violate Without Asking Owen

- `runtimeId` is now `accountId` in Socket_X — mode resolved server-side
- BrokerContract interface: `submit`/`modify`/`cancel`/`query_status` are primary
- Socket_X policy rules (idempotency, exclusivity, rate limiting, mode-agnostic, risk gate)
- **Connection roles:** controller (exclusive, can trade) and observer (read-only, max 5 per account)
- **Account model:** Account ID format `cx_pap_<ulid>` / `cx_liv_<ulid>`; mode resolved server-side
- **Namespace separation:** Socket_X `accountId` is NOT the same as strategy runtimeId (`userId::strategyName::symbol::mode`)

### Human Verification Required

- **Socket_X:** Handshake and command routing verified against mock brokers. Real WebSocket transport integration not yet verified end-to-end

---

## License

Proprietary — Apex Trait Ltd.