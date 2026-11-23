# CoreX Backtest, Symbol & Runtime Binding — Target Design

> **Status:** P0 (items 1–5 below) implemented locally as of 2026-11-22 and covered by focused tests; P1–P3 remain proposals. Nothing has been committed or pushed.
> **Decision authority:** Owen Ssemanda
> **Date:** 2026-11-21
> **Related architecture:** `MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`
> **Basis:** Current-main Repomix analysis and the observed offline/online backtest behavior. Code-level claims must be checked against the current working tree when each implementation task begins.

## 1. Purpose

Unify the design for symbols, strategy runtime binding, parameters, backtest requests, historical data resolution and result provenance.

The current failures are not independent:
- Provider formatting is mixed with CoreX's canonical symbol normalization.
- Live and backtest do not visibly share one symbol-binding operation.
- Backtest configuration is assembled from loosely related request fields.
- Strategy parameters have separate resolution paths and incomplete validation.
- Historical data sources have different loading paths.
- Run identity does not fully describe the configuration and data actually executed.

The target is one resolution pipeline shared by live and backtest wherever their semantics are the same. Mode-specific execution remains separate.

## 2. Architectural decisions

1. **One owner per concern.** Normalization, instrument resolution, provider formatting, runtime binding, parameter resolution, data loading and execution identity each have a defined owner.
2. **Canonical symbols stay internal.** Strategies and engine features never format symbols for a specific provider.
3. **Provider formatting occurs at the adapter boundary.** REST, WebSocket and other provider channels use the provider's documented symbol representation.
4. **Bind runtime inputs once.** Live and backtest resolve the actual symbol and timeframe before creating/starting the strategy runtime.
5. **No silent substitution.** A requested unsupported symbol or timeframe produces a typed error; the engine must not quietly trade the strategy's first declared symbol.
6. **Resolve, validate, freeze, execute.** A worker receives a persisted, resolved request rather than reinterpreting raw UI fields.
7. **One parameter resolver.** Live and backtest apply the same defaults, saved values, overrides and schema validation.
8. **One historical data-loading boundary.** Provider, uploaded dataset and immutable snapshot inputs share a DataPortal contract; streaming session lifecycle remains owned by the market-data subsystem.
9. **Fail loudly.** Missing credentials, unknown instruments, unsupported symbols, missing datasets and invalid parameters must not become empty arrays or misleading downstream errors.
10. **Preserve the event-driven executor as authority.** Faster/vectorized execution is deferred until measured need and parity evidence exist.

## 3. Symbol and instrument model

### 3.1 Three distinct layers

| Layer | Responsibility | Owner |
|---|---|---|
| Normalize | Interpret user/API aliases and produce the CoreX canonical identity | `SymbolNormalizer` |
| Resolve | Resolve canonical identity to instrument metadata and supported aliases | `corex-market-data/src/symbols/instruments` |
| Format | Convert an instrument into the exact symbol expected by a provider/channel | Provider adapter formatter |

Conceptual flow:

```text
UI/API input
  "EUR/USD", "eurusd", "EUR_USD"
       |
       v
SymbolNormalizer
  canonical identity: "EURUSD"
       |
       v
resolveInstrument()
  { canonical, base, quote, assetClass, precision, ... }
       |
       v
provider adapter
  Twelve Data REST/WS: "EUR/USD"
  OANDA: provider-specific representation
  other providers: their documented representation
```

### 3.2 Instrument metadata

Initial module location:

```text
packages/corex-market-data/src/
  symbols/
    instruments.js
    instruments.data.json       # introduced when explicit overrides are needed
  providers/
    twelvedata/
      symbolFormat.js
```

An instrument record may contain:
- `canonical`
- `assetClass`
- `base` and `quote`, where applicable
- `pipScale`, `tickSize`, `pricePrecision` and other verified trading metadata
- provider aliases / channel-specific aliases where required

Resolution is explicit-data-first, then conservative classification rules. Unknown or ambiguous symbols must not be guessed into FX, crypto or equity categories.

