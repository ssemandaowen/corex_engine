# Provider Integration Verification — Evidence

**Task:** P0 — Provider, Credential, Runtime and Running-App Integration Verification  
**Execution date:** 2026-11-22  
**Correlation ID:** `verify-1795329649417`  
**Mode:** Verification only — no secrets, no connection strings, no raw credential records

---

## Command Transcript Excerpts (Sanitized)

### Baseline

```
git status --short --branch
## main...origin/main
 M engine/backtestManager.js
 M engine/core/loader/StrategyLoader.js
 M engine/core/runtime/RuntimeLifecycle.js
 M engine/routes/backtestController.js
 M engine/routes/strategyController.js
 M engine/services/strategyCompiler.js
 M engine/services/userScope.js
 M engine/strategyLoader.js
 M engine/workers/jobWorker.js
 M engine/workers/jobs/backtestRun.js
 M packages/corex-broker-contract/index.js
 M packages/corex-broker-contract/src/utils/SymbolNormalizer.js
 M packages/corex-market-data/src/DataProviderContract.js
 M packages/corex-market-data/src/MarketFeed.js
 M packages/corex-market-data/src/legacy/twelvedata.js
 M packages/corex-market-data/src/providers/TwelveDataProvider.js
 M packages/corex-market-data/test/DataProviderContract.test.js
 M packages/corex-market-data/test/TwelveDataProvider.test.js
 M packages/corex-market-data/test/backtestDataResolver.test.js
 M packages/corex-strategy-engine/index.js
 M packages/corex-strategy-engine/src/Strategy.js
 M plans/KNOWN_ISSUES.md
 M plans/ROADMAP.md
 M plans/context-handoff-summary.md
 M plans/tasks/B3-sandbox-module-resolution.md
 M test/backtest-report-path.test.js
 M test/engine-warmup-dispatch.test.js
 M utils/BaseStrategy.js
?? engine/core/runtime/SymbolBinder.js
?? engine/services/jobErrorPolicy.js
?? packages/corex-broker-contract/src/utils/Instruments.js
?? packages/corex-broker-contract/test/Instruments.test.js
?? packages/corex-market-data/src/providers/twelvedata/
?? packages/corex-market-data/test/MarketFeedSubscription.test.js
?? packages/corex-strategy-engine/src/ParamResolver.js
?? packages/corex-strategy-engine/test/ParamResolver.test.js
?? plans/architecture/BACKTEST_SPEC_SYMBOL_AND_RUNTIME_BINDING_DESIGN.md
?? plans/architecture/PROVIDER_INTEGRATION_VERIFICATION_HANDOFF.md
?? plans/tasks/P0-provider-integration-verification.md
?? plans/tasks/P2-strategy-contract-retirement.md
?? test/backtestSymbolBinding.test.js
?? test/jobErrorPolicy.test.js
?? test/liveSymbolBinding.test.js
?? test/paramParity.test.js
?? test/strategySchemaRoute.test.js
?? test/strategySchemaState.test.js
?? test/symbolBinding.test.js
```
*27 modified, 16 untracked — all pre-existing, preserved untouched.*

```
git rev-parse HEAD
1f39d1fd87cba7d2b569c4120ddf16400b11878a
```

```
netstat -ano | findstr ":3000 :5432 :5173"
TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 2676
TCP 127.0.0.1:5432 0.0.0.0:0 LISTENING 27268
```
*Port 5173 (frontend) — no listener.*

```
Invoke-WebRequest http://127.0.0.1:3000/ping
HTTP 200 | Body: PONG
```

```
Invoke-WebRequest http://127.0.0.1:3000/
HTTP 404
```

### Environment (variable names only — no values)

```
# .env variable names (presence only)
PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE,
ADMIN_SECRET, JWT_SECRET, AUTH_ADMIN_EMAIL, AUTH_ADMIN_PASSWORD,
ALLOW_LEGACY_ADMIN_KEY, TWELVE_DATA_KEY, YAHOO_API_KEY,
MT5_BRIDGE_TOKEN, OANDA_API_KEY,
COREX_LIVE_DRY_RUN, COREX_STRATEGY_WORKER_ENABLED

# .env is git-ignored: confirmed
```

### DB Read-Only Inspection

```
# Tables present (33 total)
backtest_market_data, backtest_uploads, backtests, bridge_status,
broker_settings, connections, corex_jobs, corex_sessions,
execution_control, execution_events, mt5_messages, order_fills,
orders, paper_trades, positions, quota_profiles, schema_migrations,
strategies, strategy_runtimes, strategy_signals, strategy_ticks,
strategy_ticks_p0, strategy_versions, system_settings,
trading_accounts, user_accounts, user_broker_settings,
user_connector_settings, user_engine_settings, user_system_settings, users

# strategy_runtimes (2 rows, both BTC/USD PAPER STOPPED)
symbol=BTC/USD, runtime_mode=PAPER, actual_state=STOPPED (x2)

# corex_jobs
status=succeeded n=48; status=failed n=79; status=cancelled n=1

# connections (connector records)
COUNT = 0

# user_connector_settings
COUNT = 0

# system_settings
COUNT = 1; ui.integrations.marketData.twelveDataApiKey = NOT PRESENT

# users
COUNT = 2

# trading_accounts
COUNT = 0
```

