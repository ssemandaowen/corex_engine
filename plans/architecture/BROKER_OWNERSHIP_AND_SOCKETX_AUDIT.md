# Broker Ownership & Socket_X Integration Audit

> Date: 2026-11-14
> Branch: `fix/upload-multipart-transport`
> Task: `plans/tasks/P3-04-broker-ownership-cleanup.md`
> Scope: verified broker-folder cleanup and evidence collection. No new execution authority was implemented.

## 1. Baseline

- Baseline commit before this task: `b7cf611`.
- The working tree already contained unrelated uncommitted user changes (backtest report persistence, job worker, strategy compiler, security, user scope, frontend lockfile). Those were preserved and not reverted.
- Baseline tests:
  - `packages/corex-broker-contract`: 10 suites / 156 tests passed.
  - Root targeted broker suites: 5 passed; `test/runtime-lifecycle-provider.test.js` had 1 pre-existing failure (`reattemptWarmup` recovery).

## 2. `/broker` inventory and classification

| File | Real responsibility | Classification | Disposition |
|---|---|---|---|
| `broker/base/BaseBroker.js` | one-line forwarder | REMOVE | deleted |
| `broker/base/BrokerContract.js` | one-line forwarder | REMOVE | deleted |
| `broker/connectors/MetaApiConnector.js` | one-line forwarder | REMOVE | deleted |
| `broker/connectors/MT5MQL5Connector.js` | one-line forwarder | REMOVE | deleted |
| `broker/modes/BacktestBroker.js` | one-line forwarder | REMOVE | deleted |
| `broker/modes/LiveBroker.js` | one-line forwarder | REMOVE | deleted |
| `broker/modes/PaperBroker.js` | one-line forwarder | REMOVE | deleted |
| `broker/backtest/BacktestFeed.js` | second replay implementation; no consumers | REMOVE | deleted |
| `broker/backtest/SignalGenerationEngine.js` | duplicate signal engine; no consumers | REMOVE | deleted |
| `broker/twelvedata.js` | legacy market-data forwarding entry | REMOVE | deleted; consumers use `corex-market-data` |
| `broker/liveStore.js` | user/mode status lookup (broken key format) | CONSOLIDATE | replaced by `runtimeService.getBrokerForMode` |
| `broker/paperStore.js` | user/mode status lookup (broken key format) | CONSOLIDATE | replaced by `runtimeService.getBrokerForMode` |
| `broker/CorexReceiver.mq5` | MT5 HTTP-polling Expert Advisor | REQUIRES DECISION | kept; transport choice pending |

Additional forwarding shims found outside `/broker` and removed:

| File | Forwarded to | Disposition |
|---|---|---|
| `engine/services/mt5Bridge.js` | `corex-broker-contract/src/mt5Bridge` | deleted; consumers use `corex-broker-contract` |
| `engine/core/runtime/RuntimeBrokerFactory.js` | `corex-broker-contract/src/RuntimeBrokerFactory` | deleted; `RuntimeLifecycle` uses the package API |
| `engine/core/runtime/MarketFeed.js` | `corex-market-data/src/MarketFeed` | deleted; consumers use `corex-market-data` |

## 3. Consumer / import mapping

| Old import | New import |
|---|---|
| `@broker/twelvedata` | `require("@data").legacyMarketData` (application); `../legacy/twelvedata` (inside market-data package) |
| `@broker/modes/BacktestBroker` | `require("corex-broker-contract").BacktestBroker` |
| `@broker/modes/PaperBroker` | `require("corex-broker-contract").CoreXPaperDriver` |
| `@broker/modes/LiveBroker` | `require("corex-broker-contract").MetaApiDriver` |
| `@broker/base/BaseBroker` | `require("corex-broker-contract").BaseBroker` |
| `@broker/paperStore` / `@broker/liveStore` | `runtimeService.getBrokerForMode(mode, userId)` |
| `@core/services/mt5Bridge` | `require("corex-broker-contract").mt5Bridge` |
| `@core/core/runtime/MarketFeed` | `require("corex-market-data").MarketFeed` |
| `corex-broker-contract/src/**` (package-internal cross-imports) | `require("corex-broker-contract")` public API |

## 4. Package ownership decisions

