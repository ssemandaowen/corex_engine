# Provider Integration Verification Results

> **Historical baseline note (2026-11-22):** This report records the initial verification-only findings. The subsequent P1 implementation and acceptance review supersede its Yahoo Finance incompatibility, frontend credential-default, and runtime-identity limitations. See `plans/tasks/P1-yahoo-finance-compatibility.md`, `plans/tasks/P1-frontend-credential-security.md`, `plans/tasks/P1-runtime-identity-integration.md`, and the user's accepted P1 review. Do not treat the initial `Overall Result: PARTIAL` or the initial Yahoo/runtime blocker statements below as current status. Real external Yahoo Finance service availability after the v4 fix remains distinct from the 21 passing adapter tests.

**Task:** P0 — Provider, Credential, Runtime and Running-App Integration Verification  
**Repository:** `C:\Users\SBUM\Desktop\corex`  
**Branch:** `main` tracking `origin/main`  
**HEAD SHA:** `1f39d1fd87cba7d2b569c4120ddf16400b11878a`  
**Execution date:** 2026-11-22  
**Mode:** Verification only — no implementation, no source changes, no LIVE execution

---

## Overall Result: PARTIAL

Twelve Data REST and WebSocket are fully operational. Yahoo Finance provider is incompatible with the installed `yahoo-finance2` v4.x. OANDA is an unconsumed dependency/credential. MetaApi is a structural skeleton. MT5 bridge credentials are authentication-only, not market-data.

---

## Baseline and Service Health

| Check | Method | Status | Evidence |
|---|---|---|---|
| Engine listener | TCP port 3000 | OPEN | PID 2676, `netstat` confirms LISTENING |
| Engine HTTP | `GET http://127.0.0.1:3000/ping` | HTTP 200 | Body: `PONG` |
| Engine root | `GET http://127.0.0.1:3000/` | HTTP 404 | Express `Cannot GET /` — listener confirmed, not health proof |
| PostgreSQL | TCP port 5432 | OPEN | PID 27268, `netstat` confirms LISTENING |
| Frontend | TCP port 5173 | NOT LISTENING | Frontend not running |
| DB via app pool | `db.query("SELECT 1")` from app process | OK | Application pool connected to PostgreSQL |
| DB tables | `information_schema.tables` | OK | 33 tables present including `strategy_runtimes`, `corex_jobs`, `connections`, `system_settings` |
| Job worker | `corex_jobs` table | 128 jobs | 48 succeeded, 79 failed, 1 cancelled |
| `integrationRuntime.refresh()` | Source inspection | Writes DB settings to `process.env` and calls `legacyMarketData.applyRuntimeConfig()` | Copies `twelveDataApiKey`, `metaApi.*`, `mt5Bridge.*` into env; applies directly to legacy singleton |

**Health endpoints available (all `/api/*` require JWT auth; `/ping` is public):**
- `GET /ping` — public, returns PONG
- `GET /api/system/heartbeat` — auth required, returns DB/worker/market-data/bridge status
- `GET /api/system/health/control-gates` — auth required, DB + MT5 + strategy hash gates
- `GET /api/settings/health` — auth required
- `GET /api/system/feed/metrics` — auth required
- `GET /api/system/ws-health` — auth required

**Pre-existing dirty tree preserved:** 27 modified files + 16 untracked files (see `git status --short --branch`). No file was modified, staged, committed, or reverted by this task.

---

## Provider / Credential / Integration Inventory

