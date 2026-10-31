# CoreX

CoreX is a Node.js trading application for authoring and running algorithmic strategies, connecting market data and broker integrations, monitoring execution, and evaluating strategies through historical backtests.

The repository contains a Node.js/Express backend, a React/TypeScript desktop-style web interface, PostgreSQL persistence, WebSocket live updates, strategy runtime infrastructure, broker/data-provider adapters, and an asynchronous job system.

**Project status:** Active development. CoreX is currently a transitional modular monolith. Domain packages under `packages/` coexist with legacy application modules under `engine/`, `broker/`, `utils/`, and `events/`. Some boundaries are still being migrated. This README documents how the system actually works in code today.

---

## Status Matrix

| Subsystem / Feature | Status | Implementation Details |
|---|---|---|
| User Authentication & Sessions | Working | Scrypt password hashing, signed JWTs, PostgreSQL-backed users, and session revocation when PostgreSQL is configured (`packages/corex-auth/src/AuthService.js`, `engine/routes/authController.js`). |
| Strategy Engine & Indicators | Working | Strategy contracts, parameter validation, incremental technical indicators, typed-array candle store (`packages/corex-strategy-engine`). |
| Strategy Runtime & Management | Working | Start, stop, restart, parameter updates, telemetry streaming (`engine/modules/strategyRuntime`, `engine/routes/executionController.js`). |
| Paper Execution Mode | Working | Simulated order fills, balance/equity tracking, portfolio event emission (`packages/corex-broker-contract/src/modes/PaperBroker.js`). |
| Historical Backtesting | Partial | CSV uploads, dataset persistence, database-backed job queue, and report generation work. Simulation has lookahead bias and configuration propagation gaps (`engine/backtestManager.js`). |
| MT5 Bridge Execution | Partial | WebSocket endpoint at `/mt5` and REST order-polling paths are implemented; actual execution depends on a configured external MT5 terminal receiver and has not been verified end-to-end in this review (`packages/corex-broker-contract/src/mt5Bridge.js`, `engine/managers/mt5Receiver.py`). |
| Live Execution (MetaApi) | Broken | `LiveBroker` loads `MetaApiDriver`, but `MetaApiConnector` is currently a structural skeleton returning mock objects (`packages/corex-broker-contract/src/connectors/MetaApiConnector.js`). |
| Twelve Data Market Provider | Working | REST historical bar fetching and live WebSocket streaming (`packages/corex-market-data/src/providers/TwelveDataProvider.js`). |
| Yahoo Finance Market Provider | Partial | `yahoo-finance2` historical daily/intraday adapter is implemented; its source explicitly calls for human end-to-end verification against Yahoo Finance (`packages/corex-market-data/src/providers/YahooFinanceProvider.js`). |
| File Market Data Provider | Partial | Replays CSV/JSON/JSONL files to the event bus, but uses a naive comma-split parser and is not integrated into the backtest upload path (`packages/corex-market-data/src/providers/FileDataProvider.js`). |
| Dedicated `corex-backtest` Package | Planned-not-built | Backtesting currently resides in legacy `engine/backtestManager.js`. |

---

## Startup and Lifecycle

### Entry Points

The application has four primary entry points:

1. **Backend Server & Engine (`index.js`):** Starts the HTTP server, WebSocket broadcaster, background data culler, live order dispatcher, and job worker supervisor.
2. **HTTP Server Only (`engine/server.js`):** Configures Express middleware, REST route mounts, and WebSocket upgrade listeners.
3. **Background Job Worker (`engine/workers/jobWorker.js`):** Standalone queue processor for asynchronous backtest jobs. Started automatically by `index.js` when PostgreSQL is configured.
4. **MT5 Receiver Process (`engine/managers/mt5Receiver.py`):** Optional Python script connecting MetaTrader 5 to the CoreX bridge.

### Startup Sequence (`index.js`)

When running `npm start` or `node index.js`:

1. **Module aliases:** `module-alias/register` registers paths defined in `package.json` (`@core`, `@utils`, `@broker`, etc.).
2. **Environment:** `dotenv.config({ quiet: true })` loads variables from `.env`.
3. **Production assertion:** If `NODE_ENV=production`, requires `JWT_SECRET`, `COREX_SECRETS_KEY`, and `AUTH_KEY_PEPPER`.
4. **Database migration:** Runs `db/migrate.js` to apply SQL migrations from `db/migrations/`. If PostgreSQL is not configured and `COREX_DB_REQUIRED=false`, migrations are skipped.
5. **Config service:** Initializes and loads persisted configuration from PostgreSQL (`configService.load()`).
6. **Integration runtime:** Refreshes external connector credentials from PostgreSQL (`integrationRuntime.refresh()`).
7. **Engine start:** Initializes `engine/core/engine.js`, wires risk controls and market feed dependencies.
8. **HTTP & WebSocket server:** `server.start()` starts Express on `PORT` (default 3000) and attaches WebSocket handlers.
9. **Background workers:**
   - `dataCuller.start()`: Periodic pruning of stale cache, uploads, and backtest records.
   - `liveOrderDispatcher.start()`: Polls and dispatches pending live orders.
   - `jobWorkerSupervisor.start()`: Starts the background backtest job worker if PostgreSQL is configured.
10. **Terminal controls:** Binds keyboard shortcuts if run in an interactive TTY (`Ctrl+R` restart, `Ctrl+P` list routes, `Ctrl+L` clear, `Ctrl+D` stop).

### package.json Scripts

| Script | Command | Purpose |
|---|---|---|
| `start` | `node index.js` | Start application backend and background services |
| `dev` | `nodemon index.js` | Start backend with automatic file-watch reloading |
| `menu` | `node scripts/menu.js` | Interactive terminal CLI management menu |
| `test` | `jest --passWithNoTests` | Run root Jest test suite |
| `test:auth` | `jest --runInBand test/auth.service.test.js test/auth.integration.test.js` | Run authentication tests in-band |
| `status` | `node ./utils/system-check.js` | Run system preflight diagnostics |
| `status:set` | `node scripts/gh-project-status.js` | Update GitHub project status metadata |
| `account:reset` | `node scripts/reset-paper-account.js` | Reset paper trading account balance to defaults |
| `db:migrate` | `node db/migrate.js` | Apply database migrations manually |
| `strategies:migrate` | `node db/migrate_strategies_to_db.js` | Migrate local strategy files to PostgreSQL |
| `db:start` | `pg_ctl start -D "D:/scoop/persist/postgresql/data" -w` | Windows local PostgreSQL service start |
| `db:stop` | `pg_ctl stop -D "D:/scoop/persist/postgresql/data" -m fast` | Windows local PostgreSQL service stop |
| `db:status` | `pg_ctl status -D "D:/scoop/persist/postgresql/data"` | Windows local PostgreSQL status check |
| `bench:engine` | `node scripts/bench/engine-micro-bench.js` | Run micro-benchmarks for engine hot paths |
| `sync:strategy-manifest` | `node scripts/sync-strategy-manifest.js` | Sync strategy files to database manifest |
| `worker:jobs` | `node engine/workers/jobWorker.js` | Run standalone backtest job worker process |
| `mt5:receiver` | `python engine/managers/mt5Receiver.py` | Run Python MetaTrader 5 receiver bridge |
| `mt5:receiver:env` | `set DOTENV_CONFIG_PATH=.env.receiver && python engine/managers/mt5Receiver.py` | Run MT5 receiver with custom env file |
| `maintenance:prune` | `node scripts/maintenance/prune-runtime-artifacts.js` | Dry-run prune of stale runtime artifacts |
| `maintenance:prune:apply` | `node scripts/maintenance/prune-runtime-artifacts.js --apply` | Apply prune of stale runtime artifacts |
| `core:clean` | `node -e "const fs=require('fs'); fs.rmSync('./data/backtests/', {recursive:true, force:true})"` | Delete local backtest artifact files |
| `ui:dev` | `npm --prefix front_end run dev` | Start frontend Vite development server |
| `ui:build` | `npm --prefix front_end run build` | Build production frontend bundle |
| `ui:preview` | `npm --prefix front_end run preview` | Preview production frontend build |

### Jules-Reported Test Verification

Executed in a clean workspace:
- Command: `npm install` (added 515 packages, exit status 0).
- Command: `npm test`
  - Test Suites: 51 passed, 51 total
  - Tests: 572 passed, 572 total
  - Snapshots: 0 total
  - Exit code: 0
  - Note: Jest outputs an open-handles/forced-exit warning.

