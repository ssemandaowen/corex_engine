# CoreX Market Data, Execution, Socket_X & Backtesting — Target Architecture Proposal

> **Status:** DRAFT — architecture proposal only; not implementation authorization  
> **Owner / final decision authority:** Owen Ssemanda  
> **Created:** 2026-11-14  
> **Related work:** P3-04 broker ownership cleanup; Phase 1 target architecture  
> **Repository:** https://github.com/ssemandaowen/corex_engine

## 1. Purpose

Define the target boundaries between market data, trading execution, account state, Socket_X communication and backtesting before further broker or gateway implementation.

The central requirement is that a market-data provider and an execution provider are independent choices. A user must be able to receive prices from Twelve Data while executing orders through a local MetaTrader 5 terminal, MetaApi, OANDA or another supported execution adapter. Adding or changing one provider must not require rewriting strategy logic or the other provider integration.

This document is a proposal to be reconciled with the authoritative roadmap and approved by Owen. It does not authorize implementation, package extraction, database changes, live trading or merging PRs.

## 2. Architectural invariants

1. **Separate data from execution.** Data connections provide market observations; execution adapters submit and report orders. A provider may implement both capabilities, but CoreX must configure and consume those capabilities independently.
2. **One execution authority.** Strategy-generated orders, Socket_X commands and manual orders must enter one application-level authorization, risk and routing path.
3. **Socket_X is transport, not business authority.** It authenticates connected clients/terminals and transports commands, acknowledgements and state events. It must not implement a second risk engine, broker factory or independent order-routing policy.
4. **One strategy-facing contract across modes.** Strategies consume normalized market events and emit normalized trade intentions regardless of LIVE, PAPER or BACKTEST.
5. **Mode-specific execution.** LIVE uses a real execution adapter; PAPER uses a simulated account/ledger; BACKTEST uses deterministic historical replay and a simulation adapter. A backtest must never submit to a live broker.
6. **Explicit account and runtime ownership.** Every data session, execution account, runtime and order must have explicit ownership and association. No global active provider or implicit account selection.
7. **Truthful capabilities and failures.** Adapters advertise only supported operations. Unsupported operations, stale feeds, disconnected terminals, rejected orders and unavailable history must be explicit—not represented as success.
8. **Auditable, idempotent commands.** State-changing requests have stable identifiers, lifecycle records and duplicate protection. Reconnect/retry must not execute the same order twice.
9. **Provider-specific limits remain visible.** API quotas, connection/subscription limits, symbol coverage, history restrictions and licensing constraints must be handled by each provider adapter and exposed to configuration/operations.
10. **No silent data mixing.** Failover is allowed only under explicit policy and compatible instrument, timestamp, price and data-quality semantics. Every observation retains source provenance.

## 3. Responsibility boundaries

### 3.1 Market Data subsystem — existing owner: packages/corex-market-data

Owns provider integration and data-session lifecycle:

- Provider registry and adapter creation.
- Per-runtime/per-subscription data sessions.
- Connect, disconnect, subscribe, unsubscribe and reconnect.
- Live tick and candle streams.
- Historical bar/tick retrieval where the provider supports it.
- Normalization of timestamps, instrument identifiers, OHLCV and provider metadata.
- Data quality, stale-feed and provider health signals.
- Rate limits, quotas, pagination, resubscription and provider-specific errors.
- Optional shared physical connections where safe, without sharing a global active-provider choice.

Candidate provider adapters (subject to API, licensing and capability verification): Twelve Data, Polygon.io, OANDA market data, MT5 terminal market data, CSV/file and other historical data sources.

The package must not own account execution, order routing, portfolio risk or trading decisions.

### 3.2 Execution and broker subsystem — existing owner: packages/corex-broker-contract

Owns explicit execution-facing contracts and provider adapters. The existing package name may be retained or reconsidered during Phase 1; do not rename it merely for aesthetics.

Proposed capabilities/contracts:

- **ExecutionAdapter:** submit, modify, cancel and close orders where supported.
- **AccountProvider:** retrieve account identity, balance, equity, margin and account status.
- **PositionProvider:** retrieve positions and position changes where supported.
- **ExecutionEvents:** acknowledgements, fills, rejections, cancellations and execution state.
- **BrokerCapabilities:** explicit supported operations, order types, symbol rules and limitations.

Candidate adapters: MT5 Local EA through Socket_X; MetaApi through its supported API; OANDA execution if selected and implemented against its actual API; PAPER execution; BACKTEST simulation execution (ownership to be decided with the backtest domain).