| # | Name | Category | Implementation path | Contract | Registered/Active | Credential source | Safe to verify? |
|---|---|---|---|---|---|---|---|
| 1 | Twelve Data | Active market-data provider | `packages/corex-market-data/src/providers/TwelveDataProvider.js` (wraps `src/legacy/twelvedata.js`) | `DataProviderContract` | YES — auto-registered active in package `index.js` | `TWELVE_DATA_KEY` (env), `TWELVE_DATA_API_KEY` (env alt), `ui.integrations.marketData.twelveDataApiKey` (DB) | YES |
| 2 | Yahoo Finance | Implemented but not registered/selected | `packages/corex-market-data/src/providers/YahooFinanceProvider.js` (uses `yahoo-finance2` v4) | `DataProviderContract` | NO — exported, no production registration call found | `YAHOO_API_KEY` (env, optional) | YES (but broken — see defects) |
| 3 | File | Local/file/replay source | `packages/corex-market-data/src/providers/FileDataProvider.js` | `DataProviderContract` | NO — exported, not registered | None (file path config) | N/A (no file configured) |
| 4 | OANDA | Dependency/credential, no application consumer | `@oanda/v20` dependency; `OANDA_API_KEY` in `.env` | None | NO — no provider class, no consumer found | `OANDA_API_KEY` (env) | NO — not implemented |
| 5 | MetaApi | Broker/execution connector (NOT market-data) | `packages/corex-broker-contract/src/drivers/MetaApiDriver.js` + `src/connectors/MetaApiConnector.js` | `BrokerContract` → `BaseBroker` | NO — LIVE driver uses skeleton connector | DB-backed: `METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, `METAAPI_SERVER` (via `integrationRuntime.refresh()`) | NO — skeleton returns `success: true` without execution |
| 6 | MT5 Bridge | Bridge authentication (NOT market-data) | `MT5_BRIDGE_TOKEN` protects `/mt5` WS upgrade; `COREX_MT5_HTTP_TOKEN` protects HTTP bridge | None | N/A | `MT5_BRIDGE_TOKEN`, `COREX_MT5_HTTP_TOKEN` (env) | NO — not a data provider |

**DB-backed connector records:** `connections` table has 0 rows. `user_connector_settings` has 0 rows. `CONNECTOR_SCHEMAS` declares only `twelvedata` (secret: `apiKey`) and `metaapi` (secret: `token`). `oanda` is NOT in `CONNECTOR_SCHEMAS`.

**System settings:** 1 row in `system_settings`, payload has no `ui.integrations` configured (`twelveDataApiKeyPresent: false`).

---

## Credential Presence-Only Matrix

| Variable | Present? | Category | Consumed by | In `.env.example`? | Notes |
|---|---|---|---|---|---|
| PGHOST | SET | Database | `connectionsService.js`, `postgres.js` | YES | |
| PGPORT | SET | Database | `connectionsService.js` | YES | |
| PGUSER | SET | Database | `connectionsService.js` | YES | |
| PGPASSWORD | SET | Database | `connectionsService.js` | YES | |
| PGDATABASE | SET | Database | `connectionsService.js` | YES | |
| TWELVE_DATA_KEY | SET | Credential | `legacy/twelvedata.js` (`config.apiKey`), `TwelveDataProvider` (`process.env.TWELVE_DATA_KEY`) | YES | Also read as `TWELVE_DATA_API_KEY` alternate |
| TWELVE_DATA_API_KEY | NOT FOUND | Credential | `TwelveDataProvider` fallback | NO | Alternate env name, not in `.env` |
| YAHOO_API_KEY | NOT FOUND | Credential | `YahooFinanceProvider` (`process.env.YAHOO_API_KEY`) | YES | Stored but not proven required by `yahoo-finance2` |
| OANDA_API_KEY | SET | Credential | NO CONSUMER FOUND | NO | Local-only key, not in `.env.example`, `@oanda/v20` unused |
| MT5_BRIDGE_TOKEN | SET | Credential (bridge auth) | `engine/server.js` WS upgrade auth, `integrationRuntime.applyEnvVar` | YES | Not a market-data credential |
| COREX_MT5_HTTP_TOKEN | NOT FOUND | Credential (bridge auth) | `integrationRuntime.applyEnvVar` | NO | |
| JWT_SECRET | SET | Auth | `authService.js` | YES | |
| ADMIN_SECRET | SET | Auth | `healthCheck.js` (MT5 token fallback), admin middleware | YES | |
| AUTH_ADMIN_EMAIL | SET | Auth | Auth routes | YES | |
| AUTH_ADMIN_PASSWORD | SET | Auth | Auth routes | YES | |
| ALLOW_LEGACY_ADMIN_KEY | SET | Auth | Auth middleware | YES | |
| COREX_LIVE_DRY_RUN | SET | Runtime | Broker execution paths | YES | |
| COREX_STRATEGY_WORKER_ENABLED | SET | Runtime | `strategyRuntime/workerPool.js` | YES | |
| COREX_SECRETS_KEY | NOT CHECKED | Encryption | `SecretsVault.js` | NOT in `.env` | Required for DB secret encryption |

**Note:** Presence-only checks performed. No secret values, lengths, prefixes, or hashes were recorded or printed.

**Hardcoded frontend default discovered:** `front_end/src/views/SettingsView.tsx:174` contains a hardcoded MetaApi `accountId` and `token` as React `useState` defaults. Also `SettingsView.tsx:80` has `default: 'mt5_sec_token_hash_value'`. These are credential-like defaults in frontend source — classified as possible unsafe demo/default secrets. Not used for authentication.

---

## Configuration Precedence and Refresh Findings

1. **`TWELVE_DATA_KEY` precedence (TwelveDataBroker._loadConfig):**
   - DB-backed `ui.integrations.marketData.twelveDataApiKey` wins over `process.env.TWELVE_DATA_KEY`
   - `integrationRuntime.refresh()` writes DB value to `process.env.TWELVE_DATA_KEY` AND calls `legacyMarketData.applyRuntimeConfig()` directly on the singleton
   - Running process may hold different key than `.env` if DB settings exist and refresh was called

2. **`integrationRuntime.refresh()`:**
   - Triggered by `EVENTS.SYSTEM.CONFIG_REFRESH` (from settings PATCH endpoints)
   - Also called during `index.js` bootstrap
   - Applies to legacy Twelve Data singleton, MT5 bridge, MetaApi env vars
   - Does NOT re-instantiate `TwelveDataProvider` (adapter reads `process.env` at construction)

3. **DB-backed settings not currently populated:** `system_settings` has no `ui.integrations` — all provider config currently comes from `.env`

---

## Real Provider Request Evidence

### Twelve Data — REST `fetchHistory`

| Symbol | Wire symbol | Interval | Bars | Status | Identity validated | Duration |
|---|---|---|---|---|---|---|
| EUR/USD | EUR/USD | 1h | 10 | OK | Yes (EURUSD) | 1014 ms |
| XAU/USD | XAUUSD | 1h | 0 | SYMBOL_NOT_FOUND (HTTP 404) | N/A | 296 ms |
| BTC/USD | BTC/USD | 1h | 5 | OK | Yes (BTCUSD) | 290 ms |
| BTCUSDT | BTCUSDT | 1h | 0 | SYMBOL_NOT_FOUND (HTTP 404) | N/A | 274 ms |
| SPX500 | SPX500 | 1h | 0 | SYMBOL_NOT_FOUND (HTTP 404) | N/A | 280 ms |

**Sample bar (EUR/USD):** `time=1795341600000, open=1.0972, high=1.09743, low=1.09692, close=1.09705, volume=0, symbol=EURUSD`
**Timestamp units:** Epoch milliseconds (confirmed)
**OHLCV validity:** All fields finite, high >= low, close within [low, high]

### Twelve Data — WebSocket

| Symbol | Wire symbol | Tick received | Price | Time | Status | Cleanup |
|---|---|---|---|---|---|---|
| EUR/USD | EUR/USD | Yes | 1.09726 | 1795329720000 | OK | Unsubscribe + cleanup executed |

**Connection lifecycle:** `connect()` → WS OPEN → `subscribe()` → inbound `price` event → `unsubscribe()` → `cleanup()`. No API key appeared in logs, exceptions, or output.

### Yahoo Finance — `fetchHistory`

| Symbol | Status | Error |
|---|---|---|
| EURUSD=X | ERROR | `PROVIDER_UNAVAILABLE: yahooFinance.chart() expects a single string symbol as its query, not an object` |
| AAPL | ERROR | Same — `yahoo-finance2` v4.x `chart()` signature changed |

**Root cause:** Installed `yahoo-finance2@^4.0.2` has a different API than the provider code expects. Provider passes `{symbol, interval, range, includePrePost}` object; v4.x expects a string symbol. `YAHOO_API_KEY` is not set in `.env`.

---

## Symbol Compatibility Matrix

| CoreX input | Canonical symbol | Classification | Provider wire symbol | Provider response | Correctness | Evidence |
|---|---|---|---|---|---|---|
| EUR/USD | EURUSD | FX | EUR/USD | Accepted (5 bars, close=1.09705) | Confirmed | Twelve Data REST response, identity validated |
| BTC/USD | BTCUSD | Crypto | BTC/USD | Accepted (5 bars, close=59498.58) | Confirmed | Twelve Data REST response, identity validated |
| XAU/USD | XAUUSD | Other (metals) | XAUUSD | Rejected — HTTP 404 `DATA_UNAVAILABLE` | Rejected | Twelve Data does not support `XAUUSD` |
| SPX500 | SPX500 | Other (index) | SPX500 | Rejected — HTTP 404 `DATA_UNAVAILABLE` | Rejected | Twelve Data does not support `SPX500` |
| BTCUSDT | BTCUSDT | Other (USDT pass-through) | BTCUSDT | Rejected — HTTP 404 `DATA_UNAVAILABLE` | Rejected | Twelve Data does not support `BTCUSDT` |

**Counts:** 2 confirmed, 3 rejected by provider, 0 unresolved (all tested against live provider).

**Note:** Metals, indices, and USDT are classified as `other` by `Instruments.resolveInstrument()` but are NOT actually supported by Twelve Data under the tested spellings. No symbol overrides were added (override table is intentionally empty per design).

---

## DB / Worker Runtime Identity Evidence

**Existing runtime records (read-only):**
| runtime_id | symbol | runtime_mode | actual_state | params |
|---|---|---|---|---|
| `<redacted>` | BTC/USD | PAPER | STOPPED | {} |
| `<redacted>` | BTC/USD | PAPER | STOPPED | `{"fastPeriod":12,"slowPeriod":26}` |

Both existing runtimes are `STOPPED` (not active) — no conflict with testing.

**Symbol binding verification (`engine/core/runtime/SymbolBinder.js`):**
- `bindSymbol(["BTC/USD"], "BTC/USD")` → canonical=`BTCUSD`, identitySymbol=`BTC/USD`, assetClass=`crypto`
- `bindSymbol(["BTC/USD"], "BTCUSD")` → canonical=`BTCUSD`, identitySymbol=`BTC/USD`, assetClass=`crypto`
- Same canonical: **YES** (BTCUSD ≡ BTCUSD)
- Same runtimeId (`strategyId::identitySymbol::mode`): **YES** (both produce `strat-1::BTC/USD::PAPER`)
- Runtime identity format: `<strategyId>::<symbol>::<mode>` (confirmed in `SymbolBinder.js:124`)

**Full API → queue → worker → runtime path:** NOT exercised. Requires JWT authentication which was not available. Verification limited to `bindSymbol()` unit-level confirmation and DB record inspection.

**No duplicate runtimes created.** No LIVE execution. No pre-existing runtime mutated.

---

## Tests and Commands

| Suite | Command | Result |
|---|---|---|
| Focused (market-data + symbols) | `npx jest packages/corex-market-data/test/DataProviderContract.test.js packages/corex-market-data/test/TwelveDataProvider.test.js packages/corex-market-data/test/backtestDataResolver.test.js packages/corex-market-data/test/MarketFeedSubscription.test.js packages/corex-broker-contract/test/Instruments.test.js` | 5 suites / 95 tests passed |
| Focused (broker-contract + connectors) | `npx jest packages/corex-broker-contract/test/factory.test.js packages/corex-broker-contract/test/publicApi.test.js packages/corex-broker-contract/test/modes.test.js packages/corex-accounts/test/connections.test.js engine/test/connectorSettingsService.test.js` | 5 suites / 72 tests passed |
| Full repository | `npm test` | **77 suites / 911 tests passed** |
| Pre-existing baseline | Roadmap records 67 suites / 766 tests (B3 merge) | Current: 77 suites / 911 tests |

No test snapshots or source were altered. Tests did not write to production data.

---

## Failures, Limitations, and Cleanup

| Item | Detail |
|---|---|
| Yahoo Finance provider | Incompatible with `yahoo-finance2` v4.x — `chart()` expects string symbol, provider passes options object. Provider reports `authorized: false` (no `YAHOO_API_KEY` set). |
| Full API path for runtime identity | Not exercised — requires JWT auth credentials not available to this verification task. |
| Frontend | Port 5173 not running — end-to-end UI check not possible. |
| Authenticated `/api/*` endpoints | Not probed — require JWT token. |
| OANDA | Not implemented — no consumer code found. Not tested. |
| MetaApi | Skeleton connector — returns `success: true` without execution. Not tested as market-data. |
| MT5 Bridge | Authentication-only credentials. Not tested (would require terminal connection). |

**Cleanup:** No test-owned DB records were created. No pre-existing records were modified. No source files were changed.

---

## Prioritized Follow-Up Defects

### Defect 1 — Yahoo Finance provider broken (HIGH)
**Evidence:** `packages/corex-market-data/src/providers/YahooFinanceProvider.js:151` calls `yahoo.chart(queryOpts)` with an options object. Installed `yahoo-finance2@^4.0.2` expects a string symbol. Both `EURUSD=X` and `AAPL` return `PROVIDER_UNAVAILABLE`.
**Recommended action:** Separate implementation task — update `YahooFinanceProvider.fetchHistory()` to match `yahoo-finance2` v4.x API, or pin a compatible version. Requires Owen's approval.

### Defect 2 — Frontend hardcoded MetaApi default (MEDIUM)
**Evidence:** `front_end/src/views/SettingsView.tsx:174` — `useState({ accountId: 'ma_9832103a', token: 'eyJ...' })` contains a credential-like default. `SettingsView.tsx:80` — `default: 'mt5_sec_token_hash_value'`.
**Recommended action:** Remove or replace with empty defaults. Requires Owen's approval.

### Defect 3 — DB-backed provider config not populated (LOW)
**Evidence:** `system_settings` table has no `ui.integrations.marketData.twelveDataApiKey`. All provider config comes from `.env` only. DB-backed settings path exists but is unused.
**Recommended action:** Document or populate DB-backed integration settings. Requires Owen's approval.

---

## Artifacts

- `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_RESULTS.md` (this file)
- `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_EVIDENCE.md` (sanitized evidence transcript)

---

## Safety Confirmation

- [x] No application source code modified
- [x] No secrets exposed (no values, lengths, prefixes, or hashes printed)
- [x] No LIVE trades or financial side effects
- [x] No database migrations or destructive SQL
- [x] No pre-existing uncommitted work overwritten or reverted
- [x] No duplicate engine or worker processes started
- [x] Existing services (engine PID 2676, PostgreSQL PID 27268) left running undisturbed

---

## Unresolved Blockers (require Owen)

1. **Yahoo Finance provider incompatibility** — needs implementation fix (separate task)
2. **Full API→worker→runtime identity test** — requires JWT auth credentials; could not exercise the authenticated API path
3. **Frontend hardcoded MetaApi default** — needs removal/replacement (separate task)