**Evidence status:** These are Jules-reported results. This PR has no attached terminal log or passing GitHub Actions run for this commit, so the counts are not independently verifiable from the PR. The PR itself changes documentation only.

---

## REST API Reference

The backend Express application mounts routes under `/api` and a root health check. All endpoints require authentication unless marked Public, Admin, or Token:

| Method | Path | Auth Requirement | Handler File |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | `engine/routes/authController.js` |
| `POST` | `/api/auth/register` | Public | `engine/routes/authController.js` |
| `POST` | `/api/auth/signin` | Public | `engine/routes/authController.js` |
| `POST` | `/api/auth/signout` | Optional JWT session | `engine/routes/authController.js` |
| `POST` | `/api/auth/bootstrap` | Public | `engine/routes/authController.js` |
| `GET` | `/api/auth/me` | JWT required | `engine/routes/authController.js` |
| `GET` | `/api/strategies` | JWT required | `engine/routes/strategyController.js` |
| `GET` | `/api/strategies/manifest` | JWT required | `engine/routes/strategyController.js` |
| `GET` | `/api/strategies/:id` | JWT required | `engine/routes/strategyController.js` |
| `GET` | `/api/strategies/:id/code` | JWT required | `engine/routes/strategyController.js` |
| `POST` | `/api/strategies` | JWT required | `engine/routes/strategyController.js` |
| `PATCH` | `/api/strategies/:id/rename` | JWT required | `engine/routes/strategyController.js` |
| `PUT` | `/api/strategies/:id` | JWT required | `engine/routes/strategyController.js` |
| `DELETE` | `/api/strategies/:id` | JWT required | `engine/routes/strategyController.js` |
| `GET` | `/api/run/status` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/telemetry/:id` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/history` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/ops/telemetry` | JWT required | `engine/routes/executionController.js` |
| `POST` | `/api/run/ops/reconcile` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/history/snapshots` | JWT required | `engine/routes/executionController.js` |
| `DELETE` | `/api/run/history` | JWT required | `engine/routes/executionController.js` |
| `POST` | `/api/run/start/:id` | JWT required | `engine/routes/executionController.js` |
| `POST` | `/api/run/stop/:id` | JWT required | `engine/routes/executionController.js` |
| `POST` | `/api/run/restart/:id` | JWT required | `engine/routes/executionController.js` |
| `PATCH` | `/api/run/params/:id` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/config` | JWT required | `engine/routes/executionController.js` |
| `POST` | `/api/run/params/:id/reset` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/run/dataset/:id` | JWT required | `engine/routes/executionController.js` |
| `GET` | `/api/backtest/settings` | JWT required | `engine/routes/backtestController.js` |
| `PATCH` | `/api/backtest/settings` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/uploads` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/uploads/:uploadId` | JWT required | `engine/routes/backtestController.js` |
| `POST` | `/api/backtest/uploads` | JWT required | `engine/routes/backtestController.js` |
| `DELETE` | `/api/backtest/uploads/:uploadId` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/jobs` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/jobs/:jobId` | JWT required | `engine/routes/backtestController.js` |
| `POST` | `/api/backtest/jobs/:jobId/cancel` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/progress/:jobId` | JWT required | `engine/routes/backtestController.js` |
| `POST` | `/api/backtest/:id` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/backtest/:reportId` | JWT required | `engine/routes/backtestController.js` |
| `DELETE` | `/api/backtest/:reportId` | JWT required | `engine/routes/backtestController.js` |
| `GET` | `/api/system/heartbeat` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/feed/metrics` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/health/control-gates` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/account/modes` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/account/mode` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/account/:mode/balance` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/account/:mode/settings` | JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/account/:mode/reset` | JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/settings/update` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/account/:mode/settings` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/settings` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/settings` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/run/settings` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/run/settings` | JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/maintenance/reset-states` | Admin JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/mt5/status` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/connectors` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/connectors/:strategyId` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/ws-health` | JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/mt5/push-test` | JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/mt5/execution` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/docs` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/docs/:slug` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/chart-settings` | JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/chart-settings` | JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/db/summary` | Admin JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/db/users` | Admin JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/db/users` | Admin JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/db/accounts` | Admin JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/system/db/accounts` | Admin JWT required | `engine/routes/systemController.js` |
| `GET` | `/api/system/db/quota/:userId` | Admin JWT required | `engine/routes/systemController.js` |
| `PATCH` | `/api/system/db/quota/:userId` | Admin JWT required | `engine/routes/systemController.js` |
| `POST` | `/api/bridge/heartbeat` | x-corex-token | `engine/routes/bridgeController.js` |
| `POST` | `/api/bridge/authorize` | Admin JWT required | `engine/routes/bridgeController.js` |
| `GET` | `/api/mt5/next-order` | x-corex-token | `engine/routes/mt5Controller.js` |
| `POST` | `/api/mt5/confirm-fill` | x-corex-token | `engine/routes/mt5Controller.js` |
| `GET` | `/api/settings/health` | Public | `engine/routes/settingsController.js` |
| `PUT` | `/api/accounts/:accountId/connectors/:type` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/accounts/:accountId/connectors/:type` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/settings/connectors/:type` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/settings/connectors` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/settings/engine` | JWT required | `engine/routes/settingsController.js` |
| `PATCH` | `/api/settings/engine` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/settings/account/:mode` | JWT required | `engine/routes/settingsController.js` |
| `PATCH` | `/api/settings/account/:mode` | JWT required | `engine/routes/settingsController.js` |
| `POST` | `/api/settings/account/:mode/reset` | JWT required | `engine/routes/settingsController.js` |
| `GET` | `/api/data/reports` | JWT required | `engine/routes/dataController.js` |
| `GET` | `/api/data/reports/:id` | JWT required | `engine/routes/dataController.js` |
| `DELETE` | `/api/data/reports/:id` | JWT required | `engine/routes/dataController.js` |
| `GET` | `/api/data/storage` | JWT required | `engine/routes/dataController.js` |
| `DELETE` | `/api/data/storage/:id` | JWT required | `engine/routes/dataController.js` |
| `GET` | `/api/data/candles` | JWT required | `engine/routes/dataController.js` |
| `GET` | `/api/data/symbols` | JWT required | `engine/routes/dataController.js` |
| `GET` | `/ping` | Public | `engine/server.js` |

