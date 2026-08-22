# CoreX — Active Task Tracking

## In Progress

### Socket_X Protocol Layer — corex-broker-contract
- [x] MessageEnvelope.js — schema validation + factory methods
- [x] SocketXConnection.js — per-connection state (idempotency, rate limit, heartbeat)
- [x] RiskGateway.js — policy enforcement routing to BrokerContract
- [x] SocketXServer.js — connection lifecycle, handshake, exclusivity
- [x] socketx.test.js — 181 tests pass (11 suites)
- [x] Package AGENTS.md updated with Socket_X architecture
- [x] Package description updated
- [x] Decisions.md logged
- [ ] Commit to git

## Next

### Package 3 — corex-auth extraction
- Extract authService.js + secretsVault.js to packages/corex-auth/
- Keep DB/Express-coupled code in engine/ with re-export shims
- See plans/package-3-analysis.md for full scope

## Done

- Package 2 (corex-market-data) — merged to main, 70 tests, 6 suites
- Auth simplification — JWT TTL 30 days, API key system removed, 300 tests pass
- Broker contract (Issue #1) — locked architecture