**Important canonical-identity constraint:** the existing separator-stripping normalizer is lossy. For example, `BRK.B` can collapse to `BRKB`, which cannot safely be reconstructed by splitting a six-character string. The initial implementation must preserve existing canonical behavior for established instruments while adding explicit alias/override handling for known ambiguous instruments. Do not claim arbitrary reversibility. A future canonical-identity migration, if needed, requires its own compatibility plan.

Do not infer every six-character symbol is an FX or crypto pair. Use known currency/asset codes plus explicit catalog entries. Metals, indices, futures and broker-specific instruments require explicit metadata when their identity or provider spelling is ambiguous.

### 3.3 Provider formatting contract

Each provider adapter owns pure formatting functions, for example:

```js
toProviderSymbol(instrument, { channel: "rest" | "ws" }) -> string
fromProviderSymbol(raw) -> canonical identity
```

The market-data provider contract exposes the outbound conversion capability so callers cannot bypass it. The Twelve Data adapter must apply it consistently to:
- historical REST requests;
- WebSocket subscribe;
- WebSocket unsubscribe;
- provider-specific lookup/search operations, if supported.

The formatter is pure and table-tested. Provider-specific differences remain in the adapter, not in strategy code, controllers or the backtest manager.

### 3.4 Typed symbol failures

Use explicit errors such as:
- `SYMBOL_UNSUPPORTED`: the provider/adapter cannot represent the resolved instrument;
- `SYMBOL_NOT_FOUND`: provider does not recognize the requested provider symbol;
- `INSTRUMENT_UNKNOWN`: CoreX cannot resolve the canonical identity;
- `PROVIDER_KEY_MISSING`: required credentials are unavailable.

Errors carry a stable code and a `retryable` classification. A missing key or unsupported symbol is deterministic and must not be retried as a transient network failure.

## 4. Shared strategy symbol and timeframe binding

### 4.1 Ownership

- Strategy metadata declares its supported universe and default timeframe; it does not choose the symbol for an individual run.
- Runtime configuration selects the actual symbol/timeframe for that run.
- A shared binding operation canonicalizes, validates and resolves the selected values.
- The runtime environment exposes the bound symbol and instrument metadata to the strategy.
- Provider formatting happens later, inside the selected provider adapter.

### 4.2 bindSymbol contract

A shared `bindSymbol(meta, requested)` operation is used by both live start and backtest preparation.

It must:
1. Canonicalize the requested symbol and declared universe using the same normalizer.
2. Resolve the canonical symbol to an instrument.
3. Reject a symbol outside a non-empty declared universe with `SYMBOL_NOT_SUPPORTED_BY_STRATEGY`.
4. Require strategies to declare at least one symbol: `Strategy`, `BaseStrategy` and the compiler all reject an empty list. `bindSymbol` treats an empty list defensively, for missing/legacy metadata only, as unrestricted subject to successful instrument resolution. Empty-universe is not an authorable "trade anything" mode.
5. Return the canonical symbol and resolved instrument metadata.
6. Ensure the strategy instance, data manager/store and runtime environment are all scoped to the same bound symbol.

There is no silent fallback to the first declared symbol. Any deliberate cross-universe test override must be explicit, authorized at the API boundary, recorded in run provenance and unavailable as an accidental default.

### 4.3 Runtime parity

Live and backtest must use the same binding result and rescope the strategy instance consistently:
- `instance.symbols` contains the bound symbol for the run;
- the data manager/store is rebuilt or scoped to that symbol;
- `this.env.symbol` and `this.env.instrument` expose the bound identity/metadata;
- bar/tick events and strategy helper lookups use that same symbol.

Strategy code should use runtime environment values rather than hard-coded instrument names. Symbol-specific facts such as pip scale belong to instrument metadata, not duplicated strategy constants.

Apply the same ownership rule to timeframe: strategy metadata supplies a default/declared capability, while the run binds the actual timeframe. A mismatch must be explicitly validated rather than silently choosing one.