---

## WebSocket Endpoints and Event Protocol

The server exposes two WebSocket paths:

### 1. Application Event Stream (`/ws`)

- **Path:** `/ws`
- **Authentication:** Upgrade requires a valid JWT passed via `Authorization: Bearer <token>` header or query parameter `?token=<token>`.
- **Client Messages:**
  - `{"action":"SUBSCRIBE", "channels": ["status", "feed", "market", "execution", "strategy", "mt5"]}`
  - `{"action":"UNSUBSCRIBE", "channels": [...]}`
  - `{"action":"SET_RATE", "channel": "market", "intervalMs": 1000}`
- **Wire Message Envelope:**
  All server transmissions follow this envelope:
  ```json
  {
    "type": "STATUS_UPDATE",
    "timestamp": 1793439000000,
    "payload": {},
    "meta": {
      "channel": "status",
      "category": "status"
    }
  }
  ```
- **Emitted Event Types (`config/constants.js` & `broadcaster.js`):**
  - `STATUS_UPDATE`: Periodic system health, CPU/RAM stats, worker status, and active strategy states.
  - `FEED_METRICS`: Market data feed connectivity and latency metrics.
  - `DATA_TICK` / `DATA_CANDLE`: Live market quotes and aggregated OHLCV candle bars.
  - `MARKET_LOST`: Emitted when upstream data connection drops.
  - `ORDER_CREATED`, `ORDER_FILLED`, `ORDER_CANCELLED`, `ORDER_UPDATED`: Order lifecycle updates.
  - `POSITION_UPDATED`, `PORTFOLIO_UPDATED`: Position mark-to-market and account equity changes.
  - `STRATEGY_SIGNAL`: Signal events generated by strategy instances.
  - `STRATEGY_LOADED`, `STRATEGY_UNLOADED`, `STRATEGY_START`, `STRATEGY_STOP`, `STRATEGY_STATE`: Lifecycle status.
  - `STRATEGY_PARAMS_UPDATED`: Parameter hot-reload notifications.
  - `STRATEGY_PLOT_UPDATE`: Custom indicator and primitive plots emitted from strategies.
  - `BACKTEST_PROGRESS`: Asynchronous backtest job progress percentage and stage.
  - `SYSTEM_LOG`, `SYSTEM_ERROR`: Engine logs forwarded to UI.
  - `MT5_BRIDGE_STATUS`: Live status of connected MT5 bridge terminals.

