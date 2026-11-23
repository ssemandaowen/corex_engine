# Provider Integration Verification — Context Handoff

**Created:** 2026-11-22  
**Repository:** `ssemandaowen/corex_engine`  
**Checkout:** `C:\\Users\\SBUM\\Desktop\\corex`  
**Branch:** `main`, tracking `origin/main`  
**Purpose:** Give the next agent the current provider architecture, environment/credential discovery facts, live-service observations, and boundaries for the integration-verification task.

## 1. Current repository state and working boundaries

- The checkout is on `main...origin/main`; the latest main SHA recorded in the existing handoff is `1f39d1fd87cba7d2b569c4120ddf16400b11878a`.
- The working tree is **not clean**. It contains extensive existing uncommitted implementation and planning changes, including the previous backtest report-path fix and the P0-A through P0-D symbol/binding/parameter/error-policy work.
- Preserve every existing modification. Do not reset, clean, checkout over, stash, stage, commit, push, or merge.
- The previous independent verification recorded **77 suites / 911 tests passing** after the P0 correction round. Do not reopen that implementation work unless the live integration checks produce a reproducible contradiction.
- P0-A through P0-D are accepted at code/test level; the remaining evidence gap is real integration behavior.
- The active roadmap is `plans/ROADMAP.md`. P2 strategy-contract retirement is currently IN PROGRESS. This provider task is a bounded verification activity, not permission to start another implementation phase or change the roadmap sequence.
- The authoritative existing working changes and task state must be re-read by Kilo before any run. This handoff is not a substitute for fresh Git status.

## 2. Market-data provider architecture — inspected current implementation

The market-data domain is owned by `packages/corex-market-data/`.

### 2.1 Main layers

1. **Provider contract** — `src/DataProviderContract.js`
   - Defines the required provider surface: `connect`, `subscribe`, `unsubscribe`, `fetchHistory`, `getCapabilities`, `getStatus`, and `cleanup`.
   - Uses typed `DataProviderError` codes such as `AUTH_FAILED`, `PROVIDER_KEY_MISSING`, `SYMBOL_NOT_FOUND`, `SYMBOL_UNSUPPORTED`, `RATE_LIMITED`, and `PROVIDER_UNAVAILABLE`.
   - Runtime tick delivery is expected on the existing market event bus.

2. **Provider registry / dispatcher** — `src/DataProviderFactory.js`
   - Holds a registry of provider instances/factories and one active provider.
   - Routes historical fetches, subscriptions, unsubscriptions, status and capabilities.
   - Enforces the global 5,000-bar cap and uses `DataPaginationLayer` for chunking when needed.
   - This is currently a singleton registry, not a dynamically discovered plugin catalogue.

3. **Package entrypoint / default wiring** — `packages/corex-market-data/index.js`
   - Exports the factory, contract, providers, resolver and MarketFeed.
   - At module load, it creates and registers a Twelve Data provider and sets it active.
   - Current production registration found by repository search: Twelve Data only. Yahoo and File providers are exported, but no production registration call was found for them.

4. **MarketFeed** — `src/MarketFeed.js`
   - Tracks active runtime subscriptions and routes provider ticks to runtime consumers.
   - Recent local changes implement shared-symbol reference-count behavior: only unsubscribe upstream when the final runtime releases a symbol.
   - Its behavior must be tested through the actual factory/provider lifecycle, not only by manually setting provider state.

5. **Backtest data resolver / pagination** — `src/backtestDataResolver.js` and `corex-broker-contract`'s `DataPaginationLayer`
   - Historical data is consumed by warmup and backtest paths through the factory.
   - Provider-specific capabilities and pagination limits matter to backtest correctness.

### 2.2 Provider implementations

| Provider | Implementation | Current role / limits |
|---|---|---|
| Twelve Data | `src/providers/TwelveDataProvider.js` wrapping `src/legacy/twelvedata.js` | Current default active provider. REST history plus WebSocket real-time through the legacy singleton. Canonical symbols are formatted at this adapter boundary and normalized on inbound data. |
| Yahoo Finance | `src/providers/YahooFinanceProvider.js` using `yahoo-finance2` | Historical chart provider; `getCapabilities().streaming` is false. Reads optional `YAHOO_API_KEY`; current provider constructor can connect without a key. It is exported but not registered as active in the package entrypoint. |
| File | `src/providers/FileDataProvider.js` | Local CSV/JSON/JSONL/gzip history and replay. Can emit file rows as market ticks; not an external API provider. |
| OANDA | No current provider implementation found in `packages/corex-market-data` | `OANDA_API_KEY` exists in the local `.env`, but code search found no application consumer. `@oanda/v20` remains in package dependencies/lockfile; a prior decision records it as unused. Treat as an unconsumed/legacy credential until proven otherwise. Do not call it merely because the key exists. |

