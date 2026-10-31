# CoreX

**CoreX is a Node.js trading application for authoring and running algorithmic strategies, connecting market-data and broker integrations, monitoring execution, and evaluating strategies through historical backtests.**

The repository contains a Node.js/Express backend, a React/TypeScript desktop-style web interface, PostgreSQL persistence, WebSocket-based live updates, strategy runtime infrastructure, broker/data-provider adapters and an asynchronous job system.

> **Project status:** Active development. The current codebase is a working but transitional modular monolith. Domain packages coexist with older application directories, and some responsibilities are still being migrated. This README describes the code currently present in the repository; it is not a claim that every feature is production-ready or that the target architecture is complete.

---

## What the application does

CoreX is organized around a workflow:

1. Sign in and manage a user account.
2. Create, edit, compile and configure a trading strategy.
3. Configure market-data and broker connectivity.
4. Start a strategy runtime in a supported execution mode.
5. Monitor strategy state, market data, account/execution activity and system health.
6. Upload historical CSV data, run backtests and inspect saved reports.

### Main workspace

The React application currently exposes these main navigation areas:

| Area | Purpose |
|---|---|
| **Home** | Application status, account/workspace overview and operational information |
| **Strategies** | Strategy list, source editor, strategy metadata and parameter configuration |
| **Run** | Strategy runtime controls, execution monitoring and backtest workflow |
| **Data** | Historical data, uploaded datasets, storage and backtest reports |
| **Account** | Account and connector-related user interface |
| **Settings** | Application, engine and integration settings |

The frontend is under `front_end/`. It uses React 19, TypeScript, Vite, Zustand, Axios, Tailwind CSS 4, Lightweight Charts, Recharts and Monaco Editor.

### Strategy engine and runtime

The backend includes a strategy loader/compiler and a strategy runtime system. The strategy-engine package contains strategy context construction, parameter schema utilities, indicator management/registry, position-related utilities, state storage, plotting buffers, validation and a collection of technical indicators.

The application exposes strategy operations through the API, including listing, reading, creating/updating and managing strategies. Runtime services support starting, stopping and restarting strategies, applying validated parameter updates and retrieving runtime status/telemetry.

The runtime is designed to warm strategies with historical market data before live updates. Runtime lifecycle and recovery behavior are managed by the engine and its supporting runtime/loader modules.

### Execution modes

The repository contains broker drivers and mode implementations for:

- **PAPER** — simulated execution through the CoreX paper driver/broker.
- **LIVE** — broker-backed execution through configured connectors.
- **BACKTEST** — historical simulation using the current backtest manager and its data/report workflow.

The codebase contains separate mode-specific implementations. Do not assume that all broker integrations, symbols, account types or order features are available in every mode. Availability depends on the connector, credentials, configuration and current implementation.

### Backtesting and historical datasets

The current backtest workflow includes:

- CSV dataset upload and storage;
- dataset metadata such as bar count and time range;
- per-user upload/report access paths;
- asynchronous job execution through the database-backed job queue;
- progress reporting;
- saved backtest reports and report retrieval;
- configurable upload and storage limits.

**Current implementation location:** backtest behavior is still orchestrated through legacy application modules, notably `engine/backtestManager.js`, with supporting API, service, worker and market-data modules. A dedicated `packages/corex-backtest` package is a proposed rebuild target, not an existing package in the current repository snapshot.

### Market data

The market-data package defines a provider contract and factory and includes provider implementations for:

- Twelve Data;
- Yahoo Finance;
- file-backed data.

The repository also contains the older Twelve Data broker integration used by parts of the application. Historical retrieval, live subscriptions, symbol normalization, caching and strategy warmup are handled across the market-data package and existing engine/broker modules.

An API key or provider account may be required. Provider limits, symbol coverage, intervals and availability are controlled by the upstream service and the current adapter.

### Broker and bridge integrations

The broker-contract package contains broker abstractions, drivers, mode implementations, symbol/data utilities and connector code. The current source tree includes:

- MetaApi connector/driver code;
- MT5 MQL5 connector and bridge code;
- CoreX paper and backtest drivers;
- live and paper broker mode implementations;
- shared fill-simulation utilities.

The presence of connector code does not mean a broker account is already connected. Credentials, account configuration, provider access and the relevant bridge process are required. MT5 bridge connectivity uses its own WebSocket endpoint and configured bridge token.

### Accounts, authentication and settings

The repository includes user authentication services, JWT handling, a secrets vault, account/connection services, settings APIs and PostgreSQL persistence. The backend scopes many strategy, job, upload and report operations to the authenticated user.