### Provider Verification (Twelve Data — live REST + WebSocket)

```
TWELVE_DATA_KEY present: true | TWELVE_DATA_API_KEY present: false
```
*TwelveDataProvider.connect() → legacy singleton connect() → WS handshake*

```
TwelveData Real-time Portal: ONLINE
WS Subscription sent for: 1 symbols.
```

```
fetchHistory EUR/USD interval=1h outputsize=10
→ OK bars=10
First bar: time=1795341600000 close=1.09705 symbol=EURUSD
identityValidated=true
```

```
wsSubscribe EUR/USD
→ Tick received: price=1.09726 time=1795329720000
Cleanup: unsubscribe + cleanup executed
```

```
fetchHistory XAU/USD → SYMBOL_NOT_FOUND (HTTP 404 DATA_UNAVAILABLE)
fetchHistory BTCUSDT → SYMBOL_NOT_FOUND (HTTP 404 DATA_UNAVAILABLE)
fetchHistory SPX500 → SYMBOL_NOT_FOUND (HTTP 404 DATA_UNAVAILABLE)
```

### Provider Verification (Yahoo Finance — broken)

```
YAHOO_API_KEY present: false
```
*Provider constructs without key, `authorized: false`*

```
fetchHistory EURUSD=X interval=1h outputsize=10
→ ERROR PROVIDER_UNAVAILABLE
yahooFinance.chart() expects a single string symbol as its query, not an object

fetchHistory AAPL interval=1d outputsize=5
→ ERROR PROVIDER_UNAVAILABLE (same cause)
```

### Symbol Binding (BTC/USD vs BTCUSD)

```
bindSymbol(["BTC/USD"], "BTC/USD")
→ canonical=BTCUSD assetClass=crypto identitySymbol=BTC/USD

bindSymbol(["BTC/USD"], "BTCUSD")
→ canonical=BTCUSD assetClass=crypto identitySymbol=BTC/USD
sameCanonical=true
```

### Symbol Compatibility (CoreX resolver)

```
EUR/USD  → canonical=EURUSD  class=fx    wire=EUR/USD   base=EUR  quote=USD
BTC/USD  → canonical=BTCUSD  class=crypto wire=BTC/USD   base=BTC  quote=USD
XAU/USD  → canonical=XAUUSD  class=other wire=XAUUSD    base=null quote=null
SPX500   → canonical=SPX500  class=other wire=SPX500    base=null quote=null
BTCUSDT  → canonical=BTCUSDT class=other wire=BTCUSDT   base=null quote=null
```

### Test Suite

```
npm test
Test Suites: 77 passed, 77 total
Tests:       911 passed, 911 total
Time:        62.059 s
```

---

## Timestamps and Correlation IDs

- Provider verification correlation: `verify-1795329649417`
- Provider verification start: `2026-11-22T06:40:57.829Z`
- Twelve Data REST EUR/USD: `2026-11-22 09:40:49`, duration 1014 ms
- Twelve Data WebSocket EUR/USD: `2026-11-22 09:40:55`, duration 6607 ms
- Symbol compatibility tests: `2026-11-22 09:41:38`
- Full test suite: `2026-11-22 09:44`, duration 62.059 s

---

## Safe Response Metadata (No Secrets)

Twelve Data REST EUR/USD sample bar (sanitized):
- `time`: epoch ms (1795341600000)
- `open`: 1.0972, `high`: 1.09743, `low`: 1.09692, `close`: 1.09705
- `volume`: 0, `symbol`: EURUSD (canonical)
- Wire symbol sent: `EUR/USD`

Twelve Data WebSocket tick (sanitized):
- `price`: 1.09726, `time`: 1795329720000 (epoch ms)
- Symbol: EUR/USD → normalized to EURUSD

Twelve Data error responses (sanitized — provider error codes only, no key material):
- `SYMBOL_NOT_FOUND` with `DATA_UNAVAILABLE` / HTTP 404 for XAUUSD, BTCUSDT, SPX500

Yahoo Finance error (sanitized):
- `PROVIDER_UNAVAILABLE`: `yahooFinance.chart() expects a single string symbol as its query, not an object`

---

## DB Query Intent and Sanitized Result Counts

| Query intent | Table | Result count | Filter applied |
|---|---|---|---|
| List all tables | information_schema.tables | 33 | table_schema='public' |
| Runtime rows by symbol/mode/status | strategy_runtimes | 2 rows | symbol='BTC/USD', mode='PAPER' |
| BTC symbol runtime count | strategy_runtimes | 2 | symbol ILIKE '%BTC%' |
| Job status distribution | corex_jobs | 3 status groups | succeeded/failed/cancelled |
| Connector records | connections | 0 rows | — |
| User connector settings | user_connector_settings | 0 rows | — |
| System settings rows | system_settings | 1 row | — |
| Users count | users | 2 | — |
| Trading accounts count | trading_accounts | 0 | — |

No raw credential JSON, connection strings, user IDs, or account IDs were printed. `user_id` and `strategy_name` fields in runtime rows were redacted.

---

## No Secret Values, Connection Strings, Personal Account IDs, or Raw Credential Records

This document contains zero secret values. All environment variable checks were presence-only. All DB queries returned counts and schema metadata only. No `credentials` column contents were decrypted or displayed.