## 5. Shared parameter resolution

Introduce one `resolveParams(schema, saved, overrides)` operation used by live start and backtest.

Precedence:

```text
schema defaults < saved strategy parameters < request overrides
```

The resolver:
- validates types, required values, ranges and enums against the strategy schema;
- rejects unknown keys unless the schema explicitly allows them;
- returns the complete resolved parameter object;
- records per-key provenance (default, saved value or request override);
- returns typed validation errors.

Backtest must not replace a complete parameter object with a partial override. The resolved parameter set and provenance are included in the resolved backtest request.

Schema extraction must distinguish:
- `OK`: schema extracted, including a legitimately empty schema;
- `NO_PARAMS`: strategy explicitly defines no parameters;
- `COMPILE_ERROR`: schema extraction/compilation failed.

An extraction failure must not be swallowed and presented as an empty parameter set. The frontend needs an explicit schema status contract.

## 6. BacktestSpec v1

### 6.1 Purpose

Replace the loosely typed collection of backtest request fields with one versioned document. The existing flat-field API remains temporarily supported through a legacy adapter that maps old requests into the new specification.

The controller resolves and validates the request, persists the immutable ResolvedSpec, then enqueues a job containing the spec identifier. The worker loads that resolved specification and executes it without reinterpreting UI defaults.

### 6.2 Initial shape

```json
{
  "specVersion": 1,
  "label": "optional display-only label",
  "strategy": {
    "id": "user-scoped strategy identity",
    "codeHash": "sha256 of exact resolved source",
    "params": {}
  },
  "instrument": {
    "symbol": "EURUSD",
    "assetClass": "fx",
    "pipScale": 4
  },
  "data": {
    "source": { "kind": "PROVIDER", "provider": "twelvedata" },
    "interval": "15m",
    "window": { "mode": "POINTS", "points": 1000 }
  },
  "execution": {
    "initialCapital": 10000,
    "commissionPct": 0,
    "slippageBps": 0,
    "spread": 0
  },
  "risk": {
    "stopLossPct": 0,
    "takeProfitPct": 0,
    "trailingStopLossPct": 0
  },
  "engine": { "kind": "EVENT" },
  "output": { "includeTrades": true, "reportPreviewTrades": 20 }
}
```

This is a design shape, not a finalized database schema. Field units, bounds, account currency, contract specifications, session calendars, financing and margin assumptions must be defined against the actual simulator capabilities before the schema is frozen. Do not add fields that the current engine cannot truthfully honor.

All defaults are resolved and written into the stored ResolvedSpec. Unknown keys and invalid cross-field combinations are rejected. The complete resolved parameter set is stored, not partial overrides.

### 6.3 Data source and window rules

Initial source kinds:
- `PROVIDER`: provider, interval and window required; symbol is canonical internally and formatted only by the provider adapter.
- `DATASET`: immutable dataset identity required; symbol, interval and coverage are derived from dataset metadata and conflicting overrides are rejected.
- `SNAPSHOT`: immutable snapshot identity required; data provenance and coverage are recovered from the snapshot.

Initial window modes:
- `POINTS`: bounded bar count.
- `DATES`: UTC start/end, start before end, and coverage/cap validation.

The existing UI request remains compatible through the legacy adapter until the frontend migrates.

## 7. DataPortal boundary

Target contract:

```text
DataPortal.load(dataRequest)
  -> { bars, dataHash, coverage, provenance }
```

The DataPortal provides a common historical-data loading contract for provider history, uploaded datasets and stored snapshots. It does not replace the market-data subsystem's live streaming/session manager.

Every successful load returns:
- normalized bars in deterministic order;
- actual first/last timestamps and coverage;
- source/provider/dataset provenance;
- a hash of canonical bar content.

Online data should be snapshotted per run when exact replay is required. Retention and storage growth need an explicit policy. Data source failures must remain typed and observable.

