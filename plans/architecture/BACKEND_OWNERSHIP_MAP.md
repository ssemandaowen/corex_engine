# Backend Ownership and Dependency Map — CoreX (P0-02)

## 1. Audit metadata

- **Date:** 2026-10-31
- **Investigator:** Kilo Code
- **Branch:** `audit/p0-02-backend-ownership`
- **Base commit (P0-01 accepted):** `637056feaeddb2800a58d4b2c85a469fff970125` (origin/audit/p0-01-repository-baseline)
- **Working tree:** Clean at start (worktree at `C:\Users\SBUM\Desktop\corex-p0-02-backend`)
- **Scope:** Read-only backend ownership/dependency audit. No source edits.

## 2. Executive summary

Backend is a Node.js/Express monolith with 7 extracted packages under `packages/` and a large legacy surface in `engine/`, `broker/`, `utils/`, `config/`, `events/`. Transport entry is `engine/server.js` (10 controllers mounted at `/api/*`). Orchestration lives in `index.js` → `engine/core/engine.js` + `engine/server.js`. Critical domains (strategy, broker contract, market data, auth, accounts, portfolio, gateway) have been partially extracted into packages; `engine/` still hosts backtest, execution, persistence, workers, and most services. Several large files (>30k lines) concentrate ownership (systemController 44k, backtestManager 43k, backtestController 43k, executionController 35k, broadcaster 34k). A dangling `@strategies` alias targets a missing root `strategies/` directory (verified). No circular-dependency tooling was run; suspected cycles noted.

## 3. Backend entry points and transport

- `index.js` — bootstrap: aliases, env, requires `@core/core/engine`, `@core/server`, services, workers.
- `engine/server.js` — Express app, middleware, mounts 10 controllers: `/api/auth`, `/api/strategies`, `/api/run`, `/api/backtest`, `/api/system`, `/api/bridge`, `/api/mt5`, `/api/settings`, `/api/accounts`, `/api/data`.
- `engine/core/engine.js` — engine singleton (30,070 bytes).
- `scripts/menu.js` — operational entry (`npm run menu`).

## 4. Domain / file ownership table

| Area | Primary files (observed) | Owner (observed) | Notes |
|------|--------------------------|------------------|-------|
| Transport/controllers | `engine/routes/*Controller.js` (10) | engine (legacy) | Large files; mixed orchestration + domain logic suspected |
| Engine core | `engine/core/engine.js`, `engine/core/runtime/*`, `engine/core/lifecycle/*`, `engine/core/loader/*`, `engine/core/pipeline/*`, `engine/core/data/*`, `engine/core/strategy/*` | engine | Runtime registry, lifecycle, strategy loader, pipelines |
| Services | `engine/services/*` (25 files) | engine | pgStore, postgres, configService, broadcaster, jobQueue, etc. |
| Workers | `engine/workers/jobWorker.js`, `strategyWorker.js`, `engine/workers/jobs/*` | engine | Job processing |
| Backtest | `engine/backtestManager.js` (42,839 bytes), `engine/routes/backtestController.js` | engine (legacy) | Large; backtest limit enforced at 3 gates (protected) |
| Strategy package | `packages/corex-strategy-engine/` | package | Strategy, context, params, indicators, data, position, state, plotting, validation |
| Market data package | `packages/corex-market-data/` | package | Data provider contract + providers |
| Broker contract package | `packages/corex-broker-contract/` | package | BrokerContract, BaseBroker, RuntimeBrokerFactory, SymbolNormalizer |
| Gateway package | `packages/corex-gateway/` | package | Gateway |
| Auth package | `packages/corex-auth/` | package | AuthService, secrets vault |
| Accounts package | `packages/corex-accounts/` | package | Accounts |
| Portfolio package | `packages/corex-portfolio/` | package | Portfolio |
| Legacy broker | `broker/` | legacy | MetaApi etc.; duplicated with packages |
| Utils | `utils/` | mixed | Domain-specific code suspected (per AGENTS.md) |
| Config | `config/` | mixed | Configuration modules |
| Events | `events/` | mixed | Event bus |
| Persistence | `engine/services/pgStore.js`, `postgres.js`, `db/migrate.js`, `schema.sql` | engine/db | Protected migrations |
| MT5 bridge | `engine/managers/mt5Receiver.py`, `engine/services/mt5Bridge.js`, `engine/routes/mt5Controller.js`, `engine/routes/bridgeController.js` | engine | Python receiver + Node bridge |

## 5. Critical flow traces

