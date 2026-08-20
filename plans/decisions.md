# CoreX Architectural Decisions Log

This file is a running log of locked architectural decisions. New entries are appended (never overwrite past reasoning).

---

**2026-08-20** — Broker contract went through multiple design revisions during this session (symbol normalization scope, account-state ownership, native paper broker, data-source flexibility). This Issue (#1) now reflects the final locked version. Going forward, any time a locked architectural decision here is later changed, append a new dated entry to this file explaining what changed and why — never silently overwrite past reasoning, append to the log.

Key locked decisions for broker layer:
1. BrokerContract = unified async interface: submit/modify/cancel/query_status. Standardized payload (Symbol, Volume, OrderType, StopLoss, TakeProfit) in, standardized OrderResult out.
2. Strategy code is mode-agnostic — same strategy runs against any BrokerContract-implementing driver.
3. Drivers: BacktestDriver, CoreXPaperDriver (native sandbox ledger), MetaApiDriver, RestDriver (MQL5 bridge). Each declares supports_trading + supports_streaming_data. Unsupported operations throw typed UnsupportedOperationError.
4. Global symbol normalization: canonical schema (uppercase, no separators, e.g. EURUSD) with pip_scale/digits metadata. Every driver AND every data source normalizes at its boundary.
5. CoreXPaperDriver owns local virtual ledger; shares fill-sim module with BacktestDriver (one implementation).
6. Paper data source assignable per session: live real-time feed OR file replay. Never touches MetaAPI/REST.
7. Account state ownership is mode-specific: Live queries external broker; Paper/Backtest use CoreX local ledger. Each session has its own isolated instance.
8. Historical data provider: one active provider at a time in settings. Internal pagination auto-chunks to fulfill 5000-candle blocks. Errors caught/logged, never surfaced.
9. Backtest fill simulation (shared with paper): market orders fill at next-candle-open; limit/stop fill if bar range crossed trigger; spread/commission applied to bid/ask series.
10. Live mode: strict push via WebSocket. Polling wrapped internally to emit pushed events.
11. REST/MQL5 driver: execution/order-routing only. Never carries market data.
12. Market Data ownership: all ticks route through central Market Data manager. Drivers never serve pricing directly to strategy code.
13. Session scoped to (mode, symbol, driver). Same symbol cannot run two drivers simultaneously — enforced at session creation by RuntimeBrokerFactory.

---

**2026-08-20** — MetaApiDriver async/sync fix: connector methods `getPositionSnapshot` and `getEquity` are async (REST/WebSocket), but were called synchronously in MetaApiDriver, causing them to always return null/0 (Promises, not resolved values). Fixed by adding `_cachedEquity`/`_cachedPositions`/`_cachedAccount` fields; `initialize()` calls new `refreshState()` to fetch initial broker state asynchronously; synchronous getters (`getEquity`, `getPosition`, `getPositionSnapshot`, `getAccount`) return cached values. Push events (`onFill`, `onBar`, `onTick`) update the cache. Live mode `setCash`/`setInitialCash`/`resetAccount` return `false` (broker owns ledger — spec #7). MetaApiConnector remains a skeleton stub — needs real credentials for end-to-end verification (spec #16).