## 8. Run identity and provenance

Separate request identity from exact result identity.

- `codeHash`: hash of exact strategy source used.
- `specHash`: hash of the canonical resolved specification, excluding display-only label.
- `dataHash`: hash of normalized bar content in deterministic order.
- `resultKey`: hash of `specHash`, `dataHash`, `codeHash` and engine/simulator version.

Use a defined canonical JSON serialization such as RFC 8785 JCS before hashing. Do not use ordinary key-order-dependent `JSON.stringify` as the identity format.

**Do not enable global deduplication or use result hashes as the only report identity yet.** First prove deterministic replay, define user/tenant ownership and retention, decide whether users expect repeated identical runs to remain separate report records, and test hash-prefix collision handling. Keep report identity and content identity conceptually separate.

A completed report should retain the ResolvedSpec, hashes, engine version, actual data window, parameter provenance and non-fatal warnings. An online run without an immutable data snapshot cannot claim exact reproducibility.

## 9. Executor strategy

The existing event-driven executor remains authoritative for every reported result.

A stable executor interface may be introduced when it reduces real coupling, but do not build a vectorized executor, GPU path or sweep framework now. Reconsider only after profiling demonstrates that event-driven execution is a material bottleneck.

Any future screening executor must be limited to strategies it can faithfully represent, calibrated against the event-driven executor, and must re-run reported top candidates through the authoritative event-driven path.

## 10. Retry and error policy

Only errors marked retryable are retried:
- transient network failures and provider 5xx responses may be retryable;
- transient database connection failures may be retryable;
- unsupported symbols, unknown instruments, missing credentials, invalid parameters and missing datasets are deterministic and must not be retried.

The job queue must preserve the original typed error and retry classification. A deterministic failure should terminate without consuming another attempt.

## 11. Delivery sequence

This is the implementation order. Each item is a bounded task with focused tests; do not reopen the whole design for every task.

### P0 — close immediate correctness gaps

1. **Provider symbol boundary:** instrument-aware Twelve Data REST/WS formatting; typed missing-key and unsupported-symbol errors; table-driven tests.
2. **Shared symbol binding:** implement `bindSymbol` and use it in live and backtest; remove silent first-symbol fallback; rescope strategy/data manager consistently.
3. **Shared parameter resolution:** validate and resolve schema defaults, saved values and overrides identically for live and backtest.
4. **Schema status contract:** distinguish successful empty schema from extraction failure and persist extracted schema synchronously where required.
5. **Retry classification:** deterministic data/configuration failures are not retried.

Exit criteria: online EUR/USD requests use Twelve Data's expected symbol; forex REST and WS formatting agree; a strategy declared for EURUSD cannot silently run GBPUSD; BTC/USD and BTCUSD canonical aliases match; live/backtest parameter resolution produces the same complete values; deterministic failures are not retried.

### P1 — establish the request contract

1. Add BacktestSpec v1 and whole-spec validation.
2. Add the legacy flat-request adapter.
3. Persist immutable ResolvedSpec before queueing.
4. Make workers consume spec identity rather than loosely typed request fields.
5. Add canonical serialization and specHash, without global result deduplication.

### P2 — unify historical data and provenance

1. Introduce DataPortal behind existing provider/dataset readers.
2. Normalize and hash canonical bars.
3. Persist online data snapshots and provenance.
4. Add SNAPSHOT replay and prove identical input replay.

### P3 — result identity and performance, only when justified

1. Prove event-engine determinism.
2. Introduce resultKey and collision-safe artifact naming after report ownership/dedup semantics are approved.
3. Measure execution bottlenecks before considering sweeps or a vectorized screening tier.

## 12. Acceptance tests