- **Startup:** `index.js` → module-alias register → dotenv → require `@core/core/engine`, `@core/server` → services → jobWorkerSupervisor, dataCuller, liveOrderDispatcher, strategyRuntime. Migrations run via `db/migrate` require.
- **Strategy lifecycle:** `engine/core/strategy/StrategyContract.js`, `engine/strategyLoader.js`, `engine/core/loader/StrategyLoader.js`, `packages/corex-strategy-engine`. Lazy on-demand loading (protected). SHA256-keyed cache.
- **Market data:** `engine/core/data/providers/TwelveDataProvider.js`, `packages/corex-market-data` (DataProviderContract), `engine/services/historicalCache.js`, `engine/services/marketStatus.js`.
- **Broker connection:** `engine/core/runtime/RuntimeBrokerFactory.js`, `packages/corex-broker-contract`, `broker/` legacy, `engine/services/brokerPersistence.js`, `engine/services/mt5Bridge.js`.
- **Execution/order handling:** `engine/routes/executionController.js` (35k), `engine/core/pipeline/*` (SignalGeneration/Execution/Processing), `engine/services/liveOrderDispatcher.js`, `engine/services/tradeHistoryService.js`.
- **Backtest lifecycle:** `engine/routes/backtestController.js`, `engine/backtestManager.js`, `engine/services/backtestService.js`, `engine/core/backtestDataResolver.js`. 5000-candle limit at 3 gates (protected).
- **Persistence:** `engine/services/postgres.js`, `pgStore.js`, `db/migrate.js`, `schema.sql`, `engine/services/jobQueue.js`, `engine/services/brokerPersistence.js`, `engine/services/userEngineSettingsService.js`, `engine/services/connectorSettingsService.js`.

## 6. Package consumers and alias usage

- Module aliases defined in root `package.json` `_moduleAliases` and Jest `moduleNameMapper`.
- `@strategies` alias points to missing root `strategies/` (verified dangling).
- `@broker/*` aliases split between `packages/` (corex-broker-contract, corex-gateway) and legacy `broker/`.
- `@data/*` → `packages/corex-market-data`.
- `@auth/*` → `packages/corex-auth`.
- `@portfolio/*` → `packages/corex-portfolio`.
- `corex-strategy-engine` → `packages/corex-strategy-engine/index.js`.
- Deep imports observed into package internals (e.g., `@broker/RuntimeBrokerFactory` → `packages/.../src/RuntimeBrokerFactory`). Suspected public-API bypass; not fully traced (unknown).

## 7. Large files, singletons, circular dependencies

- Large files (>30k bytes): systemController (44k), backtestManager (43k), backtestController (43k), executionController (35k), broadcaster (34k), engine.js (30k). High fan-in / mixed responsibilities (suspected).
- Singletons: `engine` module, `pgStore`, `configService`, `RuntimeRegistry`, `RuntimeLifecycle`, `broadcaster`. Mutable shared state; recoverability implications (suspected; not traced).
- Circular dependencies: not tool-verified. Suspected cycles: strategy → utils → engine → broker → strategy (per AGENTS.md). Unknown until tooling run.

## 8. Duplicate implementations

- Broker: `broker/` legacy vs `packages/corex-broker-contract` + `packages/corex-gateway`. Parity not verified (unknown).
- Strategy data/position/state: legacy in `engine/` and `utils/` vs `packages/corex-strategy-engine`. Parity not verified (unknown).
- Market data: `engine/core/data/providers/TwelveDataProvider.js` vs `packages/corex-market-data`. Parity not verified (unknown).
- Auth: `engine/services/authService.js` vs `packages/corex-auth`. Parity not verified (unknown).

## 9. Test ownership map

- Root tests: `test/*.test.js` (12 files) + `test/backtest/*`.
- Package tests: `packages/*/test/*`.
- Engine tests: `engine/test/*`, `engine/services/*` (connectorSettingsService test).
- Total baseline: 51 suites / 572 tests (P0-01 verified). Behavioral coverage gaps suspected for large controllers and workers (unknown).

## 10. Proposed dispositions (not implemented)

| Module | Proposed | Rationale | Migration risk |
|--------|----------|-----------|----------------|
| `packages/*` | KEEP (owner) | Already extracted; public API exists | Low |
| `engine/backtestManager.js`, `backtestController.js` | MOVE (to corex-backtest package) | Domain logic in engine | High (3 gates, 5000 limit) |
| `engine/routes/executionController.js` | MOVE/CONSOLIDATE | Mixed transport + domain | High (execution path) |
| `engine/services/broadcaster.js` | MOVE/CONSOLIDATE | Large; WS broadcasting | Medium |
| `broker/` | REPLACE (shim) | Duplicate of package | Medium (consumers unknown) |
| `utils/strategy/*` | MOVE to strategy package | Domain-specific | Medium |
| `utils/` domain-neutral primitives | KEEP | Genuinely neutral | Low |
| `engine/core/*` orchestration | KEEP (engine) | Orchestration owner | Low |
| `config/` | CONSOLIDATE | Config ownership unclear | Medium |

