# Package Ownership Audit

## Current Structure

CoreX is currently in an active state of modularization. Seven domain packages have been extracted into `packages/`:

1. `packages/corex-accounts` (Account creation, trading account credentials, persistence)
2. `packages/corex-auth` (JWT tokens, password hashing, auth verification)
3. `packages/corex-broker-contract` (BaseBroker, broker modes, drivers, execution adapters)
4. `packages/corex-gateway` (Socket_X WebSocket protocol, connection lifecycle, risk gateway)
5. `packages/corex-market-data` (DataProviderFactory, TwelveData, YahooFinance, OANDA)
6. `packages/corex-portfolio` (Trade history service, order fill listeners, PnL analytics)
7. `packages/corex-strategy-engine` (Strategy execution base class, 50 indicators, ContextBuilder)

However, significant amounts of legacy code remain in root directories (`utils/`, `engine/`, `broker/`), creating backwards imports from extracted packages into root folders.

---

## Proposed Ownership

| Current Path | Proposed Owner | Classification | Reason |
|--------------|-----------------|----------------|--------|
| `utils/logger.js` | `utils/logger.js` | `KEEP` | Genuine domain-neutral logging utility wrapper (Winston) |
| `utils/linkedList.js` | `utils/linkedList.js` | `KEEP` | Genuine domain-neutral $O(1)$ doubly linked list data structure |
| `utils/data/fastQueue.js` | `utils/data/fastQueue.js` | `KEEP` | Genuine domain-neutral bounded ring-buffer queue |
| `utils/metrics.js` | `utils/metrics.js` | `KEEP` | Genuine domain-neutral CPU/memory/event-loop metrics collector |
| `utils/BaseStrategy.js` | `packages/corex-strategy-engine` | `MOVE` | Abstract strategy base class; belongs in strategy engine package |
| `utils/DeclarativeStrategy.js` | `packages/corex-strategy-engine` | `SHIM` | Re-export shim pointing to `corex-strategy-engine` |
| `utils/security.js` | `packages/corex-strategy-engine` | `MOVE` | Acorn AST scanner specifically validating user strategy code |
| `utils/analytics.js` | `packages/corex-portfolio` | `MOVE` | Sharpe, Sortino, max drawdown, win rate, expectancy calculations |
| `utils/stateController.js` | `engine/core/` | `MOVE` | CoreX application engine state machine |
| `utils/storageManager.js` | `engine/services/` | `MOVE` | Local backtest JSON file persistence manager |
| `utils/strategy/Position.js` | `packages/corex-strategy-engine` | `SHIM` | Shim re-exporting `Position` from strategy engine |
| `utils/strategy/StrategyIntrospection.js` | `packages/corex-strategy-engine` | `SHIM` | Shim re-exporting `StrategyIntrospection` |
| `utils/strategy/StrategyPositionManager.js` | `packages/corex-strategy-engine` | `SHIM` | Shim re-exporting `StrategyPositionManager` |
| `utils/strategy/StrategyRuntimeUtils.js` | `packages/corex-strategy-engine` | `SHIM` | Shim re-exporting `StrategyRuntimeUtils` |
| `utils/strategy/StrategyManifest.js` | `packages/corex-strategy-engine` | `MOVE` | Strategy schema parser and Monaco IDE IntelliSense manifest |
| `utils/strategy/StrategyValidator.js` | `packages/corex-strategy-engine` | `MOVE` | Strategy schema and AST input validator |
| `utils/strategy/StrategyParamUtils.js` | `packages/corex-strategy-engine` | `MOVE` | Strategy parameter parsing, validation, and patch application |
| `utils/strategy/StrategyStateStore.js` | `packages/corex-strategy-engine` | `MOVE` | Key-value store for strategy state persistence |
| `utils/strategy/StrategyDataManager.js` | `packages/corex-strategy-engine` | `MOVE` | In-memory OHLCV candle circular buffer manager |
| `utils/strategy/IncrementalIndicators.js` | `packages/corex-strategy-engine` | `REPLACE` | Replaced by `IndicatorRegistry.js` in `corex-strategy-engine` |
| `utils/strategy/IndicatorAdapter.js` | `packages/corex-strategy-engine` | `MOVE` | Technical indicator wrapper |
| `utils/strategy/RuleChain.js` | `packages/corex-strategy-engine` | `MOVE` | Composable strategy rule evaluation chain |
| `utils/strategy/SoACandleStore.js` | `packages/corex-strategy-engine` | `MOVE` | Structure-of-Arrays candle store |
| `utils/strategy/StrategyDevHelpers.js` | `packages/corex-strategy-engine` | `MOVE` | Developer diagnostic helpers for strategies |
| `utils/strategy/StrategySignalUtils.js` | `packages/corex-strategy-engine` | `MOVE` | Signal generation utility functions |
| `broker/modes/*` | `packages/corex-broker-contract` | `SHIM` | Mode shims re-exporting from `@broker/corex-broker-contract` |
| `broker/base/*` | `packages/corex-broker-contract` | `SHIM` | Base broker shims re-exporting from `@broker/corex-broker-contract` |
| `broker/connectors/*` | `packages/corex-broker-contract` | `SHIM` | Connector shims re-exporting from `@broker/corex-broker-contract` |
| `broker/liveStore.js` | `packages/corex-accounts` | `MOVE` | Live account credentials store |
| `broker/paperStore.js` | `packages/corex-accounts` | `MOVE` | Paper account state store |
| `broker/twelvedata.js` | `packages/corex-market-data` | `MOVE` | Legacy TwelveData bridge file imported by `@broker/twelvedata` |