A connector must not claim an operation is supported merely because a method exists. Capability checks and unsupported-operation errors are part of the public contract.

### 3.3 Application ExecutionAuthority — application orchestration boundary

Introduce one application-level authority (working name: ExecutionAuthority). Its exact file/package ownership is a Phase 1 decision; do not assume it belongs inside the broker adapter package.

Responsibilities:

1. Accept normalized execution requests from strategy runtime, Socket_X and authorized manual-trading services.
2. Resolve user, execution account, runtime, mode and selected adapter.
3. Verify ownership, authorization, account readiness and runtime state.
4. Apply the authoritative pre-trade risk and policy checks.
5. Enforce idempotency and concurrency controls.
6. Route the approved request to the selected execution adapter.
7. Persist/coordinate command lifecycle and publish authoritative execution events.
8. Reconcile acknowledgements, fills, positions and adapter/account state.

The authority should not implement market-data transport, strategy signal generation, provider-specific protocol parsing or backtest fill mathematics.

Risk policy must have one authoritative decision path. Existing duplicated/hardcoded risk checks in the strategy pipeline and Socket_X gateway must be mapped and reconciled before integration.

### 3.4 Socket_X — existing owner: packages/corex-gateway

Socket_X is the authenticated communication gateway for application clients and supported terminal agents.

Responsibilities:

- Authenticated connection establishment and account/terminal association.
- Protocol versioning, schema validation and message authorization.
- Heartbeats, connection lifecycle and reconnect handling.
- Command delivery, acknowledgements, timeouts and correlation IDs.
- Inbound execution/account/position events from terminal clients.
- Outbound authoritative order, fill, position and runtime-state events.
- Terminal capability and readiness reporting.
- Backpressure, bounded queues, stale-session handling and observability.

Socket_X delegates command handling to ExecutionAuthority. It must not create a second broker instance or bypass the common risk and authorization path.

The existing /ws frontend broadcaster and /mt5 receiver endpoint are separate current paths. Their responsibilities and migration must be explicitly decided; do not remove either simply because a new /socketx route is proposed.

### 3.5 Backtesting subsystem

Backtesting consumes historical data through the market-data contract and submits strategy intentions through the same normalized execution-request boundary, but it uses a deterministic simulation implementation.

Candidate responsibilities:

- Backtest orchestration and configuration validation.
- Historical data session and dataset validation.
- Deterministic replay clock and event ordering.
- Simulation execution adapter and simulated account ledger.
- Fill, spread, slippage, commission, financing and margin models.
- Stop-loss/take-profit and order-type simulation.
- Progress, cancellation, results, analytics and persistence.

The current engine/backtestManager.js is too broad to remain the permanent owner of all these responsibilities. Split by stable ownership boundaries, not arbitrary line count. Exact package placement and migration sequence must be decided after tracing current worker, persistence, report and API consumers.

## 4. Required configuration model

Data-source configuration and execution-account configuration must be separate resources and separately selectable.

A runtime configuration should conceptually identify:

| Concern | Example |
|---|---|
| Mode | LIVE |
| Execution connection | selected MT5 Local EA connection |
| Execution account | selected MT5 account |
| Market-data connection | selected Twelve Data connection |
| Instrument | canonical instrument identifier |
| Provider symbol | provider-specific symbol mapping |
| Data subscription | tick / candle interval and required fields |
| Risk policy | selected account/runtime risk profile |
| Strategy | strategy identity, version and parameters |

This is illustrative, not a final database schema. Phase 1 must inspect existing users, broker settings, secrets, runtime registry, account identifiers and persistence before proposing migrations.

A user may have multiple data connections and multiple execution accounts. A data connection may serve multiple compatible runtimes; each runtime must still own its subscriptions and lifecycle. Sharing a physical connection is an optimization, not a reason to share global mutable selection state.

Secrets remain in the existing protected credential/settings mechanism. Provider keys must not be copied into strategy configuration, frontend state, logs or repository files.

## 5. Canonical data and symbol semantics

The market-data contract must define:

- Canonical instrument identity versus provider-specific symbol.
- Bid, ask, midpoint and last-trade semantics; do not treat them as interchangeable.
- Tick and candle timestamp meaning, timezone and ordering.
- Candle interval, completeness and whether the current candle is still forming.
- Price precision, tick size, lot/contract metadata and volume semantics.
- Missing bars, duplicate/out-of-order events and stale observations.
- Source/provider identity and source timestamps.
- Historical/live boundary and warm-up behavior.

