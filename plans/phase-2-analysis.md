# Phase 2 Analysis: Strategy, Execution, Portfolio Extraction

> **Date:** 2026-08-27
> **Purpose:** Analyze coupling and dependencies before extracting corex-strategy-engine, corex-execution, and corex-portfolio packages.
> **Method:** Static analysis of require/import chains, shared state, and event bus usage.

---

## 1. Current File Map

### 1.1 Strategy Domain

| File | Role |
|------|------|
| `engine/strategyLoader.js` | Bootloader facade — DISCOVER + VALIDATE + COMPILE + schema extraction. Owns `_metaRegistry` (Map). |
| `engine/core/loader/StrategyLoader.js` | Thin wrapper around `engine/strategyLoader.js` for external callers. |
| `engine/services/strategyCompiler.js` | Compiles strategy source code → StrategyClass. 6-phase pipeline. |
| `engine/core/strategy/StrategyContract.js` | Interface contract every strategy must satisfy (generateSignal, symbols, etc.). |
| `engine/core/pipeline/SignalGenerationEngine.js` | Executes strategy `next()` per tick, manages circuit breaker, emits to event bus. |
| `engine/core/pipeline/SignalProcessingEngine.js` | Risk/filter validation. Two entry points: `process()` (strategy path) and `validateForCommand()` (Socket_X path). |
| `engine/core/pipeline/SignalExecutionEngine.js` | Bounded concurrent queue for order execution. |
| `engine/core/pipeline/runPipeline.js` | Orchestrates Generation → Processing → Execution for each data packet. |
| `engine/core/pipeline/SignalPipelineUtils.js` | Signal normalization helpers (`normalizeSignal`, `isSignalValid`). |
| `engine/core/pipeline/SocketXRiskEngine.js` | Adapter wrapping `SignalProcessingEngine.validateForCommand()` for Socket_X path. |
| `engine/core/pipeline/index.js` | Re-exports all pipeline engines. |
| `engine/modules/strategyRuntime/index.js` | Service layer for strategy execution (worker pool facade). |
| `engine/modules/strategyRuntime/workerPool.js` | Child process worker pool for sandboxed strategy execution. |
| `engine/workers/strategyWorker.js` | Child process entry point — holds `activeStrategies` Map, executes `execStrategy()`. |
| `engine/signalAdapter.js` | Incoming tick multiplexer — routes OHLCV bars to MarketFeed per active runtime. |
| `engine/managers/strategyManager.js` | Compatibility shim → re-exports `engine/strategyLoader.js`. |
| `engine/services/runtimeService.js` | High-level start/stop/restart for strategy runtimes. |
| `engine/core/runtime/RuntimeLifecycle.js` | Boot/terminate strategy runtimes — creates broker, registers in RuntimeRegistry. |
| `engine/core/runtime/RuntimeRegistry.js` | In-memory store of active runtime workspaces (instance + broker + state). |
| `engine/core/runtime/RuntimeBrokerFactory.js` | Re-export shim → `packages/corex-broker-contract/src/RuntimeBrokerFactory.js`. |
| `engine/core/runtime/MarketFeed.js` | Re-export shim → `packages/corex-market-data/src/MarketFeed.js`. |

### 1.2 Execution Domain

| File | Role |
|------|------|
| `engine/services/liveOrderDispatcher.js` | Polls DB for pending LIVE orders, dispatches via MT5 bridge. |
| `engine/routes/executionController.js` | Express routes for execution operations (positions, orders, trade history). |
| `engine/core/pipeline/SignalExecutionEngine.js` | *(shared with strategy)* — bounded queue for order execution. |

### 1.3 Portfolio Domain

| File | Role |
|------|------|
| `engine/services/brokerPersistence.js` | Persists broker settings to Postgres. Listens on `EVENTS.BROKER.STATE_CHANGED`. |
| `engine/services/tradeHistoryService.js` | Trade history CRUD + equity analytics (equity curves, drawdown, returns). |
| `engine/services/connectorSettingsService.js` | Per-user encrypted connector credentials (uses SecretsVault). |
| `engine/services/integrationRuntime.js` | Refreshes env vars from config (market data keys, MetaAPI tokens, MT5 bridge). |