1. `corex-broker-contract` owns `BrokerContract`, `BaseBroker`, drivers, connectors, modes, `RuntimeBrokerFactory`, MT5 bridge and fill/symbol utilities. Its public API is `index.js`.
2. `corex-market-data` owns the legacy TwelveData singleton implementation, `MarketFeed`, providers, factory and backtest data resolution. The legacy singleton is exposed as `legacyMarketData`.
3. `engine/` owns application orchestration: runtime lifecycle, registry, pipeline, routes, broadcaster and the in-process broker lookup used by system routes.
4. `corex-gateway` owns Socket_X protocol/connection/account model and consumes `corex-broker-contract` through its public API.

Package entry-point correction:

- `packages/corex-broker-contract/package.json` `main` changed from `src/mt5Bridge.js` to `index.js`.
- Root `_moduleAliases` and Jest now resolve `corex-broker-contract` to the package root; internal `src/` imports were removed from application and package consumers.

## 5. Execution maps

### 5.1 Strategy → broker

`strategyLoader.startStrategy` → `RuntimeLifecycle.boot` → `RuntimeBrokerFactory.createBroker(mode, {runtimeId, symbol, userId,...})` → `BacktestDriver` / `CoreXPaperDriver` / `MetaApiDriver` → `RuntimeRegistry.set(runtimeId, {instance, broker})`.

Market data: provider → `MarketFeed` → runtime instance. Signal path: `MarketFeed` → `runPipeline` → `SignalGenerationEngine` → `SignalProcessingEngine` (risk) → `SignalExecutionEngine` → `broker.execute/handle`.

### 5.2 Backtest → broker

`jobWorker` → `backtestRun` → `backtestManager.run(strategy, options)` → `new BacktestBroker(...)` (alias of `BacktestDriver`) → `_runSimulation`. `BacktestFeed` is not used. This is a separate construction path from `RuntimeBrokerFactory`; documented as remaining debt.

### 5.3 Manual execution → broker

There is no generic HTTP manual-order route that constructs a broker. `RiskGateway.submit()` is the Socket_X command path; it uses a registered broker or creates a new one via `RuntimeBrokerFactory`. The MT5 HTTP route consumes rows already persisted in `orders` and does not call the broker factory.

### 5.4 Socket_X → risk → broker

`SocketXServer` (library) → `RiskGateway.submit` → injected `SocketXRiskEngine` → `SignalProcessingEngine.validateForCommand` → `broker.handle`.

### 5.5 MT5 receiver → broker

Two independent transports exist:

1. **HTTP polling**: `broker/CorexReceiver.mq5` polls `GET /api/mt5/next-order`, executes in MT5, then posts `/api/mt5/confirm-fill`. Orders come from the `orders` table; `engine/routes/mt5Controller.js` owns the contract. Heartbeats use `/api/bridge/heartbeat`.
2. **WebSocket**: `engine/managers/mt5Receiver.py` connects to `/mt5`; `packages/corex-broker-contract/src/mt5Bridge.js` sends `order_request` frames; `engine/services/liveOrderDispatcher.js` dispatches `orders` rows with `environment='LIVE'` through `openPosition`/`closePosition`.

`MT5MQL5Connector` is a driver-level connector and is only selected when `connectorType` is `mt5`/`mt5mql5`; it is not the transport used by `liveOrderDispatcher`.

### 5.6 Broker events → application bus → frontend

Driver emits `EVENTS.ORDER.*` / `EVENTS.BROKER.*` on `@events/bus`; `engine/services/broadcaster.js` maps bus events to WebSocket frames on `/ws`.

## 6. Socket_X integration gaps

1. `SocketXServer` is never instantiated or mounted. `engine/server.js` only handles `/ws` and `/mt5` upgrades; no `/socketx` endpoint exists.
2. `engine/core/engine.js` wires `RiskGateway.setRiskEngine(SocketXRiskEngine)` and the auth verifier, but never registers strategy-runtime brokers with `RiskGateway.registerBroker(runtimeId, broker)`.
3. If Socket_X were mounted, `RiskGateway` would create a second broker for the account/mode via `RuntimeBrokerFactory`, independent of `RuntimeRegistry`. That is a separate execution authority and a duplicate broker instance risk.
4. Socket_X `accountId` (`cx_pap_*` / `cx_liv_*`) is a different namespace from strategy `runtimeId`; no mapping/resolution layer exists.
5. No outbound fill/position event bridge from `RiskGateway`/driver to Socket_X clients is mounted in the application.
6. `RiskGateway` still has a default risk fallback in test environments; production throws if no engine is injected. This is intentional but means mounting requires the engine wiring to be present.
7. `SignalProcessingEngine` risk limits (`maxDrawdownThresholdPct=10`, `maxDailyLossLimit=2500`) are hardcoded in the engine pipeline; the gateway default uses broker config `maxDrawdownPct` or 10%. This is duplicate risk policy and should be reconciled when the execution authority is designed.

