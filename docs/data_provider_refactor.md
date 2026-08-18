# Data Provider Refactor — "Hollow Engine with Connection Ports"

**Goal:** Decouple the engine core from a hard-wired TwelveData market-data
dependency so any data source (TwelveData, MetaApi, Oanda, REST, etc.) can be
plugged in per-runtime. Mirror the already-proven broker `Contract + Factory`
seam. Behavior is preserved end-to-end; TwelveData remains the default.

---

## 1. Current state (ground truth)

Market data is statically required in exactly two places:

| File | Line | Coupling |
|------|------|----------|
| `engine/core/engine.js` | 5 | `require("@broker/twelvedata")` — used for warmup `fetchHistory` and `stop()` cleanup |
| `engine/core/runtime/MarketFeed.js` | 26 | `require("@broker/twelvedata")` — live tick subscription (`twelvedata.updateSymbols`) |

Execution side is **already pluggable**:
- `broker/connectors/` (MetaApi, Rest, MT5MQL5)
- `broker/base/BrokerContract.js` + `BaseBroker.js` (fail-fast contract enforcement)
- `RuntimeBrokerFactory` (mode → broker instance)

`startStrategy` already threads `connectorType` (`engine/core/strategyLoader.js:451`)
but only for the **broker**, never for market data.

A second ingestion path already exists: `MarketFeed.feedBar()` accepts bars from
bridged sources (MetaAPI) and routes them to runtimes. So the engine can consume
non-TwelveData bars today; only the *default live tick source* and *warmup
history source* are TwelveData-locked.

---

## 2. Target architecture

```
                 ┌─────────────────────────────────────────────┐
                 │                CoreX Engine                  │
                 │  MarketFeed (tick fan-out, symbol→runtime)   │
                 │  warmupStrategy (uses provider.fetchHistory) │
                 └───────────────┬─────────────────────────────┘
                                 │ selects by name / connectorType
                                 ▼
                  MarketDataProviderFactory.get(name)
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
 TwelvedataProvider      MetaApiDataProvider      OandaDataProvider   (future)
 (DEFAULT)               (uses existing bridge)   (uses RestConnector)
```

`MarketDataProvider` contract (modeled on `BrokerContract`):

```js
connect()            // open connection / auth
subscribe(symbols)   // ensure upstream symbols are subscribed
unsubscribe(symbols) // drop symbols no longer needed
fetchHistory({ symbol, interval, outputsize }) -> bars
getStatus()          // { connected, authorized, lastHeartbeat, ... }
cleanup()            // release connection (replaces broker.cleanup in engine.stop)
// Emits EVENTS.MARKET.TICK on the bus (MarketFeed already listens)
```

`MarketFeed` keeps its own `symbol → Set<runtimeId>` map and only listens on the
bus — the provider just emits ticks. No change to fan-out logic.

---

## 3. Phased plan (behavior-preserving first)

### Phase 1 — Define the contract
- Add `engine/core/data/DataProviderContract.js` (interface + `_validateContractImplementation`
  fail-fast, mirroring `BrokerContract`).

### Phase 2 — Wrap TwelveData (no behavior change)
- Add `engine/core/data/providers/TwelveDataProvider.js` that re-hosts the
  current `@broker/twelvedata` logic (fetchHistory, updateSymbols, cleanup,
  tick emission on `EVENTS.MARKET.TICK`).
- Keep `twelvedata.js` as the transport; the provider is the adapter.

### Phase 3 — Factory + settings
- Add `engine/core/data/MarketDataProviderFactory.js` (clone `RuntimeBrokerFactory`):
  register providers by key, `get(name)` returns correctly-configured instance.
- Add `marketData.provider` to engine settings (`EngineSettings` / `getSettings`
  / `updateSettings`), default `"twelvedata"`.

### Phase 4 — Rewire core (remove static requires)
- `engine/core/engine.js`: replace `require("@broker/twelvedata")` with the
  factory-selected provider; use `provider.fetchHistory` in `warmupStrategy`
  and `provider.cleanup()` in `stop()`.
- `engine/core/runtime/MarketFeed.js`: replace `require("@broker/twelvedata")`
  with the factory-selected provider; `subscribe`/`unsubscribe` delegate to it;
  keep `feedBar` for bridged (MetaApi) bar delivery.

### Phase 5 — Per-runtime selection
- Thread `connectorType` (already on the runtime profile) into provider
  selection so LIVE-via-MetaApi can pull its own data while PAPER uses TwelveData.

### Phase 6 — New connectors (future)
- `MetaApiDataProvider` (subscribe via existing MT5/MetaApi bridge).
- `OandaDataProvider` (reuse `broker/connectors/RestConnector.js`).

---

## 4. Risks / caveats

- **Lifecycle ownership:** today `engine.stop()` calls `broker.cleanup()`.
  After the refactor the selected provider owns its connection; ensure
  `stop()` calls `provider.cleanup()` and never the raw `twelvedata` module.
- **Tick fan-out:** stays in `MarketFeed`; provider only emits on the bus.
  Confirm no other module imports `twelvedata` directly (grep before Phase 4).
- **Scoping:** provider selection is global; per-runtime override via
  `connectorType` (Phase 5). No cross-user data bleed expected.
- **Backtest:** `BacktestFeed` / backtest broker use their own feed — out of
  scope, must not regress.

## 5. Verification

- `node -e` smoke test: default provider is TwelveData; warmup + tick flow
  unchanged vs. pre-refactor (same bars, same subscriptions).
- Grep: zero `require("@broker/twelvedata")` remain in `engine/core` after Phase 4.
- Existing tests / `scripts/test-auth.js` still pass.
- Manually: PAPER strategy still warms up + trades; toggle `marketData.provider`
  to a stub provider and confirm engine selects it.

---

## Status

- [x] Investigation & root-cause (coupling points identified)
- [ ] Phase 1: DataProviderContract
- [ ] Phase 2: TwelveDataProvider
- [ ] Phase 3: Factory + settings
- [ ] Phase 4: Rewire engine + MarketFeed
- [ ] Phase 5: Per-runtime connectorType selection
- [ ] Phase 6: MetaApi / Oanda providers (future)