---

## 2. Coupling Map

### 2.1 Strategy ↔ Execution

| Coupling Point | Type | Details |
|----------------|------|---------|
| `runPipeline.js` → `SignalExecutionEngine.enqueue()` | Direct call | Strategy pipeline directly calls execution engine's `enqueue()` method. |
| `SignalExecutionEngine` → `broker.execute()` | Direct call | Execution calls `broker.execute(signal, packet)` on the broker instance passed via closure. |
| `SignalGenerationEngine` → `RuntimeRegistry.get()` | Shared state | Generation reads `entry.broker` and `entry.instance` from RuntimeRegistry. |
| `SignalProcessingEngine` → `RuntimeRegistry.get()` | Shared state | Processing reads `entry.broker` to get equity/position data. |

**Assessment:** Tight coupling. `runPipeline.js` is the orchestrator that binds all three stages together. The execution engine is called synchronously from within the strategy pipeline.

### 2.2 Execution ↔ Portfolio

| Coupling Point | Type | Details |
|----------------|------|---------|
| `broker.execute()` → `broker.getPositionSnapshot()` | Direct call | Execution needs position data from broker (owned by corex-broker-contract). |
| `broker.execute()` → `broker.getEquity()` | Direct call | Execution needs equity data for risk checks. |
| `brokerPersistence.js` → `EVENTS.BROKER.STATE_CHANGED` | Event-driven | Persistence listens on event bus for broker state changes. |
| `tradeHistoryService.js` → `db` (Postgres) | Direct DB | Trade history reads/writes orders and trade records directly. |

**Assessment:** Moderate coupling. Execution interacts with portfolio data through the broker instance (which lives in corex-broker-contract). Persistence is already event-driven.

### 2.3 Strategy ↔ Portfolio

| Coupling Point | Type | Details |
|----------------|------|---------|
| `SignalGenerationEngine._preProcess()` → `broker.getPositionSnapshot()` | Shared state | Generation reads position snapshot from broker via RuntimeRegistry. |
| `SignalGenerationEngine._preProcess()` → `strategyInstance.setPositionsSnapshot()` | Direct call | Generation injects position data into strategy instance. |
| `SignalProcessingEngine` → `broker.getEquity()` | Shared state | Processing reads equity for drawdown calculation. |
| `SignalProcessingEngine` → `broker.getPositionSnapshot()` | Shared state | Processing reads position for ENTER/EXIT validation. |

**Assessment:** Tight coupling. Strategy pipeline directly reads portfolio state (positions, equity) from the broker instance stored in RuntimeRegistry.

### 2.4 Circular Dependencies

**None found.** The dependency graph is acyclic:

```
Strategy → Execution (runPipeline calls enqueue)
Strategy → Portfolio (reads positions/equity from broker)
Execution → Portfolio (calls broker.execute which updates positions)
```

No package imports create a cycle. The event bus (`@events/bus`) is a shared singleton that breaks potential cycles.

### 2.5 Event Bus Usage

Currently used for:
- `EVENTS.SYSTEM.ERROR` — SignalGenerationEngine emits on errors
- `EVENTS.SYSTEM.STRATEGY_START` / `STRATEGY_STOP` — lifecycle events
- `EVENTS.BROKER.STATE_CHANGED` — brokerPersistence listens
- `EVENTS.STRATEGY.SIGNAL` — signal emitted by generation
- `EVENTS.ORDER.CREATE` / `ORDER.FILLED` — order lifecycle (defined but not yet widely used)

**Assessment:** Partial adoption. Error handling and lifecycle events use the bus. Core data flow (signal → execution → fill) is still direct calls.

---

## 3. Risk Gate Interaction

### 3.1 Current Wiring

The risk gate has **two entry points** into `SignalProcessingEngine`:

**Entry Point 1: Strategy Path** (`engine/core/pipeline/runPipeline.js:83`)
```javascript
const approved = SignalProcessingEngine.process(intent, {
    strategyId: runtimeId,
    symbol: packet.symbol
});
```
- `process()` reads broker from `RuntimeRegistry.get(context.strategyId).broker`
- Used by the strategy pipeline (backtest, paper, live)

**Entry Point 2: Socket_X Path** (`engine/core/pipeline/SocketXRiskEngine.js:7`)
```javascript
const result = SignalProcessingEngine.validateForCommand({
    broker,
    intent,
    runtimeId: "socket_x",
});
```
- `validateForCommand()` takes broker as parameter (injected by RiskGateway)
- Used by Socket_X protocol (external clients)

Both paths converge on `_validateRisk()` which performs:
1. Drawdown check (`broker.getEquity()` vs `broker.initialCash`)
2. Position validation (`broker.getPositionSnapshot()`)

### 3.2 Phase 2 Implications

**Critical:** When extracting `corex-strategy-engine`, the `SignalProcessingEngine` moves with it. The Socket_X path (`SocketXRiskEngine`) must continue to call into it. Two options:

1. **Keep `SocketXRiskEngine` in `engine/core/pipeline/`** — it's a thin adapter, not strategy logic.
2. **Move `SocketXRiskEngine` to `corex-gateway`** — but this creates a dependency from gateway → strategy-engine.

**Recommendation:** Keep `SocketXRiskEngine` in `engine/core/pipeline/` (or move to a shared location). The injection pattern already decouples the risk check from the caller.

---

## 4. Proposed Extraction Order

### 4.1 Dependency Inbound Count

| Domain | Inbound Dependencies | Outbound Dependencies |
|--------|---------------------|----------------------|
| **Strategy** | 0 (nothing depends on strategy engines directly) | Execution (runPipeline→enqueue), Portfolio (reads broker state) |
| **Execution** | Strategy (runPipeline calls enqueue) | Portfolio (broker.execute updates positions) |
| **Portfolio** | Strategy (reads positions/equity), Execution (broker.execute) | 0 (no inbound reads from strategy) |

### 4.2 Recommended Order

**1. Extract `corex-portfolio` FIRST**

Justification:
- Fewest inbound dependencies (only reads, no outbound calls)
- `tradeHistoryService.js` and `brokerPersistence.js` are already partially decoupled (event-driven persistence)
- Positions/P&L are accessed via broker instance (in corex-broker-contract), so portfolio package primarily needs:
  - Trade history CRUD
  - Equity analytics calculations
  - Broker settings persistence
- No strategy or execution code calls into portfolio directly — all interaction is through broker instance

**2. Extract `corex-strategy-engine` SECOND**

Justification:
- Contains the pipeline engines (Generation, Processing, Execution orchestration)
- After portfolio extraction, strategy only depends on:
  - Broker instance (in corex-broker-contract) for position/equity data
  - Execution engine (which stays in strategy package initially)
- `runPipeline.js` is the orchestrator — it must move with the engines it orchestrates

**3. Extract `corex-execution` THIRD (or merge with strategy)**

Justification:
- `SignalExecutionEngine` is currently called directly by `runPipeline.js`
- `liveOrderDispatcher.js` is a standalone service (already decoupled)
- Two options:
  - **Option A:** Keep execution in strategy package (tight coupling with runPipeline)
  - **Option B:** Extract separately, make runPipeline emit events instead of direct calls
- **Recommendation:** Option B — extract separately, use events for strategy→execution handoff. This enables independent scaling of execution workers.

### 4.3 Alternative: Merge Strategy + Execution

Given the tight coupling between `runPipeline.js` and `SignalExecutionEngine`, consider:

- **Single `corex-strategy-engine` package** containing Generation + Processing + Execution
- **Separate `corex-execution` package** only for `liveOrderDispatcher.js` (standalone, already decoupled)