Production startup explicitly requires configured values for:
- `JWT_SECRET`
- `COREX_SECRETS_KEY`
- `AUTH_KEY_PEPPER`

Use unique, strong secrets. Never commit a real `.env` file, broker credential, API key, token or database password.

### Real-time communication

The backend exposes an authenticated WebSocket endpoint at `/ws` for application events and live state updates. The broadcaster maps internal engine events to WebSocket event types and supports channel/symbol subscriptions, heartbeats and buffered-message/backpressure controls.

The MT5 bridge uses a separate `/mt5` WebSocket endpoint. It requires `MT5_BRIDGE_TOKEN` to be configured and validates the supplied bridge token.

REST endpoints remain in use for commands, initial queries, settings, uploads, reports and other request/response operations. The application is not REST-free.

---

## Technology

| Layer | Current implementation |
|---|---|
| Backend runtime | Node.js (root package declares Node.js `>=18`) |
| HTTP API | Express 5 |
| Real-time transport | WebSocket (`ws`) |
| Database | PostgreSQL (`pg`) |
| Backend language | JavaScript (CommonJS) |
| Frontend | React 19 + TypeScript |
| Frontend build/dev server | Vite |
| Frontend state | Zustand |
| HTTP client | Axios |
| Charts | Lightweight Charts, Recharts |
| Strategy editor | Monaco Editor |
| Tests | Jest |
| Configuration | Environment variables plus persisted CoreX settings |

The root application uses module aliases such as `@core`, `@utils`, `@broker`, `@data`, `@events` and `@config`. These aliases are part of the current transitional codebase and should not be interpreted as proof that every package is fully isolated.

---

## Repository layout

This is a responsibility-oriented guide to the current directories. It is not a statement that all boundaries are final.

~~~text
corex_engine/
├── index.js                       # Application bootstrap and shutdown
├── package.json                   # Backend dependencies and root scripts
├── package-lock.json
├── engine/
│   ├── server.js                  # Express app, REST mounts and WS upgrades
│   ├── core/                      # Engine, strategy loading, runtime and pipeline
│   ├── routes/                    # HTTP route/controller modules
│   ├── services/                  # Application services, persistence and integration
│   ├── workers/                   # Job worker and job handlers
│   └── modules/                   # Runtime-related modules
├── packages/
│   ├── corex-accounts/
│   ├── corex-auth/
│   ├── corex-broker-contract/
│   ├── corex-gateway/
│   ├── corex-market-data/
│   ├── corex-portfolio/
│   └── corex-strategy-engine/
├── broker/                        # Existing/legacy broker integrations
├── events/                        # Internal event bus
├── config/                        # Engine constants and configuration
├── utils/                          # Shared and legacy utilities
├── db/
│   ├── migrate.js                 # Database migration runner
│   └── migrations/                # Ordered SQL migrations
├── data/                          # Runtime data, cache, uploads and reports
├── front_end/
│   ├── src/
│   │   ├── api/                   # Frontend API clients
│   │   ├── components/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── store/                 # Zustand stores
│   │   └── views/                 # Main application views
│   └── package.json
├── scripts/                       # Maintenance, migration and utility scripts
├── test/                          # Jest tests
├── plans/                         # Architecture, audit and development plans
├── AGENTS.md                      # Agent/repository engineering instructions
└── SKILLS.md                      # Shared development skills and procedures
~~~

### Current package responsibilities

| Package | Responsibility represented by current source |
|---|---|
| `corex-strategy-engine` | Strategy context, parameters, indicators, validation and runtime support |
| `corex-market-data` | Provider contract/factory, market feed and historical data providers |
| `corex-broker-contract` | Broker contract/base classes, drivers, connectors, modes and fill/data utilities |
| `corex-gateway` | Account model/repository and Socket_X gateway/protocol components |
| `corex-portfolio` | Trade history and portfolio/equity/performance analytics |
| `corex-accounts` | Account and connection persistence/services |
| `corex-auth` | Authentication and secrets-vault functionality |

The root application still contains important domain and integration logic. Some package manifests also retain aliases to the older application directories. The development roadmap tracks the work needed to establish authoritative ownership and remove obsolete paths safely.

---

## Runtime request and event entry points

### HTTP route mounts

The Express server currently mounts these API route groups:

| Route prefix | Purpose |
|---|---|
| `/api/auth` | Authentication |
| `/api/strategies` | Strategy management and metadata |
| `/api/run` | Runtime/execution controls and telemetry |
| `/api/backtest` | Backtest runs, progress-related operations and dataset upload workflow |
| `/api/system` | System status and operational endpoints |
| `/api/bridge` | Bridge-related HTTP operations |
| `/api/mt5` | MT5-related HTTP operations |
| `/api/settings` | User/engine/integration settings |
| `/api/accounts` | Account and connector routes |
| `/api/data` | Candles, uploads, storage and report data |
| `/ping` | Basic public process response (`PONG`) |

Most application route groups are mounted with authentication middleware and a user-aware rate limiter. The bridge and MT5 route groups have their own route-level behavior; inspect their controllers before assuming a particular endpoint is public or protected.

### WebSocket endpoints

| Endpoint | Purpose |
|---|---|
| `/ws` | Authenticated CoreX application event stream |
| `/mt5` | Token-protected MT5 bridge connection |

The `/ws` upgrade accepts a Bearer token from the Authorization header or a token query parameter. Prefer the Authorization header in clients where it is supported; query-string credentials can be exposed in logs and intermediary tooling.

---

## Requirements

- Node.js `>=18` (as declared in the root package manifest).
- npm.
- PostgreSQL for persisted application functionality.
- A market-data provider API key for provider-backed market data.
- Broker credentials and/or an MT5 terminal/bridge for the corresponding integrations.
- Python only if you intend to run the optional MT5 receiver script.

The exact provider, broker and account requirements depend on which features you intend to use.

---

## Local development setup

### 1. Get the repository and install backend dependencies

~~~bash
git clone https://github.com/ssemandaowen/corex_engine.git
cd corex_engine
npm ci
~~~

### 2. Configure the backend environment

Copy the example file:

**Windows PowerShell**
~~~powershell
Copy-Item .env.example .env
~~~

**macOS / Linux**
~~~bash
cp .env.example .env
~~~

Edit `.env` and configure your PostgreSQL connection. The example file uses the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` variables. You can alternatively configure `DATABASE_URL`.

Create the PostgreSQL database before running migrations. Then configure the credentials and provider settings you actually use.

> **Security:** values in `.env.example` are development placeholders, not safe production credentials. Replace all placeholder passwords and secrets. Never deploy with the example JWT, admin password, or database password.

For production, set strong independent values for `JWT_SECRET`, `COREX_SECRETS_KEY` and `AUTH_KEY_PEPPER`. Production bootstrap rejects startup when these required values are missing.

### 3. Apply database migrations

~~~bash
npm run db:migrate
~~~

The application bootstrap also invokes the migration runner. The database migration history is stored under `db/migrations/`.

### 4. Start the backend

~~~bash
npm start
~~~

The default HTTP port is `3000`. The server's default CORS origin is `http://localhost:5173`. Set `PORT` and `CORS_ORIGIN` as required for your environment.

For automatic backend restarts during development:

~~~bash
npm run dev
~~~

### 5. Start the frontend

Install frontend dependencies:

~~~bash
npm --prefix front_end install
~~~

Start the Vite development server:

~~~bash
npm run ui:dev
~~~

By default, the frontend API client targets `http://localhost:3000`. To point it at another backend, define `VITE_API_URL` in the frontend environment (for example, `front_end/.env.local`):

~~~dotenv
VITE_API_URL=http://localhost:3000
~~~

Vite normally serves the frontend at `http://localhost:5173`, which matches the backend's default development CORS origin.

---

## Configuration reference

The complete and evolving list of environment settings is in `.env.example` and the configuration/service modules. Common settings include:

| Variable | Purpose |
|---|---|
| `PORT` | Backend HTTP port (default 3000) |
| `NODE_ENV` | Runtime environment |
| `DATABASE_URL` | Optional PostgreSQL connection string |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | PostgreSQL connection fields |
| `JWT_SECRET` | JWT signing/verification secret |
| `COREX_SECRETS_KEY` | Secrets-vault encryption key |
| `AUTH_KEY_PEPPER` | API-key hashing pepper |
| `TWELVE_DATA_KEY` | Twelve Data API key |
| `METAAPI_ACCOUNT_ID`, `METAAPI_TOKEN`, `METAAPI_SERVER` | MetaApi account connection configuration where used |
| `MT5_BRIDGE_TOKEN` | MT5 WebSocket bridge token |
| `COREX_LIVE_DRY_RUN` | Live execution safety configuration |
| `COREX_STRATEGY_WORKER_ENABLED` | Strategy worker configuration |
| `COREX_WS_*` | WebSocket status/feed/tick cadence and buffering controls |
| `BACKTEST_MAX_MB` | Maximum backtest CSV upload size |
| `BACKTEST_DB_DATASET_MAX_BARS` | Dataset bar limit setting |

