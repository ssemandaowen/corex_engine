# AGENTS.md — corex-broker-contract

Package: `corex-broker-contract` — BrokerContract interface, drivers (Backtest / Paper / Live), BaseBroker, RuntimeBrokerFactory, Socket_X protocol layer, and supporting utilities.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@events`, `@utils`, `@config`, `@core`, `@broker`.
- One commit per component change (contract, driver, util, test). Run tests after each commit.

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
    BrokerContract (adapter interface)
        ↓
    Paper adapter | Live adapter
```

- Solid arrows = inbound command path (client → Socket_X → risk gate → BrokerContract → adapter).
- Dashed arrows = outbound event path (adapter/risk gate → Socket_X → client), running in parallel alongside the solid path at each layer.
- Every layer is one-directional in responsibility: a layer only talks to its immediate neighbor above or below, never skips a layer.
- Risk & portfolio gate is the only layer with "same rules, every mode" — Paper and Live both pass through it identically before reaching BrokerContract.
- BrokerContract is the single branch point: everything above it is one path; below it splits to exactly one of two adapters (Paper or Live) based on `mode` in the envelope.

### Socket_X Components
- `src/socketx/MessageEnvelope.js` — envelope schema, validation, factory methods (helloAck, reject, snapshot, ping, fill, positionUpdate).
- `src/socketx/SocketXConnection.js` — per-connection state (runtimeId claim, heartbeat, rate limiter, dedup cache).
- `src/socketx/SocketXServer` — connection lifecycle, handshake (HELLO → HELLO_ACK + SNAPSHOT), command routing.
- `src/socketx/RiskGateway` — policy enforcement (idempotency, exclusivity, rate limiting, mode-agnostic, risk gate) before BrokerContract.

## Boundaries (do not violate without asking Owen)
- `runtimeId` = `userId::strategyName::symbol::mode` — never bypass.
- BrokerContract interface: `submit`/`modify`/`cancel`/`query_status` are the primary async methods. `placeOrder`/`getPosition`/`getAccount` are deprecated delegates.
- `CoreXPaperDriver` owns its local virtual ledger — never route paper through MetaAPI/REST.
- `MetaApiDriver`: Live mode — broker owns the ledger. `setCash`/`setInitialCash`/`resetAccount` return `false` (no-op).
- `SymbolNormalizer`: every driver AND every data source normalizes at its boundary before anything reaches the internal event bus.
- `SharedFillSim`: single fill-simulation module shared by BacktestDriver and CoreXPaperDriver — never duplicate fill logic.
- `RuntimeBrokerFactory`: same-symbol-one-driver rule enforced at session creation, not at order time.
- Socket_X policy rules (non-negotiable):
  1. **Idempotency** — duplicate `messageId` within a session is rejected with `DUPLICATE_COMMAND`.
  2. **Exclusivity** — only one connection per `runtimeId` at a time; second connection gets `SESSION_CONFLICT`.
  3. **Rate limiting** — token-bucket per connection; over-limit commands get `RATE_LIMITED`.
  4. **Mode-agnostic** — Paper and Live share identical protocol behavior; mode only selects the adapter.
  5. **Risk gate enforcement** — every command passes through RiskGateway before BrokerContract, regardless of mode.

## Human verification required
- MetaApiDriver: needs Owen's real broker credentials (MetaAPI token, MT5 terminal) to verify end-to-end. Skeleton connector is functional but untested against real broker. Flag, don't self-certify.
- Socket_X: handshake and command routing verified against mock brokers. Real WebSocket transport integration not yet verified end-to-end.