This avoids introducing event-driven complexity for the hot path (strategy→execution is synchronous by design).

---

## 5. Event-Driven vs Direct Call Recommendations

### 5.1 Strategy → Execution

| Current | Recommendation | Rationale |
|---------|----------------|-----------|
| `runPipeline.js` directly calls `SignalExecutionEngine.enqueue()` | **Stay direct** (if same package) or **Event-driven** (if separate packages) | Hot path — synchronous enqueue is intentional for backpressure. If extracted separately, use `EVENTS.STRATEGY.SIGNAL_EXECUTED`. |

### 5.2 Strategy → Portfolio

| Current | Recommendation | Rationale |
|---------|----------------|-----------|
| `SignalGenerationEngine` reads `broker.getPositionSnapshot()` | **Stay direct** | Broker instance is already in corex-broker-contract. Strategy needs synchronous position data for signal generation. |
| `SignalProcessingEngine` reads `broker.getEquity()` | **Stay direct** | Risk check needs synchronous equity data. Cannot be async. |

### 5.3 Execution → Portfolio

| Current | Recommendation | Rationale |
|---------|----------------|-----------|
| `broker.execute()` updates positions internally | **Stay direct** | Broker owns its position state. Execution calls broker methods directly. |
| `brokerPersistence.js` listens on `EVENTS.BROKER.STATE_CHANGED` | **Already event-driven** | No change needed. |

### 5.4 Strategy → Risk (Socket_X path)

| Current | Recommendation | Rationale |
|---------|----------------|-----------|
| `SocketXRiskEngine` calls `SignalProcessingEngine.validateForCommand()` | **Stay direct** | Thin adapter pattern. Keep SocketXRiskEngine in engine/core/pipeline or move to corex-gateway. |

### 5.5 Summary Table

| Interaction | Current | After Extraction | Mechanism |
|-------------|---------|------------------|-----------|
| Strategy → Execution | Direct call | Direct (same package) or Event (separate) | `enqueue()` or `EVENTS.STRATEGY.SIGNAL_EXECUTED` |
| Strategy → Portfolio | Direct read | Direct read | Broker instance methods |
| Execution → Portfolio | Direct call | Direct call | Broker instance methods |
| Portfolio → Persistence | Event | Event (no change) | `EVENTS.BROKER.STATE_CHANGED` |
| Socket_X → Risk | Direct call | Direct call (no change) | `SignalProcessingEngine.validateForCommand()` |

---

## 6. Open Decisions for Owen

1. **Strategy + Execution merge?** — Keep as single `corex-strategy-engine` package (simpler, preserves synchronous hot path) or separate packages (more modular, requires event-driven handoff)?

2. **Portfolio scope?** — Does `corex-portfolio` own trade history + equity analytics only, or also position tracking (currently in broker instances)?

3. **RuntimeRegistry location?** — Currently in `engine/core/runtime/`. Stays in engine (composition root) or moves to one of the new packages?

4. **runPipeline.js location?** — Orchestrator function. Moves with strategy-engine or stays in engine as composition root?

---

## 7. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `SignalProcessingEngine` shared between strategy and Socket_X paths | High if extracted incorrectly | Keep `validateForCommand()` as public API; don't duplicate risk logic |
| `runPipeline.js` tightly couples Generation + Processing + Execution | Medium | Extract all three together, or introduce event bus between them |
| `RuntimeRegistry` is shared mutable state | Medium | Keep in engine/ as composition root; don't duplicate |
| `broker.getPositionSnapshot()` called synchronously by strategy | Low | Broker stays in corex-broker-contract; strategy reads via instance reference |
| Worker pool (`strategyWorker.js`) holds `activeStrategies` Map | Low | Worker is implementation detail; stays with strategy-engine |

---

## 8. Core Principle

> **Extract toward the target architecture, not away from the current coupling. The goal is three packages that own distinct business capabilities, connected by events where async is natural and direct calls where sync is required. Don't force event-driven on the hot path just for modularity.**