### 2. MT5 Bridge Connection (`/mt5`)

- **Path:** `/mt5`
- **Authentication:** Requires matching token query parameter `?token=<token>` against the environment variable `MT5_BRIDGE_TOKEN`. Upgrades are rejected if `MT5_BRIDGE_TOKEN` is not configured.
- **Protocol:** Bidirectional JSON messages for order execution requests and fill confirmations between CoreX and the external Python receiver process.

---

## Key Environment Variables

| Variable | Required | Default | Read By / Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | `engine/server.js`: HTTP and WebSocket listening port |
| `NODE_ENV` | No | `development` | Multiple: Environment mode (`production`, `development`, `test`) |
| `JWT_SECRET` | Yes (in prod) | Dev fallback | `corex-auth`: Signing and verifying user JWT tokens |
| `COREX_SECRETS_KEY` | Yes (in prod) | Dev fallback | `corex-auth/SecretsVault.js`: AES encryption key for broker tokens |
| `COREX_SECRETS_KEY_OLD`| No | None | `corex-auth/SecretsVault.js`: Previous key for secrets rotation |
| `AUTH_KEY_PEPPER` | Yes (in prod) | None in auth service | Required by the production startup assertion in `index.js`; the current `corex-auth` password hashing function uses scrypt with a salt, not this pepper. |
| `DATABASE_URL` | No | None | `engine/services/postgres.js`: PostgreSQL connection string |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | No | `PGPORT` defaults to `5432`; other values have no code default | `engine/services/postgres.js`: host-based PostgreSQL connection parameters; `PGHOST` is the config-detection switch. |
| `PGSSL` | No | `false` | `engine/services/postgres.js`: Enable SSL for PostgreSQL pool |
| `COREX_DB_REQUIRED` | No | `true` in prod, `false` in dev | `db/migrate.js`: Fails startup if DB unreachable when true |
| `CORS_ORIGIN` | No | `http://localhost:5173` | `engine/server.js`: Allowed CORS origin for web client |
| `JSON_LIMIT` | No | `1mb` | `engine/server.js`: Express JSON body parser size limit |
| `TWELVE_DATA_KEY` | No | None | `corex-market-data`: Twelve Data API key for market data provider |
| `YAHOO_API_KEY` | No | None | `corex-market-data`: Yahoo Finance provider key (if required) |
| `MT5_BRIDGE_TOKEN` | No | None | `engine/server.js`: Security token for `/mt5` WebSocket bridge |
| `COREX_MT5_HTTP_TOKEN` | No | None | `engine/routes/mt5Controller.js`: Expected `x-corex-token` for MT5 REST routes |
| `COREX_STRATEGY_WORKER_ENABLED` | No | `false` | `engine/modules/strategyRuntime/workerPool.js`: Run strategies in worker threads |
| `BACKTEST_MAX_MB` | No | `50` | `engine/routes/backtestController.js`: Maximum CSV upload size in megabytes |
| `BACKTEST_DB_DATASET_MAX_BARS` | No | `5000` in `.env.example` | Present in sample configuration; no active code reader was identified in this review. |
| `COREX_API_RATE_LIMIT_MAX` | No | `600` | `engine/server.js`: Maximum user API requests per minute window |
| `COREX_AUTH_RATE_LIMIT_MAX` | No | `120` | `engine/server.js`: Maximum auth API requests per minute window |
| `COREX_SHUTDOWN_FORCE_MS` | No | `5000` | `index.js`: Force process exit timeout if graceful teardown hangs |
| `COREX_DATA_CULL_ENABLED` | No | `true` | `engine/services/dataCuller.js`: Enable background artifact pruning |

*Note on `COREX_LIVE_DRY_RUN`*: Found in `.env.example`, but not referenced anywhere in backend application code.

*Note on `BACKTEST_DB_DATASET_MAX_BARS`*: Also present in `.env.example`, but the README's former source path (`engine/services/backtestDataStorage.js`) does not exist and no active reader was identified. Treat this setting as stale or unwired until confirmed.

---

## Repository Layout and Package Architecture