Execution adapters must independently map canonical instruments to broker symbols and enforce broker-specific precision, volume steps, minimum size, trading sessions and order constraints.

The system must not assume that a Twelve Data EUR/USD quote is identical to an MT5 broker's executable bid/ask. The chosen pricing policy (data feed used for signals versus broker quote used for execution validation) must be explicit. Execution reports must retain actual broker fill prices.

## 6. MT5 Local EA and MetaApi paths

### 6.1 MT5 Local EA

The existing broker/CorexReceiver.mq5 HTTP-polling EA and the existing Python/WebSocket MT5 receiver represent different protocols. The audit records both; neither may be removed until the supported target and migration criteria are approved.

Proposed preferred direction for a local terminal adapter:

1. EA establishes an outbound authenticated connection to Socket_X.
2. CoreX binds the session to a user, terminal and authorized execution account.
3. CoreX delivers a versioned command with unique command/order identifiers.
4. EA validates and executes using the MT5 trading API.
5. EA returns accepted/rejected status, broker ticket, fill details and subsequent state events.
6. CoreX reconciles the event and persists authoritative order state.
7. Reconnect recovery reconciles outstanding commands and broker state without duplicate execution.

The protocol must specify authentication, authorization, signing/transport security, heartbeat, sequence/correlation IDs, retries, deduplication, acknowledgements, timeouts, reconnect, clock handling and compatibility/version policy.

### 6.2 MetaApi

MetaApi is a separate remote execution adapter. It should not be forced through the local EA protocol. Verify the actual SDK/API methods, account deployment/connection state, supported order operations, event subscriptions, error semantics and account reconciliation.

The current audit identifies MetaApiConnector.execute() as a non-executing skeleton. It must remain explicitly unavailable for real execution until a real implementation and integration tests prove otherwise.

### 6.3 OANDA and other providers

OANDA may supply market data, execution, or both, but each capability must be implemented and configured independently. Polygon.io and Twelve Data should be treated as data adapters unless a separately verified execution capability exists. Provider names in a roadmap are not claims of implemented support.

## 7. Backtesting correctness requirements

Backtest must be reproducible from a complete run specification:

- Strategy identity/version and parameter snapshot.
- Exact dataset identity, provider/source, symbol mapping and date range.
- Starting balance and account currency.
- Timezone, timeframe and replay/event-ordering policy.
- Spread, slippage, commission, financing and fill assumptions.
- Order/position sizing and margin rules.
- Engine and simulator version.

The simulator must define deterministic behavior for market, limit, stop and supported advanced order types; gaps; spread; slippage; partial fills if modelled; rejected orders; stop-loss/take-profit ordering; fees; margin; and insufficient funds.

Live-provider credentials and live order endpoints must be inaccessible to the BACKTEST execution path. Backtest cancellation must stop replay and downstream work, and persistence must distinguish incomplete/cancelled/failed runs from completed results.

The same strategy-facing event and execution-request contracts should be used across modes. The simulation's time control and fill semantics remain backtest-specific.

## 8. Proposed migration and planning sequence

This proposal maps to the existing authoritative plans/COREX_DEVELOPMENT_PLAN.md. It does not create permission to skip Phase 0 or implement all work in one task.

### Phase 1 — architecture and contract decisions

- Reconcile the existing broker ownership audit, current source and all relevant open PRs.
- Trace current runtime, strategy, Socket_X, manual, MT5, data-provider, backtest worker, persistence and frontend paths.
- Decide public contracts, dependency direction, account/runtime identity mapping and ownership boundaries.
- Decide whether ExecutionAuthority is an application service or an existing package responsibility.
- Define the Socket_X/EA protocol and disposition/migration criteria for the existing HTTP and WebSocket MT5 transports.
- Define provider/session configuration and canonical market-data semantics.
- Define backtest replay and simulation boundaries.
- Produce a dependency map, interface sketches, migration order, risks and acceptance criteria.

**Exit gate:** Owen explicitly approves the target contracts and bounded implementation tasks.

### Phase 3 — bounded implementation milestones (proposed order)