### 2.3 Provider symbol handling

- Canonical symbols are owned by `corex-broker-contract`'s `SymbolNormalizer` / instrument utilities.
- Provider-specific conversion belongs at each provider boundary.
- Twelve Data formatting is in `src/providers/twelvedata/symbolFormat.js`, using `resolveInstrument` and `toProviderSymbol`.
- Its override map is intentionally empty because metals, indices and USDT spellings were explicitly unverified. Do not invent aliases or claim support from formatter output alone.
- Yahoo has its own canonical-to-Yahoo reverse map because punctuation removal can be lossy (for example, equity suffixes).
- File data is normalized when rows are mapped/emitted.
- The integration task must distinguish canonical identity, provider wire symbol, provider response identity and actual instrument semantics.

## 3. Related integrations that are NOT the same thing as market-data providers

Do not collapse these into the market-data provider list:

- **MetaApi** is currently represented as a broker/execution connector path, not as a registered `corex-market-data` provider. The README describes the current `MetaApiConnector` / live path as a structural skeleton returning mock data. Its credentials are account-scoped connector secrets in PostgreSQL and may be copied into process environment by `engine/services/integrationRuntime.js`.
- **MT5 bridge** is an execution/terminal bridge. `MT5_BRIDGE_TOKEN` protects the `/mt5` WebSocket upgrade; `COREX_MT5_HTTP_TOKEN` protects the HTTP bridge path. Do not treat these as data-provider API keys.
- **Paper / Backtest / Live broker drivers** are broker/execution modes. Paper file replay may consume market data but is not itself a remote provider.
- **Twelve Data** has both a modern package adapter and a legacy singleton transport implementation. Avoid treating the legacy file as an independent second provider.
- The connector service currently declares `twelvedata` and `metaapi` connector schemas. The DB connection record stores encrypted credentials; tests cover account-specific MetaApi records. Do not print or decrypt secrets for reporting.

## 4. Environment discovery facts — values deliberately not recorded

The local `.env` was inspected only for variable names and non-secret presence metadata. No secret values were read into this handoff.

### 4.1 Environment names found in the local `.env`

The key inventory included (names only):

- Credentials / authentication: `ADMIN_SECRET`, `JWT_SECRET`, `AUTH_ADMIN_EMAIL`, `AUTH_ADMIN_PASSWORD`, `CorexToken`, `MT5_BRIDGE_TOKEN`, `TWELVE_DATA_KEY`, `YAHOO_API_KEY`, `OANDA_API_KEY`.
- Database: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
- Runtime/server: `PORT`, `NODE_ENV`, `ALLOW_LEGACY_ADMIN_KEY`, `COREX_LIVE_DRY_RUN`, `COREX_STRATEGY_WORKER_ENABLED`, `COREX_PAPER_AUTO_RESET`, `COREX_STRATEGY_RUNTIME_TIMEOUT_MS`.
- Job worker, WebSocket, upload, retention and culling configuration: the corresponding `COREX_JOB_*`, `COREX_WS_*`, `BACKTEST_*`, `COREX_DB_*`, `COREX_UPLOADS_*`, and `COREX_CULL_*` variables.

The sample file `.env.example` does not include `OANDA_API_KEY`, so it is an additional local-only key worth classifying. The inventory above is not a replacement for Kilo's fresh scan; Kilo must dynamically enumerate the current file without printing values.

### 4.2 Known credential-source behavior