1. Twelve Data receives `EUR/USD` for canonical `EURUSD` on REST, subscribe and unsubscribe.
2. Inbound provider symbols normalize back to the same canonical instrument.
3. Table-driven instrument cases cover FX, crypto, equity, metals and ambiguous symbols.
4. A strategy declaring EURUSD and a run requesting GBPUSD is rejected unless an explicit authorized override is supplied.
5. Declared `BTC/USD` and requested `BTCUSD` resolve to the same canonical identity.
6. A live and backtest run with the same strategy metadata, symbol and timeframe bind the same runtime instrument.
7. Strategy helpers and data stores read the bound symbol, not the constructor's stale first symbol.
8. A strategy must declare at least one symbol; construction and compilation reject an empty list. The binder's empty-list handling is a defensive fallback for legacy metadata only, and unknown/unresolvable instruments still fail.
9. Parameter defaults, saved values and overrides resolve identically in live and backtest.
10. Schema extraction distinguishes OK, NO_PARAMS and COMPILE_ERROR.
11. Legacy flat requests map to a valid BacktestSpec; invalid cross-field combinations are rejected before queueing.
12. Key-order changes do not change specHash after canonical serialization.
13. Deterministic errors are not retried; transient errors are.
14. Identical offline ResolvedSpecs produce identical bars, trades and results before result deduplication is enabled.

## 13. Explicit deferrals

- No vectorized/GPU executor or parameter-grid framework now.
- No global result deduplication until determinism and report semantics are proven.
- No broad canonical-symbol migration as part of the Twelve Data fix.
- No forced DataPortal rewrite of live streaming.
- No simultaneous rewrite of all strategy, market-data and backtest packages.
- No speculative metadata catalog for instruments/providers not yet supported.
- No changes to unrelated execution-authority or Socket_X decisions in the companion architecture proposal.

## 14. Related architecture

- `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`
- `plans/architecture/BACKTEST_PIPELINE_DISCOVERY_AND_HANDOFF.md`
- `plans/COREX_DEVELOPMENT_PLAN.md`
- `plans/decisions.md`
- `plans/KNOWN_ISSUES.md`

## 15. P0 implementation record (2026-11-22)

### Status

P0 items 1–5 are implemented in the working tree and covered by focused tests. The work is **not committed or pushed**, and unrelated working-tree changes were left untouched. A review round on 2026-11-22 corrected five points: USDT pass-through (no guessed provider formatting), MarketFeed/provider unsubscribe alignment, the explicit non-empty strategy universe invariant, awaited persistence on the in-memory schema-cache path, and rejection of fractional integer parameters.

### Decisions taken during implementation