---

## Dependency Problems

Static import graph analysis across 264 JS source files revealed the following cross-boundary dependency problems:

1. **Package → Root Engine Leakage (`packages/*` → `engine/` / `@core/`):**
   - `packages/corex-accounts/src/brokerPersistenceService.js` imports `@core/services/pgStore`.
   - `packages/corex-accounts/src/connectionsService.js` imports `@core/services/secretsVault`.
   - `packages/corex-broker-contract/src/mt5Bridge.js` imports `@core/services/postgres`.
   - `packages/corex-market-data/src/legacy/twelvedata.js` imports `@core/services/configService`.
   - `packages/corex-strategy-engine/src/Strategy.js` imports `@core/core/strategy/StrategyContract`.
   *Problem:* Lower-level domain packages import application orchestration singletons from `engine/`.

2. **Package → Root Utils Leakage (`packages/*` → `utils/`):**
   - Extracted packages rely heavily on `@utils/logger` (35 call sites across packages).
   - `packages/corex-broker-contract/src/base/BaseBroker.js` imports `@utils/strategy/StrategyPositionManager`.
   - `packages/corex-strategy-engine/src/ParamSchema.js` imports `@utils/strategy/StrategyParamUtils`.

3. **Inter-Package Relative Paths:**
   - `packages/corex-market-data/src/providers/FileDataProvider.js` imports `../../../corex-broker-contract/src/utils/SymbolNormalizer` via relative path traversal rather than scoped package exports.

---

## Legacy Shims

The repository contains two categories of legacy shims:

1. **Strategy Shims (`utils/strategy/*.js`):**
   - `utils/strategy/Position.js` → re-exports `packages/corex-strategy-engine/src/Position.js`
   - `utils/strategy/StrategyIntrospection.js` → re-exports `packages/corex-strategy-engine/src/StrategyIntrospection.js`
   - `utils/strategy/StrategyPositionManager.js` → re-exports `packages/corex-strategy-engine/src/StrategyPositionManager.js`
   - `utils/strategy/StrategyRuntimeUtils.js` → re-exports `packages/corex-strategy-engine/src/StrategyRuntimeUtils.js`
   - `utils/DeclarativeStrategy.js` → re-exports `packages/corex-strategy-engine/index.js`

2. **Broker Shims (`broker/*.js`):**
   - `broker/modes/BacktestBroker.js` → re-exports `packages/corex-broker-contract/src/modes/BacktestBroker.js`
   - `broker/modes/PaperBroker.js` → re-exports `packages/corex-broker-contract/src/modes/PaperBroker.js`
   - `broker/modes/LiveBroker.js` → re-exports `packages/corex-broker-contract/src/modes/LiveBroker.js`

---

## Duplicate Implementations

1. **Technical Indicators:**
   - `utils/strategy/IncrementalIndicators.js` vs `packages/corex-strategy-engine/src/indicators/`. `IncrementalIndicators.js` should be deprecated in favor of `IndicatorRegistry`.
2. **Strategy Introspection:**
   - `engine/services/strategyCompiler.js` and `utils/strategy/StrategyIntrospection.js` both inspect strategy class methods and parameter annotations.

---

## corex-strategy-engine Dependencies

Legacy dependencies currently imported by `packages/corex-strategy-engine`:

1. `@utils/logger` (`src/Strategy.js`): Logger interface for strategy instance logging.
2. `@config/constants` (`src/Strategy.js`, `src/StrategyDataManager.js`, `src/StrategyRuntimeUtils.js`): Trading intents (`INTENTS`), order sides (`SIDES`), and default history capacity constants.
3. `@core/core/strategy/StrategyContract` (`src/Strategy.js`): Method adaptation (`adapt()`) for backwards compatibility with legacy strategy class syntax (`next()`, `onBar()`, `onTick()`).
4. `@utils/strategy/StrategyParamUtils` (`src/ParamSchema.js`): Strategy parameter definition parsing and validation.

---

## Recommended Migration Order

To safely complete modularization without breaking runtime behavior:

1. **Step 1: Move Strategy Validation & Schema Utilities into `corex-strategy-engine`**
   - Move `StrategyValidator.js`, `StrategyManifest.js`, `StrategyParamUtils.js` into `packages/corex-strategy-engine/src/validation/`.
   - Leave 1-line re-export shims in `utils/strategy/`.

2. **Step 2: Move Strategy Security Scanner into `corex-strategy-engine`**
   - Move `utils/security.js` into `packages/corex-strategy-engine/src/security.js`.
   - Re-export shim in `utils/security.js`.

3. **Step 3: Decouple Database Connection Injection in `corex-accounts` and `corex-broker-contract`**
   - Replace direct imports of `@core/services/postgres` or `@core/services/pgStore` with injected database pool parameters.

4. **Step 4: Deprecate `utils/strategy/IncrementalIndicators.js`**
   - Update any remaining callers to use `IndicatorRegistry` from `corex-strategy-engine`.

---

## Risks

1. **Dynamic Strategy Loading:** `strategyCompiler.js` dynamically compiles user code string imports. Changing module resolution aliases or removing shims in `utils/strategy/` could break third-party user strategies that import relative paths.
2. **Database Connection Coupling:** Extracted packages currently import global database singletons from `@core/services/postgres`. Refactoring database access requires injecting pool parameters across all controller wiring.
3. **Module Alias Mapping:** Monaco IDE in the frontend relies on `utils/strategy/StrategyManifest.js` for auto-complete. Any file relocation must update `scripts/sync-strategy-manifest.js` and path aliases in `package.json`.

---
