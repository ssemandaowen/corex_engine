# FINAL LOCKED BROKER CONTRACT

1. BrokerContract: unified async interface — submit/modify/cancel/query_status. Standardized payload (Symbol, Volume, OrderType, StopLoss, TakeProfit) in, standardized OrderResult out, identical across every mode and driver.

2. Strategy logic is global and mode-agnostic: a strategy is written once. Its logic never branches on mode (backtest/paper/live) — the same strategy code runs unchanged against whichever BrokerContract-implementing driver is active. Only the driver underneath differs; the strategy never knows which one it's talking to.

3. Drivers implementing BrokerContract: BacktestDriver, CoreXPaperDriver (native, see #5), MetaApiDriver, RestDriver (MQL5 bridge). Each declares supports_trading: bool and supports_streaming_data: bool at init. Unsupported operation on a driver throws typed UnsupportedOperationError.

4. Global symbol normalization: canonical internal schema (uppercase, no separators, e.g. EURUSD) with pip_scale/digits metadata. Every driver AND every data source (Twelve Data, Yahoo Finance, local file, MetaAPI, REST) maps its native symbol format to canonical at its own boundary, before anything reaches the internal event bus. Applies uniformly across backtest, paper, and live — a strategy config's symbol never needs translation when switching modes.

5. Native CoreXPaperDriver: implements BrokerContract exactly like any other driver. Owns a local sandboxed ledger (virtual balance, margin, order queue) in CoreX's own memory/DB for that session — not a broker-side paper account. Order matching, slippage, and commission use the SAME shared fill-simulation module as backtest (#9) — one implementation, called from both, never two drifting copies.

6. Paper data source is assignable per session, and can be ANY registered data source — not fixed to "same as live." Two valid modes for a paper session's data:
   a. Live real-time feed from any configured provider (e.g. Twelve Data streaming) — genuinely live-timed data feeding a virtual broker.
   b. File replay: a local historical file assigned to the session, replayed tick-by-tick in real time (not dumped all at once like backtest) to simulate a live feed for forward-testing.
   Either way, paper is fully virtual and decoupled from any real broker connector — it never touches MetaAPI/REST.

7. Account state ownership is mode-specific, not a single blanket rule:
   - Live: the real broker owns the ledger (balance/margin/equity/positions). The session queries/listens to that external broker only. No CoreX-side ledger for live.
   - Paper & Backtest: CoreX owns the local virtual ledger via the shared matching module (#5/#9). No external query.
   - Never a single global AccountState shared across sessions — each session (symbol+mode+driver) has its own isolated instance, live or virtual.

8. Historical data provider: exactly one active provider in settings at a time (Twelve Data, Yahoo Finance, local file, etc.), user-supplied API key where applicable. Provider-side errors (rate limits, auth failures) caught and logged only, never surfaced to the user. Internal pagination: the fetcher layer automatically chunks/loops calls per-provider to fulfill CoreX's requested block size (CoreX's own 5000-candle internal processing ceiling — this is CoreX's own chunk size for fast/lean processing, not a provider limit) even if the provider's own per-call cap is lower (e.g. MetaAPI's 1000-candle ceiling) — stitched together, never silently truncated.

9. Backtest fill simulation (shared with paper per #5): market orders fill at next-candle-open with ATR-scaled or fixed slippage; limit/stop orders fill only if the historical bar's range crossed the trigger, worst-case price on gaps; spread/commission applied directly to the historical bid/ask series.

10. Live mode: strict push architecture via WebSocket. Drivers that only support polling are wrapped internally to emit pushed events — the broker layer itself never polls.

11. REST/MQL5 driver: execution and order-routing only (BUY/SELL/MODIFY down, execution/account confirmations up). Never carries market data.

12. Market Data ownership: all real-time ticks (live driver feeds, paper's assigned live/file-replay source) route through the central Market Data manager, which dispatches to the strategy engine. Drivers/brokers never independently serve pricing directly to strategy code.

13. Session model: scoped to (mode, symbol, driver). Same symbol cannot run two drivers simultaneously — reject at session creation. Different symbols may each run independent concurrent sessions on different drivers. RuntimeBrokerFactory enforces the same-symbol-one-driver rule at session creation, not just at order time.

---

## Checklist

- [ ] 1. Create /plans/decisions.md (architecture decisions log)
- [ ] 2. Redefine BrokerContract: async submit/modify/cancel/query_status + OrderResult + standard payload shape
- [ ] 3. Add UnsupportedOperationError typed error class
- [ ] 4. Add SymbolNormalizer module (canonical schema, pip_scale/digits, normalize at boundary)
- [ ] 5. Add supports_trading / supports_streaming_data capability flags to BrokerContract
- [ ] 6. Create SharedFillSim module (extract from BacktestBroker + PaperBroker logic, shared by both)
- [ ] 7. Rework BacktestBroker → BacktestDriver (implements new BrokerContract, uses SharedFillSim)
- [ ] 8. Rework PaperBroker → CoreXPaperDriver (native sandbox ledger, shares SharedFillSim, assignable data source)
- [ ] 9. Rework LiveBroker + MetaApiConnector → MetaApiDriver (push-only WebSocket, account state queried from broker)
- [ ] 10. Rework MT5MQL5Connector → RestDriver (MQL5 bridge, execution-only, no market data)
- [ ] 11. Add DataPaginationLayer (auto-chunk to 5000-candle blocks, stitch results, never truncate)
- [ ] 12. Update RuntimeBrokerFactory: same-symbol-one-driver enforcement at session creation
- [ ] 13. Write isolation tests for each new component
- [ ] 14. Run npm test in package â€” all tests pass
- [ ] 15. Backward-compatible re-exports at original file locations
- [ ] 16. Human verification: MetaApiDriver + RestDriver need real broker credentials (flag, don't self-certify)