## 11. Unresolved decisions / follow-ups

- Trace deep imports into package internals (public API bypass).
- Run circular-dependency tooling.
- Verify broker/strategy/market-data parity between legacy and packages.
- Confirm whether `@strategies` alias consumers exist (dangling target).
- Decide ownership of `config/` and `utils/` domain-specific code.
- Large-file decomposition is a future task (not in P0-02 scope).

## 11a. Package consumer map (expanded evidence)

For each package, consumers are identified via grep across the repo (excluding node_modules). "Internal import" = direct require into `packages/<pkg>/src/...` or `packages/<pkg>/...` bypassing the package index.

| Package | Public entry | Observed consumers (files) | Internal (deep) imports | Direction |
|---------|--------------|---------------------------|------------------------|-----------|
| corex-strategy-engine | `packages/corex-strategy-engine/index.js` | `utils/DeclarativeStrategy.js` (require "corex-strategy-engine"); `engine/services/runtimeService.js` (`ParamSchema`); `engine/test/plotBroadcaster.test.js`; `packages/corex-gateway/test/*` (none observed); `utils/strategy/*` shims re-export from `packages/.../src/*` | Yes — `utils/strategy/*` shims require `../../packages/corex-strategy-engine/src/*`; tests require `@root/packages/.../src/...` | engine/utils/tests → package (shims invert to package internals) |
| corex-market-data | `packages/corex-market-data/index.js` | `engine/core/data/providers/TwelveDataProvider.js`, `engine/core/data/DataProviderContract.js`, `engine/core/data/backtestDataResolver.js`, `engine/core/runtime/MarketFeed.js`, `broker/twelvedata.js` (all shims re-exporting) | Yes — shims require `../../../packages/corex-market-data/src/...` | engine/broker → package (via shims) |
| corex-broker-contract | `packages/corex-broker-contract/index.js` (main: `src/mt5Bridge.js`) | `engine/core/runtime/RuntimeBrokerFactory.js`, `engine/services/mt5Bridge.js`, `broker/base/*`, `broker/modes/*`, `broker/connectors/*` (shims), `packages/corex-market-data/src/*`, `packages/corex-gateway/src/socketx/RiskGateway.js` | Yes — extensive deep imports into `src/base`, `src/modes`, `src/connectors`, `src/utils`, `src/RuntimeBrokerFactory` | many → package internals |
| corex-gateway | `packages/corex-gateway/index.js` | `engine/core/engine.js` (RiskGateway, SocketXServer); `engine/routes/settingsController.js` (TradingAccountRepository); `engine/test/settingsController.test.js` (jest.mock) | Yes — `engine/routes/settingsController.js` requires `../../packages/corex-gateway/src/account/TradingAccountRepository` | engine → package internals |
| corex-auth | `packages/corex-auth/index.js` | `engine/core/engine.js` (verifyToken); `engine/services/authService.js`, `secretsVault.js` (shims); `packages/corex-gateway/src/*` (AuthService) | Yes — shims require `../../packages/corex-auth/src/*`; gateway requires `../../../corex-auth/src/AuthService` | engine/gateway → package internals |
| corex-accounts | `packages/corex-accounts/index.js` | `engine/services/connectorSettingsService.js` (connectionsService, CONNECTOR_SCHEMAS); `engine/services/brokerPersistence.js` (shim); `engine/test/connectorSettingsService.test.js` (jest.mock) | Yes — `brokerPersistence.js` shim requires `../../packages/corex-accounts/src/brokerPersistenceService` | engine → package (shim + public) |
| corex-portfolio | `packages/corex-portfolio/index.js` | `engine/services/tradeHistoryService.js` (TradeHistoryService) | Yes — observed via `@portfolio/corex-portfolio` alias | engine → package |

Conclusion (verified): packages are consumed mostly through shims and deep imports; public index entry points are used only in a few places (`engine/core/engine.js`, `utils/DeclarativeStrategy.js`, `tradeHistoryService.js`). Most consumers bypass public APIs (suspected boundary violation; not fully traced).

## 11b. Critical flow traces (call sites)