```text
corex_engine/
├── index.js                       # Main application startup and graceful shutdown
├── package.json                   # Root dependencies, scripts, and module aliases
├── package-lock.json
├── engine/                        # Core backend application modules
│   ├── server.js                  # Express API server & WS upgrade routing
│   ├── strategyLoader.js          # Strategy validation, compilation, and registry
│   ├── backtestManager.js         # Historical backtest execution engine
│   ├── core/                      # Engine pipeline, runtime registry, and lifecycle
│   ├── routes/                    # Express REST route controllers
│   ├── services/                  # Business logic, postgres, broadcaster, queue
│   ├── modules/                   # Strategy runtime and worker thread pool
│   └── workers/                   # Asynchronous backtest job workers
├── packages/                      # Domain packages (in progress modularization)
│   ├── corex-accounts/            # Account & connection services
│   ├── corex-auth/                # User authentication, tokens, secrets vault
│   ├── corex-broker-contract/     # Broker drivers, connectors, and modes
│   ├── corex-gateway/             # Account models and Socket_X gateway
│   ├── corex-market-data/         # Market data provider contract and adapters
│   ├── corex-portfolio/           # Trade history, equity curves, drawdown math
│   └── corex-strategy-engine/     # Indicators, context builder, parameter schemas
├── broker/                        # Legacy broker adapters (e.g. twelvedata.js)
├── config/                        # Constants, defaults, and configuration loader
├── db/                            # SQL migrations and migration runner
├── events/                        # Central EventEmitter3 bus
├── utils/                         # Shared utilities, logger, metrics, indicators
├── front_end/                     # React 19 / TypeScript / Vite application
└── test/                          # Root Jest test suites
```

### Packages Dependency & Isolation Audit

Packages are partially modularized and still maintain dependencies on root aliases:

- `packages/corex-accounts`: Imports `@events/bus`, `@core/services/pgStore`, `@utils/logger`, `@core/services/secretsVault`.
- `packages/corex-auth`: Self-contained in `src/`. No upward imports.
- `packages/corex-broker-contract`: Imports `@config/constants`, `@events/bus`, `@utils/logger`, `@utils/strategy/StrategyPositionManager`, `@core/services/postgres`, and `@data/providers/FileDataProvider`.
- `packages/corex-gateway`: Imports `corex-auth` and `corex-broker-contract` relative paths.
- `packages/corex-market-data`: Imports `@utils/logger`, `@events/bus`, `@core/services/configService`, and `@broker/twelvedata`.
- `packages/corex-portfolio`: Imports `@events/bus` and `@utils/logger`.
- `packages/corex-strategy-engine`: Imports `@utils/logger`, `@config/constants`, `@core/core/strategy/StrategyContract`, and `@utils/strategy/StrategyStateStore`.

### Duplicate Implementations
- `SoACandleStore.js` exists in both `utils/strategy/SoACandleStore.js` and `packages/corex-strategy-engine/src/SoACandleStore.js`.
- `SymbolNormalizer.js` exists in both `packages/corex-broker-contract/src/utils/SymbolNormalizer.js` and `broker/SymbolNormalizer.js`.

---

## Database and Degraded Operation

CoreX uses PostgreSQL for persistence.

### Database Tables Created by Migrations
The migration inventory below lists 31 tables, including `schema_migrations`:
`backtest_market_data`, `backtest_uploads`, `backtests`, `bridge_status`, `broker_settings`, `connections`, `corex_jobs`, `corex_sessions`, `execution_control`, `execution_events`, `mt5_messages`, `order_fills`, `orders`, `paper_trades`, `positions`, `quota_profiles`, `schema_migrations`, `strategies`, `strategy_runtimes`, `strategy_signals`, `strategy_ticks`, `strategy_ticks_p0`, `strategy_versions`, `system_settings`, `trading_accounts`, `user_accounts`, `user_broker_settings`, `user_connector_settings`, `user_engine_settings`, `user_system_settings`, `users`.
*(Historical tables dropped in subsequent migrations: `accounts`, `user_api_keys`, `backtest_data_storage`)*.

