# Socket_X Protocol Layer — Implementation Plan

## Overview
Add a Socket_X protocol layer to `corex-broker-contract` that lets external clients send trade commands and receive execution events over persistent connections. Socket_X sits ABOVE BrokerContract, never bypasses the risk gate, and never talks to a broker adapter directly.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Clients                          │
│                   (Frontend, AI agents, bots)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket / TCP (persistent)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Socket_X (NEW)                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Connection Handler                                      │    │
│  │  • HELLO handshake (auth + runtimeId claim)              │    │
│  │  • Idempotency check (messageId cache)                   │    │
│  │  • Exclusivity enforcement (one connection per runtimeId)│    │
│  │  • Rate limiting (token bucket per connection)           │    │
│  │  • Heartbeat (PING/PONG, prune dead connections)        │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Message Envelope Validator                              │    │
│  │  • Schema validation (schemaVersion, messageId, etc.)   │    │
│  │  • Command normalization (BUY/SELL/MODIFY/CANCEL)       │    │
│  │  • Event serialization (FILL/REJECT/POSITION_UPDATE)     │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ validated commands
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Risk / Portfolio Gate                          │
│  • Margin checks, position limits, symbol validation            │
│  • (Existing logic — Socket_X calls into it, doesn't modify)   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ approved commands
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BrokerContract (existing)                      │
│  • BaseBroker / CoreXPaperDriver / MetaApiDriver                │
│  • (Untouched — Socket_X routes to them)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/socketx/SocketXServer.js` | Main server: manages connections, heartbeat pruning, exclusivity registry |
| `src/socketx/SocketXConnection.js` | Per-connection state: rate limiter, idempotency cache, send/receive |
| `src/socketx/MessageEnvelope.js` | Envelope validation, construction, error serialization |
| `src/socketx/RiskGateway.js` | Thin interface that routes validated commands through the risk gate to BrokerContract |
| `test/socketx.test.js` | Tests: handshake, duplicate rejection, exclusivity, rate limit, BUY→FILL round trip |

## Key Design Decisions

### 1. Transport Abstraction
Socket_X is transport-agnostic. It works over WebSocket or raw TCP. The `SocketXServer` accepts a `transport` adapter (defaults to `ws` WebSocket library, already in package.json deps).

### 2. Risk Gateway
Socket_X does NOT implement risk rules. It calls `RiskGateway.submit(command)` which:
1. Looks up the broker for the `runtimeId` (via `RuntimeBrokerFactory`)
2. Calls the existing risk checks (`_passesRiskFloor`, margin guards)
3. Routes to `BrokerContract.submit()` if approved

### 3. Exclusivity
`SocketXServer` maintains a `Map<runtimeId, connectionId>`. Second connection attempting to claim an active `runtimeId` gets `REJECT / SESSION_CONFLICT` immediately.

### 4. Idempotency
Each `SocketXConnection` maintains a `Set<messageId>` of processed commands. Duplicate `messageId` → `REJECT / DUPLICATE_COMMAND` before reaching the risk gate.

### 5. Rate Limiting
Token-bucket rate limiter per connection. Default: 10 commands/second (configurable). Over-limit → `REJECT / RATE_LIMITED`.

### 6. Heartbeat
Server sends `PING` every 30 seconds. Client must respond with `PONG`. Missing 3 consecutive PONGs → connection pruned.

## Message Flow

### Inbound (Client → Server):
```
Client sends: { messageId, runtimeId, type: "command", payload: { action: "BUY", ... } }
  ↓
SocketXConnection receives envelope
  ↓
MessageEnvelope.validate() → malformed? → REJECT (close if fatal)
  ↓
Idempotency check → duplicate? → REJECT / DUPLICATE_COMMAND
  ↓
Exclusivity check → runtimeId claimed by another connection? → REJECT / SESSION_CONFLICT
  ↓
Rate limit check → over limit? → REJECT / RATE_LIMITED
  ↓
RiskGateway.submit() → routes through risk gate → BrokerContract
  ↓
On success → FILL event emitted to client
On failure → REJECT event emitted to client
```

### Outbound (Server → Client):
```
BrokerContract emits fill → SocketXConnection.send(FILL, fillData)
Position update → SocketXConnection.send(POSITION_UPDATE, posData)
Error → SocketXConnection.send(REJECT, { reasonCode, reasonMessage })
```

## Implementation Order

1. **MessageEnvelope.js** — pure validation logic, no deps → test first
2. **SocketXConnection.js** — per-connection state (idempotency, rate limit, heartbeat)
3. **RiskGateway.js** — thin routing interface to BrokerContract
4. **SocketXServer.js** — connection manager, exclusivity registry
5. **socketx.test.js** — full test suite

## Policy Rules Implementation

| Rule | Where | How |
|------|-------|-----|
| Idempotency | `SocketXConnection` | `Set<messageId>` per connection, check before risk gate |
| Exclusivity | `SocketXServer` | `Map<runtimeId, connectionId>`, reject second claim |
| Rate limiting | `SocketXConnection` | Token bucket, reject over-limit |
| Mode-agnostic | `SocketXServer` | No `mode` checks in protocol layer; BrokerContract differs downstream |
| Risk gate enforcement | `RiskGateway` | Every command goes through `BrokerContract.handle()` which does risk checks |

## Acceptance Criteria

- [ ] All new tests pass; no existing tests broken
- [ ] No "REST broker" references remain in new/touched code
- [ ] Market data, risk-rule internals, adapter internals untouched
- [ ] Handshake: HELLO → HELLO_ACK + SNAPSHOT (success) or REJECT (failure)
- [ ] Duplicate messageId rejected before risk gate
- [ ] Second connection on same runtimeId rejected immediately
- [ ] Rate limit enforced, over-limit rejected
- [ ] Full BUY → FILL round trip in Paper mode