- **Startup:** `index.js:1-40` requires `@core/core/engine` (engine.js), `@core/server` (server.js), then services (`@core/services/postgres`, `configService`, `integrationRuntime`, `dataCuller`, `liveOrderDispatcher`, `jobWorkerSupervisor`, `strategyRuntime`). Migrations via `require("./db/migrate")`. Routes mounted in `engine/server.js:54-73`.
- **Strategy lifecycle:** `engine/strategyLoader.js` (24,377 bytes) + `engine/core/loader/StrategyLoader.js`; `engine/core/strategy/StrategyContract.js`; `packages/corex-strategy-engine`. Lazy load (protected). SHA256-keyed cache (observed in docs; not verified here).
- **Market data:** `engine/core/data/providers/TwelveDataProvider.js` (shim → package), `engine/services/historicalCache.js`, `engine/services/marketStatus.js`, `packages/corex-market-data/src/DataProviderContract.js`, `DataProviderFactory.js`.
- **Broker connection:** `engine/core/runtime/RuntimeBrokerFactory.js` (shim → package), `engine/services/brokerPersistence.js` (shim → accounts package), `engine/services/mt5Bridge.js` (shim → package), `packages/corex-broker-contract/src/*`, legacy `broker/` shims.
- **Execution:** `engine/routes/executionController.js` (35,278 bytes) → `engine/core/pipeline/SignalGenerationEngine.js`, `SignalExecutionEngine.js`, `SignalProcessingEngine.js`, `SocketXRiskEngine.js`, `engine/services/liveOrderDispatcher.js`, `tradeHistoryService.js`.
- **Backtest:** `engine/routes/backtestController.js` (42,703 bytes) → `engine/backtestManager.js` (42,839 bytes) → `engine/services/backtestService.js` → `engine/core/backtestDataResolver.js` (shim → market-data package). 5000-candle limit at 3 gates (protected; not re-verified here).

## 11c. Singleton ownership (verified)

| Singleton | File:line | Mutable state | Consumers (observed) |
|-----------|-----------|---------------|----------------------|
| PgStore | `engine/services/pgStore.js:648` (`module.exports = new PgStore()`) | DB pool/cache | pgStore consumers across services (not fully traced) |
| RuntimeRegistry | `engine/core/runtime/RuntimeRegistry.js:190` | runtime map, plot intervals | `engine/core/engine.js`, broadcaster, strategy runtime |
| Broadcaster | `engine/services/broadcaster.js:787` | WS clients, buffers | engine, runtime |
| ConfigService | `engine/services/configService.js:190` (`module.exports = {...}` object) | config cache | many services (not fully traced) |
| RuntimeLifecycle | `engine/core/runtime/RuntimeLifecycle.js:324` (class export, instantiated elsewhere) | lifecycle state | engine |

Note: state-changing methods and full consumer lists not traced (unknown). Recoverability implications suspected, not verified.

## 11d. Duplicate implementations (parity unverified)

| Domain | Legacy location | Package location | Parity status |
|--------|-----------------|------------------|---------------|
| Broker | `broker/` (shims to package) | `packages/corex-broker-contract/` | Not verified (unknown) |
| Strategy data/position/state | `utils/strategy/*` (shims to package) | `packages/corex-strategy-engine/src/*` | Not verified (unknown) |
| Market data | `engine/core/data/providers/TwelveDataProvider.js`, `broker/twelvedata.js` (shims) | `packages/corex-market-data/` | Not verified (unknown) |
| Auth | `engine/services/authService.js`, `secretsVault.js` (shims) | `packages/corex-auth/` | Not verified (unknown) |
| Accounts | `engine/services/brokerPersistence.js` (shim) | `packages/corex-accounts/` | Not verified (unknown) |

Shims (`module.exports = require(...)`) mean legacy paths delegate to packages; whether behavior is identical is unverified (unknown).

## 11e. Disposition evidence (provisional)

Each proposal is provisional pending consumer/parity tracing (see §11, §11d).

| Module | Proposed | Evidence | Migration risk |
|--------|----------|----------|----------------|
| `packages/*` | KEEP (owner) | 7 packages with index.js/main; consumed by engine/utils/tests | Low |
| `engine/backtestManager.js` (42,839 bytes) | MOVE | Backtest domain logic in engine; backtestController 42,703 bytes | High (3 gates, 5000 limit) |
| `engine/routes/executionController.js` (35,278 bytes) | CONSOLIDATE | Transport + execution domain mixed | High (execution path) |
| `engine/services/broadcaster.js` (33,806 bytes) | CONSOLIDATE | Large WS broadcaster | Medium |
| `broker/` | REPLACE (shim) | All observed broker files are shims to package | Medium (consumers unknown) |
| `utils/strategy/*` | MOVE | All observed are shims to package | Medium |
| `utils/` domain-neutral primitives | KEEP | Small files (time, ID, math) — not traced | Low |
| `engine/core/*` | KEEP (engine) | Orchestration owner per AGENTS.md | Low |
| `config/` | CONSOLIDATE | Ownership unclear; not traced | Medium |