1. **Instrument module location.** `resolveInstrument`/`toProviderSymbol` live in `packages/corex-broker-contract/src/utils/Instruments.js`, next to `SymbolNormalizer`, not in `corex-market-data/src/symbols/`. The binder (`engine/core/runtime/SymbolBinder.js`) and the strategy runtime both already depend on broker-contract; placing resolution there avoids a market-data → strategy dependency inversion. The Twelve Data formatter (`packages/corex-market-data/src/providers/twelvedata/symbolFormat.js`) delegates to it.
2. **No guessed instrument spellings.** The explicit override tables are empty. Metals/indices/USDT are not hardcoded; every such case currently resolves through the conservative rules (`XAUUSD` → `other`, `SPX500` → `other`, `BTCUSDT` → `other` because `USDT` is not a fiat quote). See follow-up 1.
3. **Identity vs canonical symbol.** `bindSymbol` returns both the canonical spelling (used for data, registry and `env.symbol`) and an `identitySymbol` (the declared spelling when the request matches, otherwise canonical). Runtime ids stay `<strategyId>::<identitySymbol>::<mode>`, so existing ids such as `<id>::BTC/USD::PAPER` are reproduced exactly while a request for `BTCUSD` resolves to the same instrument.
4. **Backtest parameter merge changed.** The previous worker expression `payload.params || record.runtime_params || {}` replaced the saved parameter set with any partial override. Both live and backtest now use `resolveParams(schema, saved, overrides)` with `defaults < saved < overrides`. A partial backtest override now keeps saved values it does not mention, so previously produced results for such requests can legitimately change. `instantiateFromSource` also carries the compiled `defineSchema()` result onto instances whose constructor built no schema, so `Strategy` subclasses that declare only `defineSchema()` resolve against the same schema in both modes.
5. **`allowOutsideUniverse`.** An explicit, default-false request field threads from `backtestController` → job payload → `backtestRun` → `bindSymbol`. It is the only way to run a strategy outside its declared universe; there is no silent fallback in live start.
6. **Schema status persistence.** `getSchemaState` reuses the existing metadata cache and awaits the schema/compiled-metadata update only for the on-demand endpoint. `bootStrategy`/`reloadStrategy`/`startStrategy` keep the existing fire-and-forget persistence so boot cost is unchanged. A throwing `defineSchema()` is recorded as `metadata.schemaError` and reported as `COMPILE_ERROR`, never as `NO_PARAMS`.
7. **Retry classification.** `engine/services/jobErrorPolicy.js` treats typed errors (`retryable` flag and codes) and known message prefixes as authoritative for non-retryable failures. Untyped errors retain the previous retry behavior; `maxAttempts` defaults and stale-lock requeue are unchanged.
8. **Parameter bounds spelling.** The strategy front end uses `min`/`max`; `resolveParams` accepts both `min`/`max` and `minimum`/`maximum` and normalizes them. No front-end change was required. Integer parameters reject fractional values as `PARAM_INVALID`; they are never silently truncated.
9. **Non-empty strategy universe.** Strategies must declare at least one symbol: `Strategy`, `BaseStrategy` and `StrategyCompiler` reject an empty list. `bindSymbol`'s empty-list branch is defensive only, for missing/legacy metadata, and is covered by tests labelled accordingly — it is not an authorable "any symbol" mode. The live and backtest empty-universe tests mutate metadata directly to exercise that fallback.
10. **USDT is not provider-formatted.** `USDT` is absent from both `CRYPTO_BASES` and `CRYPTO_QUOTES`, so `BTCUSDT` resolves as `other` and passes through as `BTCUSDT` on every Twelve Data path. Its real spelling (`BTC/USDT` vs `BTCUSD`) is unverified; see follow-up 1.
11. **Subscription lifecycle.** `MarketFeed.unsubscribe()` sends only symbols that lost their last subscriber, and `TwelveDataProvider.subscribe()` keeps the legacy singleton's tracked set in sync via `updateSymbols()` (the legacy `subscribe()` only queues and never updates that set). A lifecycle test subscribes two runtimes, removes one, and asserts only its symbol is unsubscribed upstream.
12. **Started schema endpoint durability.** `getSchemaState` awaits the schema/compiled-metadata write on both the fresh-compile and the existing in-memory-entry paths, so the endpoint never answers before the write settles.

### Follow-ups

1. Verify Twelve Data's exact spellings for metals (`XAU/USD`?), indices (`SPX` / `US500`?), and crypto quotes (`BTC/USDT` vs `BTCUSD`) against live responses before filling the override table or extending quote classification.
2. `BRK.B`-style canonicalization remains lossy (`BRKB`); a canonical-identity migration needs its own compatibility plan.
3. Timeframe binding/validation is designed in §4.3 but not implemented.
4. The front end does not yet consume `GET /api/strategies/:id/schema` or the new list `schemaStatus`.
5. Overall compile failures are not persisted to the database; the list route can only report `COMPILE_ERROR` while the metadata entry is in memory (or when a persisted `schemaError` exists). The on-demand schema endpoint always compiles, so it reports them reliably.
6. BacktestSpec v1/legacy adapter, DataPortal, canonical hashing/result identity, deduplication, vectorized executor, WS auth/reconnect, Twelve Data connect-before-subscribe lifecycle, and the RapidFireTest trade-count investigation remain deferred.

**Approval note:** This document records the proposed target and delivery order. Implementation should follow the bounded P0 sequence, with each change tested and recorded. It does not authorize the deferred P1–P3 work as one large implementation.