### Degraded Operation (When PostgreSQL is Not Configured)
Database availability is determined by `postgres.hasDbConfig()`, which returns true when `DATABASE_URL` or `PGHOST` is set.
- If `COREX_DB_REQUIRED=true` (default in production): startup throws `POSTGRES_NOT_CONFIGURED` and halts.
- If `COREX_DB_REQUIRED=false` (default in development):
  - Migrations are skipped.
  - `jobWorkerSupervisor` does not start.
  - Database-backed routes fail when PostgreSQL is unavailable; exact status codes and error names are route-specific.
  - Trade history returns a zeroed PAPER-mode fallback report.
  - Registration, sign-in, and user-profile lookup still depend on PostgreSQL through `pgStore`; there is no in-memory user store. For an already-issued JWT, `authGuard` skips the session-revocation database check when `hasDbConfig()` is false and performs token-only validation. Session persistence and revocation are therefore unavailable in that degraded state.

---

## Data and Execution Modes

1. **PAPER Mode (Working):**
   - Simulated execution via `PaperBroker`.
   - Supports market order simulation, slippage calculation, fill latency modeling, and unrealized/realized PnL updates.
   - Operates in-memory and emits order fill events across the internal event bus to the broadcaster.

2. **BACKTEST Mode (Partial):**
   - Historical simulation orchestrated by `engine/backtestManager.js`.
   - Datasets are uploaded as CSV, parsed via `data-forge`, and queued as background jobs in PostgreSQL.
   - Subject to known issues outlined below (same-bar fill lookahead bias and configuration passing omissions).

3. **LIVE Mode (Partial):**
   - MetaApi integration uses `MetaApiDriver` with `MetaApiConnector`, which currently returns skeleton stub data.
   - MT5 execution passes orders to PostgreSQL and awaits execution via the `/api/mt5/next-order` polling endpoint and WebSocket bridge.

---

## Known Issues

The following code defects were confirmed in the inspected implementation:

1. **Config omission in `engine/backtestManager.js` (`_resolveConfig` and `_computeAnalytics`):**
   - In `engine/backtestManager.js` lines 308-328, `_resolveConfig` does not copy `commissionPct`, `slippageBps`, `spread`, `barBudgetMs`, `barBudgetStrikes`, or `batchSize` from the incoming options into the returned config object. `shouldAbort` is handled separately from the resolved config in `run()` and is not part of this omission.
   - In `engine/backtestManager.js` lines 775-776, `_computeAnalytics` explicitly passes `commissionPercent: 0` and `slippageBps: 0` to `format.buildReport`, discarding configured commission and slippage metrics in the final report calculation.

2. **Lookahead execution in backtesting (`engine/backtestManager.js`):**
   - In `engine/backtestManager.js` lines 581-635, a signal emitted by `strategy.onBar({ ...bar, symbol })` is passed directly to `broker.execute(signal, bar)` on the same bar. This fills orders at the current bar's close price rather than deferring the fill to the next bar's open, introducing lookahead bias.

3. **Incomplete CSV data frame validation in `engine/backtestManager.js` (`_processDataFrame`):**
   - In `engine/backtestManager.js` lines 476-497, `_processDataFrame` silently discards rows where `close <= 0` or time is unparseable. It does not validate `high >= low`, duplicate timestamps, or NaN values in the other OHLCV columns. It sorts rows by timestamp rather than rejecting out-of-order input.

4. **Missing method call in `engine/services/backtestService.js`:**
   - In `engine/services/backtestService.js` line 14, `runBacktest` calls `backtestManager.runBacktest(options)`, but the manager defines `run(strategy, options)`, not `runBacktest`. Calling this wrapper therefore throws `TypeError: backtestManager.runBacktest is not a function`. The current backtest controller and job worker do not use this service wrapper; the worker calls `backtestManager.run()` directly, so this is an orphaned broken service path rather than the active backtest execution path.

5. **Naive CSV parser in `FileDataProvider` not used in backtest pipeline:**
   - In `packages/corex-market-data/src/providers/FileDataProvider.js` lines 41-53, `parseCsv` uses `split(",")`, which breaks on quoted fields or comma-separated values inside columns. Furthermore, this provider is not utilized in the backtest CSV upload workflow, which instead uses `data-forge` in `engine/backtestManager.js` line 394.


**Singleton note:** `BacktestManager` is exported as a singleton, but the mutable instance fields identified in this review are the storage path and storage-initialization flags. No per-run state contamination was demonstrated, so singleton export alone is not listed as a confirmed defect.

---

## Direction

Architectural plans, target boundaries, and development tasks are tracked exclusively in:

- [CoreX Development Plan](plans/COREX_DEVELOPMENT_PLAN.md)