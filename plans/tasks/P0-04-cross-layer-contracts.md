# P0-04 — Cross-Layer Contract Map

Status: READY
Suggested owner: Kilo Code
Risk: Medium (read-only contract audit)
Dependencies: P0-02, P0-03 and P0-05
Output: `plans/architecture/INTEGRATION_CONTRACT_MAP.md`

## Objective
Establish the verified contract map connecting frontend consumers, HTTP routes, WebSocket events, application orchestration, domain behavior and persistence.

## Scope
- Inventory API routes, methods, auth requirements, request/response shapes and error behavior.
- Inventory WebSocket event names, payload shapes, subscription rules, lifecycle and frontend consumers.
- Identify duplicated schemas, undocumented payloads, field-name mismatches and incompatible assumptions.
- Trace important flows end-to-end, including authentication, account/connector settings, strategy lifecycle, live runtime and backtest run/cancel/report.
- Record persistence side effects and transaction boundaries where they affect contracts.

## Non-goals
- No API versioning, schema changes, endpoint rewrites, frontend changes or event renames.
- Do not invent a contract from a type name without tracing the producer and consumer.

## Procedure
1. Read the accepted backend, frontend and persistence/runtime audit outputs.
2. Select critical user journeys and trace producer → transport → consumer.
3. Compare actual payload construction, validation and consumption.
4. Record error, authorization, reconnect and stale-state behavior.
5. Identify contract owners and the tests that currently protect each contract.

## Deliverable
Create `plans/architecture/INTEGRATION_CONTRACT_MAP.md` with route/event matrices, end-to-end flow diagrams or tables, payload evidence, mismatch list, test coverage and unresolved contract decisions.

## Acceptance criteria
- [ ] Critical flows have producer and consumer evidence.
- [ ] HTTP and WebSocket contracts are distinguished.
- [ ] Auth, errors, lifecycle and persistence effects are included where relevant.
- [ ] Backtest run/cancel/report and strategy lifecycle are traced.
- [ ] No implementation or contract files changed.