1. **Broker/execution contracts:** public interfaces, capability model, account identity and adapter conformance tests.
2. **Market-data sessions:** provider registry, per-runtime sessions, normalization and provider-specific lifecycle/limits.
3. **ExecutionAuthority:** common request path, account/runtime resolution, risk, idempotency and lifecycle persistence.
4. **Socket_X + MT5 Local EA:** protocol, authentication, command delivery, acknowledgement, reconciliation and reconnect tests.
5. **MetaApi/OANDA adapters:** implement only verified capabilities; no stub may report successful execution.
6. **Backtest separation:** historical sessions, deterministic replay, simulation adapter, costs/fills, cancellation and persistence.
7. **Integration hardening:** PAPER/LIVE/BACKTEST isolation, account ownership, frontend state and end-to-end tests.

Task IDs and dependencies must be assigned in the authoritative roadmap after Phase 0 and Phase 1 review. Do not invent parallel status boards.

## 9. Acceptance criteria for the eventual architecture

The design is acceptable only when it can explain and test all of the following:

1. Twelve Data provides live EUR/USD prices while a selected local MT5 account executes orders.
2. The same strategy can use Twelve Data with MetaApi execution by changing execution configuration only.
3. A runtime can select another compatible data provider without changing strategy or execution adapter code.
4. Multiple runtimes can use different providers and subscriptions without a global active-provider collision.
5. Strategy, manual and Socket_X orders pass through the same authorization, risk, idempotency and execution-routing authority.
6. Socket_X cannot instantiate or route around an independent broker/risk authority.
7. A disconnected EA cannot leave commands falsely marked as executed; reconnect reconciles pending commands and actual broker state.
8. MetaApi and other adapters report unsupported/unavailable capabilities honestly.
9. BACKTEST cannot reach a live execution adapter and is deterministic for a fixed run specification.
10. PAPER and BACKTEST state are isolated from LIVE accounts and persisted trading records.
11. Provider outages, quota exhaustion, stale data, symbol mismatch and incompatible failover produce explicit observable states.
12. Contract, adapter, lifecycle, concurrency, security, recovery and end-to-end tests cover the approved flows.

## 10. Open decisions requiring Owen's approval

- Is Socket_X the sole supported local-terminal protocol, and what is the migration/retirement policy for the current HTTP-polling EA and /mt5 WebSocket receiver?
- Should MT5 local execution connect directly to the Socket_X gateway, or should a distinct terminal-session adapter sit between the gateway and ExecutionAuthority?
- Which account identity is canonical, and how are user, broker account, terminal session, runtime and mode mapped?
- Which data providers are initial supported targets, and which asset classes/instruments are in scope?
- What is the policy when provider prices differ from executable broker quotes?
- Is data-provider failover permitted during an active LIVE runtime, and under what compatibility and user-consent rules?
- Which risk rules are universal, which are mode-specific, and where is their authoritative implementation?
- Which existing order/fill/position tables and services remain authoritative, and what migrations are required?
- Where should backtest orchestration and simulation live given the existing package and worker ownership?
- Which adapters are production targets now versus future integrations?

## 11. Evidence and related documents

- plans/architecture/BROKER_OWNERSHIP_AND_SOCKETX_AUDIT.md — current ownership, import, runtime, backtest, Socket_X and MT5 transport findings.
- plans/tasks/P3-04-broker-ownership-cleanup.md — bounded cleanup task and verification handoff.
- plans/COREX_DEVELOPMENT_PLAN.md — authoritative phases, approval gates and agent workflow.
- plans/decisions.md — append only decisions after Owen approves them.
- plans/KNOWN_ISSUES.md — record verified unresolved implementation issues.

The current audit documents that Socket_X is not mounted in engine/server.js, strategy-runtime brokers are not registered with RiskGateway, gateway and runtime paths can create separate broker instances, and MetaApi execution is still a stub. These are current-state blockers, not reasons to mount the gateway before the shared execution design is approved.

## 12. Explicit non-goals

This proposal does not authorize:

- Merging PR #26, #60 or #61.
- Mounting Socket_X immediately.
- Enabling real MetaApi or MT5 trading without verified adapter tests.
- Deleting either existing MT5 receiver protocol before migration approval.
- Replacing the entire broker, market-data or backtest packages in one change.
- Creating microservices or adding infrastructure solely for architectural fashion.
- Changing database schemas, credentials storage or frontend configuration before their owners and migration paths are established.
- Claiming Twelve Data, Polygon.io, OANDA or MT5 capabilities that have not been implemented and verified.

---

**Approval record:** Pending Owen review. Until approval is recorded in plans/decisions.md and the authoritative roadmap, this document remains a design proposal only.