- `TWELVE_DATA_KEY` is read by the legacy Twelve Data singleton and TwelveDataProvider; the provider also recognizes `TWELVE_DATA_API_KEY` as an alternate environment name.
- `YAHOO_API_KEY` is read by YahooFinanceProvider, but Yahoo Finance's `yahoo-finance2` chart path is not proof that this key is required or that authenticated API access is configured.
- `OANDA_API_KEY` is present in the local file but no application code consumer was found in the repository search. The dependency is recorded as unused in prior decisions.
- `METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, and `METAAPI_SERVER` are populated by `integrationRuntime.refresh()` from account/settings configuration; they were not listed in the local `.env` key inventory.
- Twelve Data and MetaApi settings may also be held in DB-backed settings/connector records. Environment variables are not the only credential source.
- `MT5_BRIDGE_TOKEN` and `COREX_MT5_HTTP_TOKEN` are bridge authentication secrets, not market-data credentials.
- A frontend MetaApi settings view contains a credential-like hardcoded default. Kilo must inspect and classify this as a possible unsafe demo/default secret without reproducing the literal in logs or reports. Do not use it as a real credential.

### 4.3 Runtime config precedence to verify

There are multiple configuration paths:
- `.env` / `process.env`.
- DB-backed settings such as `ui.integrations.marketData.twelveDataApiKey`.
- Account-scoped encrypted connector credentials for MetaApi and Twelve Data.
- `integrationRuntime.refresh()`, which copies some settings into process environment and applies runtime config to the legacy data singleton / MT5 bridge.

Kilo must map the actual precedence and lifecycle, including whether a running server has loaded the latest settings. Do not assume that a key present in the file is the key currently held by an already-running process.

## 5. Live-service observations at handoff creation

The following checks were made without restarting or stopping anything:

- Local engine HTTP port **3000** responded to `http://127.0.0.1:3000/` with HTTP 404 and Express's `Cannot GET /`. This confirms a listener, not application health.
- PostgreSQL TCP port **5432** accepted a connection.
- Frontend port **5173** was not listening at the time of the check.
- The CoreX MCP-managed process list was empty; the existing engine/DB processes appear to be outside that process manager. Do not infer that they are stopped.
- The local `.env` reported a configured `PGHOST` / `PGDATABASE` path and a non-empty `TWELVE_DATA_KEY` / `OANDA_API_KEY` when checked via presence-only metadata. Other credential presence was not reliably recorded because output redaction obscured it.
- Older CoreX log entries warned that Twelve Data key was missing. Those entries are historical and may predate the currently running server or reflect config precedence. Verify current runtime status directly; do not treat old log lines as current truth.
- The actual DB connection target and database name must not be printed in a public task result if they contain sensitive information.

## 6. Remaining integration-verification scope

The task in `plans/tasks/P0-provider-integration-verification.md` is the executable specification. It covers:

1. Dynamic inventory of all environment and DB-backed provider/connector credentials, consumers, ownership and configuration precedence.
2. Twelve Data real REST and WebSocket request checks, only if the running process / safe test process has a valid credential.
3. Yahoo Finance live historical-data verification if current configuration and provider access permit it; streaming must be marked unsupported, not tested as if it exists.
4. Discovery of any other implemented providers/connectors before deciding what can be tested. OANDA is not assumed to be implemented.
5. Provider symbol compatibility checks for metals, indices, USDT pairs and ordinary FX/crypto/equity controls, with actual response identity validation.
6. Database + worker runtime identity equivalence for `BTC/USD` versus `BTCUSD`, using PAPER/test-only semantics and existing identity rules.
7. Running-app checks, provider status, worker status, API health, DB health and safe cleanup.

## 7. Explicit non-goals and safety

- This is verification and evidence gathering, not implementation.
- No application source edits, refactors, provider registration changes, symbol overrides, new config framework, migrations or schema changes.
- No orders, trades, deposits, withdrawals, account resets or real LIVE execution.
- No printing, logging, echoing, copying into task files, screenshots, shell history or chat of secret values, tokens, connection strings or decrypted connector credentials.
- Do not restart or stop the existing engine or PostgreSQL processes. Do not spawn a duplicate engine on port 3000.
- Do not run DB migrations or destructive SQL. Use read-only DB inspection unless an isolated disposable test record is specifically required and safe.
- Preserve all pre-existing dirty files. Report only task-owned artifacts and test-owned data cleanup.
- If a real defect is found, record a separate bounded implementation recommendation for Owen/Kilo approval. Do not patch it as part of this task.

## 8. Handoff entry point

Start by reading:
1. `plans/ROADMAP.md`
2. `plans/AGENT_WORKFLOW.md`
3. `plans/tasks/P0-provider-integration-verification.md`
4. `plans/architecture/BACKTEST_SPEC_SYMBOL_AND_RUNTIME_BINDING_DESIGN.md`
5. `plans/Audit/package-2-market-data.md`
6. The exact provider / config / worker source files named by the task.

The task file is the Kilo Code prompt and acceptance contract. The task remains verification-only until Owen separately approves any implementation work.