CoreX also supports persisted settings managed through its settings services. Environment variables and persisted settings may interact; inspect the current configuration service before changing a setting's source of truth.

---

## Useful commands

Run from the repository root:

| Command | Description |
|---|---|
| `npm start` | Start the application |
| `npm run dev` | Start backend with Nodemon |
| `npm test` | Run the root Jest test suite |
| `npm run test:auth` | Run the configured authentication test files |
| `npm run db:migrate` | Apply database migrations |
| `npm run ui:dev` | Start the frontend Vite dev server |
| `npm run ui:build` | Build the frontend |
| `npm run ui:preview` | Preview the frontend production build |
| `npm --prefix front_end run lint` | Run frontend TypeScript checking |
| `npm run worker:jobs` | Run the job worker process |
| `npm run mt5:receiver` | Run the optional Python MT5 receiver |
| `npm run status` | Run the repository system-check script |

The root Jest configuration discovers tests matching `**/test/**/*.test.js`. Some package manifests also define package-local Jest scripts. A successful frontend build or an individual package test is not a substitute for the full backend suite and end-to-end verification.

---

## Data and persistence

PostgreSQL is used for user/account data, strategy records, settings, jobs, backtest records and other persisted application state. SQL migrations are maintained in `db/migrations/`.

The application also uses local runtime storage under `data/`, including:

- `data/cache/` — cached market/candle data;
- `data/uploads/` — uploaded backtest datasets and related indexes/files;
- `data/backtests/` — backtest report/artifact storage used by current modules.

These paths contain runtime data and should be backed up or managed according to the deployment's retention policy. Do not commit user datasets, reports, secrets or generated runtime files.

---

## Testing and verification

Run the root test suite:

~~~bash
npm test
~~~

Run frontend type checking and production build:

~~~bash
npm --prefix front_end run lint
npm run ui:build
~~~

For changes to a domain package, run its relevant tests as well as the root tests and integration tests that exercise its application boundary.

When reporting verification, include:
- the exact commit SHA and branch tested;
- the exact commands executed;
- passed, failed and skipped test counts;
- the full output or a durable CI/log artifact;
- the base-branch comparison when the change could affect existing behavior.

Do not describe tests as passing unless they were actually executed.

---

## Current architecture and development status

CoreX is in an architectural consolidation and rebuild process. The existing code should be understood before it is moved or replaced.

Current facts that contributors should keep in mind:

1. The backend application still composes modules from both `engine/` and `packages/`.
2. Legacy directories such as `broker/`, `utils/`, `events/` and `config/` remain active in parts of the runtime.
3. Module aliases still connect packages to application/legacy paths; package boundaries are not yet fully closed.
4. Backtesting is not yet owned by a dedicated `corex-backtest` package.
5. The frontend and backend have separate build/test workflows and must be verified together when API or WebSocket contracts change.
6. The repository contains transitional code and compatibility paths. Do not assume a file is obsolete based only on its location or age; trace its consumers first.

### Planned development direction

The intended direction is a maintainable modular monolith with explicit domain ownership, one authoritative implementation for each behavior, clear application/domain/adapter boundaries, reliable runtime and persistence behavior, and a frontend driven by real API/WebSocket state.

The active task board, architectural rules, phase gates and agent workflow are maintained in:

**[CoreX Development Plan](plans/COREX_DEVELOPMENT_PLAN.md)**

Important supporting documents:

- [Agent instructions](AGENTS.md)
- [Shared engineering skills](SKILLS.md)
- [Architecture and audit plans](plans/)
- [Architecture decisions](plans/decisions.md)

The roadmap is the active development source of truth. Historical task lists and audit documents are evidence, not independent authorization to begin new implementation work.

---

## Contributing

Before making changes:

1. Read [AGENTS.md](AGENTS.md), [SKILLS.md](SKILLS.md) and the [CoreX Development Plan](plans/COREX_DEVELOPMENT_PLAN.md).
2. Identify the roadmap task that owns the requested behavior.
3. Trace the full behavior through its API, application service, domain owner, adapter, persistence and frontend consumers where relevant.
4. Check the current branch and working tree before modifying files.
5. Keep the change within its approved scope and add tests at the layer that owns the behavior.
6. Record exact test evidence and update the roadmap task with its branch/PR, commit and verification results.

Do not introduce a second implementation to patch around an existing one. Do not delete legacy code until its consumers have been migrated and the replacement has passed its acceptance criteria. Architectural, security, database, execution and public-contract changes require owner review as described in the roadmap.

---

## License

Proprietary / UNLICENSED. See the root package manifest.