## 11f. Test ownership map

| Module area | Test files (observed) | Coverage gaps (suspected) |
|-------------|----------------------|--------------------------|
| Strategy engine | `packages/corex-strategy-engine/test/*` (Strategy, Position, ta, util) | Indicators beyond dispatch; plotting |
| Broker contract | `packages/corex-broker-contract/test/*` (contract, SymbolNormalizer, UnsupportedOperationError) | Live/paper brokers (need creds) |
| Market data | `packages/corex-market-data/test/DataProviderContract.test.js`, `TwelveDataProvider.test.js` | Yahoo/File providers |
| Auth | `packages/corex-auth/test/SecretsVault.test.js` | AuthService flows |
| Accounts | `packages/corex-accounts/test/connections.test.js` | brokerPersistence |
| Gateway | `packages/corex-gateway/test/*` (socketx, authVerifier, account_socketx) | RiskGateway |
| Portfolio | `packages/corex-portfolio/test/*` (tradeHistoryService, orderFillListener) | analytics |
| Engine | `engine/test/*` (boot.smoke, connectorSettingsService, riskGateway.wiring, runtimeExclusivity, settingsSchemaRegistry, strategyWorker.warmup) | Large controllers (system, backtest, execution) untested at controller level |
| Root | `test/*.test.js` (12 files) + `test/backtest/*` | backtestController, broadcaster |

Baseline: 51 suites / 572 tests (P0-01, verified on origin/audit/p0-01-repository-baseline).

## 11g. Measurements (reverified 2026-10-31)

File sizes (bytes, via Get-ChildItem):
- `engine/routes/systemController.js` 44,117
- `engine/backtestManager.js` 42,839
- `engine/routes/backtestController.js` 42,703
- `engine/routes/executionController.js` 35,278
- `engine/services/broadcaster.js` 33,806
- `engine/core/engine.js` 30,070
- `engine/services/pgStore.js` 26,668
- `engine/strategyLoader.js` 24,377
- `engine/services/dataCuller.js` 16,245
- `engine/core/runtime/RuntimeLifecycle.js` 15,009
- `engine/services/jobQueue.js` 13,978
- `engine/workers/jobWorker.js` 13,780
- `engine/services/strategyCompiler.js` 13,524
- `engine/managers/mt5Receiver.py` 13,411
- `engine/services/historicalCache.js` 13,113 (approx; from earlier listing)

Engine file count: 80 files (Get-ChildItem -Recurse -File). Package count: 7.

## 12. Handoff

### Handoff — 2026-10-31
Owner / agent: Kilo Code
Status: REVIEW
Branch: audit/p0-02-backend-ownership
Base commit: 637056feaeddb2800a58d4b2c85a469fff970125
Files changed: plans/architecture/BACKEND_OWNERSHIP_MAP.md (updated); plans/STATUS.md (updated); plans/tasks/P0-02-backend-ownership.md (updated)
Completed: Expanded audit per independent review: package consumer map, flow traces with call sites, singleton ownership, duplicate implementations, disposition evidence, test ownership map, reverified measurements.
Commands and test results: grep/Select-String/Test-Path/Get-ChildItem verification. No tests rerun (docs-only).
Unverified items / limitations: circular deps not tool-verified; consumer/parity tracing partial; ownership inferred from shims and file names in several places.
Decisions needed: Owen review.
Blockers: None.
Exact next action: Owen reviews expanded audit; if accepted, proceed to P0-03 or integration.
May another agent continue? YES — read-only review only.


### Handoff — 2026-10-31
Owner / agent: Kilo Code
Status: REVIEW
Branch: audit/p0-02-backend-ownership
Base commit: 637056feaeddb2800a58d4b2c85a469fff970125
Files changed: plans/architecture/BACKEND_OWNERSHIP_MAP.md (created); plans/STATUS.md (updated); plans/tasks/P0-02-backend-ownership.md (updated)
Completed: Read-only backend ownership/dependency audit. Deliverable created.
Commands and test results: Directory/file inventories, Select-String, Test-Path checks. No tests rerun (docs-only).
Unverified items / limitations: circular deps not tool-verified; consumer tracing partial; parity not verified.
Decisions needed: Owen review.
Blockers: None.
Exact next action: Owen reviews audit; if accepted, proceed to P0-03 or integration.
May another agent continue? YES — read-only review only.