## 7. MT5 findings

Confirmed and fixed in this task:

- `MT5MQL5Connector` called `mt5Bridge.sendOrderRequest()`, which does not exist. It now calls `openPosition` / `closePosition`.
- The connector checked `response.retcode`, but the WS bridge/receiver contract returns `{status:"executed", ticket, id}`. It now maps that contract.
- `mt5Bridge.openPosition/closePosition/closeAllPositions` sent action strings (`openPosition`, `closePosition`, `closeAllPositions`) that the Python receiver normalizes to `OPENPOSITION`, `CLOSEPOSITION`, `CLOSEALLPOSITIONS`; only `OPEN`, `CLOSE`, `CLOSEALL` are accepted. The wrappers now send the accepted actions.
- `MetaApiDriver` always constructed `MetaApiConnector` and ignored `connectorType`. It now selects `MetaApiConnector` or `MT5MQL5Connector` based on `connectorType`.

Confirmed but not fixed (requires Owen's decision / real credentials):

- `MetaApiConnector` is a skeleton: `executeOrder()` returns `success: true` with a synthetic order id and does not place a trade. This is unsafe for LIVE and is not production-ready.
- The HTTP polling EA and the Python WS receiver are two independent MT5 protocols. Neither has been verified end-to-end against a real terminal in this task.
- `engine/routes/mt5Controller.js` and `bridgeController.js` use different token sources (`COREX_MT5_HTTP_TOKEN` vs `MT5_BRIDGE_TOKEN`) and different terminal-identity models.
- `MetaApiDriver` cannot be verified without Owen's MetaAPI token/MT5 credentials.

## 8. Remaining debt

- `backtestManager` constructs `BacktestDriver` directly instead of via `RuntimeBrokerFactory`.
- `RuntimeLifecycle.reattemptWarmup()` reads `entry.strategyInstance`, but `RuntimeRegistry` stores `entry.instance`; warmup recovery always returns false (pre-existing failing test).
- `SignalProcessingEngine` hardcoded risk limits duplicate gateway defaults.
- Socket_X is not mounted; execution authority remains fragmented.
- `broker/CorexReceiver.mq5` transport choice is unresolved.
- `MetaApiConnector` is not a real connector.

## 9. Tests executed

| Command | Result |
|---|---|
| `npx jest --config packages/corex-broker-contract/package.json --rootDir packages/corex-broker-contract --runInBand --forceExit` | 12 suites / 165 tests passed |
| `npx jest --config packages/corex-gateway/package.json --rootDir packages/corex-gateway --runInBand --forceExit` | 3 suites / 85 tests passed |
| `npx jest --config packages/corex-market-data/package.json --rootDir packages/corex-market-data --runInBand --forceExit` | 6 suites / 70 tests passed |
| `npx jest --config packages/corex-strategy-engine/package.json --rootDir packages/corex-strategy-engine --runInBand --forceExit` | 10 suites / 87 tests passed |
| `npx jest --config packages/corex-portfolio/package.json --rootDir packages/corex-portfolio --runInBand --forceExit` | 2 suites / 12 tests passed |
| Root targeted broker/runtime suites (8 files) | 7 suites passed, 1 pre-existing failure (`runtime-lifecycle-provider` recovery test) |
| `node --check` on all changed JS files | passed |

Lint: `eslint` is not installed in the repository and there is no `lint` script; lint could not be executed. `node --check` was used instead.

## 10. Follow-up tasks

1. Decide MT5 transport: retire the HTTP polling EA in favour of the Python WS receiver, or formalize both with a shared transport contract.
2. Replace or delete `MetaApiConnector`; do not allow LIVE mode until a real connector is verified.
3. Design the single application execution authority and wire Socket_X to it, including `RiskGateway.registerBroker` for strategy runtimes and an accountId↔runtime mapping.
4. Fix `RuntimeLifecycle.reattemptWarmup` to use `entry.instance`.
5. Move backtest broker construction behind `RuntimeBrokerFactory` or document why backtest intentionally owns its own driver.