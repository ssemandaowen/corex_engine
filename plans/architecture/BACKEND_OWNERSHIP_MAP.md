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

## 12. Handoff

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
