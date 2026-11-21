# CoreX Runtime Data Selection, Configuration & Recovery — Discovery Report

> **Status:** DISCOVERY REPORT — submitted for Claude's independent architecture review; not an approved implementation specification.
> **Owner / final decision authority:** Owen Ssemanda.
> **Baseline:** GitHub `main`, commit `37d5f3b1c1ec58a9d5693e1ec2df4e5137f82a03` (21 November 2026 review).
> **Scope:** Runtime-specific market-data selection, provider configuration, PAPER file replay, data routing, lifecycle and recovery.
> **No application source code, database schema, credentials or runtime behavior was changed for this report.**

## 1. Executive conclusion

Owen's clarification resolves the main ambiguity:

**One runtime selects one data source. The application can run many runtimes concurrently, and each runtime may select a different configured data source.**

The old phrase "one active historical-data provider" must not be interpreted as one provider for the entire CoreX process. The intended constraint is one selected source per runtime, with independent selections across runtimes.

Example:

| Runtime | Data source | Execution |
|---|---|---|
| Rapid / EURUSD / PAPER | Twelve Data connection A | CoreX Paper Driver |
| Strategy B / BTCUSD / PAPER | Another configured API connection | CoreX Paper Driver |
| Strategy C / EURUSD / PAPER | Uploaded dataset replay | CoreX Paper Driver |
| Strategy D / GBPUSD / LIVE | Selected market-data connection | Separately selected LIVE execution account |

A data provider and an execution broker are independent selections. A PAPER runtime may use an API stream or a file replay without the paper execution driver owning that source.

This is not achieved by simply registering more provider classes. The missing architecture is the configuration-to-runtime handshake, provider-session ownership and source-aware routing.

**Recommendation:** retain the existing `corex-market-data`, `corex-accounts`, `configService`, `RuntimeLifecycle` and `RuntimeRegistry` ownership boundaries. Extend their public responsibilities. Do not create a parallel configuration framework, a second runtime registry, or a new provider system beside the existing package.

## 2. User-confirmed product rules

These rules are the starting point for review:

1. A runtime has exactly one selected data source at a time.
2. Different runtimes may select different providers or datasets concurrently.
3. The source is selected at runtime launch, or inherited from an explicitly configured user/account default.
4. A runtime's historical warmup and subsequent stream/replay must use the same selected source unless a deliberate, validated transition is requested.
5. Data selection and execution selection are independent. PAPER execution does not imply Twelve Data; LIVE execution does not imply that the execution broker supplies strategy prices.
6. File replay is a valid PAPER data source: the file is replayed at a configured pace and the resulting market observations flow through the normal strategy and paper-execution path.
7. Provider limits matter. Connections and API quotas must be managed at the credential/connection level, while each runtime keeps its own logical subscription and event destination.
8. A provider must never be switched silently because another provider is available.
9. Recovery must restore the same runtime configuration, not silently fall back to a process-wide default.
10. Decisions remain append-only. A new decision may supersede an older one, but historical reasoning must not be rewritten.

## 3. Existing decisions that need reconciliation

### 3.1 Historical provider decision

`plans/decisions.md` (20 August 2026) says: "Historical data provider: one active provider at a time in settings." The same record describes a single active provider in `DataProviderFactory`.

That wording is too broad for Owen's clarified intent. The proposed superseding meaning is:

- one active source binding per runtime;
- many active runtime bindings across the application;
- no global mutable active-provider selection;
- connection sharing is permitted as an implementation optimization, not as shared runtime ownership.

Do not edit or delete the old decision. After Claude's review and Owen's final approval, append a dated superseding decision explaining this clarification.

### 3.2 Separate runtime exclusivity decision

The current `plans/ROADMAP.md` locks runtime identity as:

`userId::strategyName::symbol::mode` (L8).

The current `RuntimeRegistry.reserve()` also enforces one active runtime per account/symbol/mode, even if the strategy names differ. This is separate from the old provider-selection rule.

The provider decision must not silently change runtime identity or exclusivity. Claude should explicitly assess whether this restriction is intended to remain. If Owen wants two strategies using the same symbol and mode with different sources, the current registry exclusivity would prevent that.

### 3.3 Configuration framework restriction

The active roadmap's L4 says: **No new configuration framework. Reuse the existing config/settings services.**

The design below therefore describes runtime-specific configuration resolution as an extension to the existing settings/configuration boundary. It is not a proposal to build a competing configuration platform.

### 3.4 Dataset dependency

The active roadmap lists **STAGE-4 — Dataset resource model** as UNCONFIRMED. File replay must use the approved dataset resource model when that work is confirmed. This report does not authorize a second upload, dataset or file-storage model.

## 4. Verified current implementation

The source was checked against GitHub `main`, not only the older local Stage-1 worktree. The local `fix/upload-multipart-genuine-regression` branch is 22 commits behind `main`; it was not treated as the current source of truth.

### 4.1 Provider factory is process-global

Files:
- `packages/corex-market-data/index.js`
- `packages/corex-market-data/src/DataProviderFactory.js`

The package index constructs and registers a default `TwelveDataProvider`, then calls `DataProviderFactory.setActive("twelvedata")` during import.

The factory has one `_active` instance and one `_activeName`. Historical fetch, subscribe, unsubscribe, status and capabilities all use that single active provider. `RuntimeLifecycle._warmup()` calls `DataProviderFactory.fetchHistorical()` without a runtime/provider selection.

This is the central mismatch with the clarified product rule.

### 4.2 MarketFeed routes by symbol, not source/session

File: `packages/corex-market-data/src/MarketFeed.js`

The feed:
- listens to the global `EVENTS.MARKET.TICK` event;
- tracks subscriptions as symbol → runtime IDs;
- calls `registry.forSymbol(symbol)` for incoming ticks;
- feeds every matching PAPER/LIVE runtime.

The event contract does not require a provider connection ID or data-session ID. A tick from one source therefore cannot be distinguished from a tick from another source for the same symbol.

**Confirmed isolation defect:** a file replay and a live provider using the same symbol can feed the wrong runtime. This is not fixed by adding more provider instances. Routing must identify the source session as well as the instrument.

### 4.3 Twelve Data is not independently instantiated today

Files:
- `packages/corex-market-data/src/providers/TwelveDataProvider.js`
- `packages/corex-market-data/src/legacy/twelvedata.js`
- `engine/services/integrationRuntime.js`

`TwelveDataProvider` defaults to the legacy Twelve Data singleton. Its optional broker injection helps tests, but ordinary instances share the same singleton state. The integration runtime also applies credentials/configuration through process environment variables and mutates the legacy singleton.

This cannot safely represent multiple independently configured Twelve Data connections. A second adapter object does not create a second isolated upstream session if both objects still share the singleton.

### 4.4 Existing configuration services are not yet runtime resolvers

Files:
- `engine/services/configService.js`
- `engine/services/integrationRuntime.js`
- `packages/corex-accounts/src/connectionsService.js`
- `engine/services/connectorSettingsService.js`

The existing config service loads system settings and global LIVE/PAPER broker settings into a cached configuration object. The integration runtime copies selected values into process-wide environment variables and applies them to global services.

The account connection service already has encrypted credential handling and connector schemas. However:
- its current schemas are limited to Twelve Data and MetaApi;
- `getConnection()` returns `config: {}` and decrypted secrets;
- `saveConnection()` upserts by `(account_id, connector_type)`;
- the connector settings shim does not yet provide a complete provider-profile/configuration flow.

The existing services are a useful base, but they do not currently resolve an immutable configuration for a particular runtime.

### 4.5 Frontend and API do not pass a data-source selection

Files:
- `front_end/src/views/RunView.tsx`
- `front_end/src/components/run/RuntimesSubTab.tsx`
- `front_end/src/api/run.ts`
- `engine/routes/executionController.js`
- `engine/strategyLoader.js`

The launch UI submits mode, symbol, parameters and, in one view, timeframe. It does not submit a data connection or dataset identity. The second runtime launcher does not even submit timeframe.

The API client type also omits timeframe. The backend route reads timeframe, but the current strategy-loader startup profile does not apply `options.timeframe`; warmup uses the strategy instance's timeframe. This is a related runtime-configuration contract mismatch that should be addressed when defining the launch specification.

### 4.6 PAPER execution owns file-provider startup

Files:
- `packages/corex-broker-contract/src/drivers/CoreXPaperDriver.js`
- `packages/corex-broker-contract/src/RuntimeBrokerFactory.js`

`CoreXPaperDriver` stores `dataSource` and calls `_initDataSource()` during `initialize()`. It lazy-loads `FileDataProvider`, connects it and starts replay.

That gives the execution driver responsibility for market-data provider lifecycle. It also creates a circular-dependency workaround between broker-contract and market-data.

There is a configuration-shape defect as well: the factory passes `dataSource` inside `brokerConfig`, while the paper driver constructor reads `config.dataSource` at the top level. The intended configuration does not reliably reach the property the driver reads.

The paper driver should own the virtual ledger and fill simulation. It may consume tick/bar observations through its public methods, but it should not create, select, reconnect or own the market-data provider.

### 4.7 File replay is not source- or runtime-scoped

File: `packages/corex-market-data/src/providers/FileDataProvider.js`

Current replay:
- emits each OHLCV bar as a global `EVENTS.MARKET.TICK`;
- has no runtime/data-session identity on the event;
- has no effective per-runtime symbol subscription filtering;
- replays the file as a whole.

This can contaminate other runtimes using the same symbol.

The normal MarketFeed path calls the broker's `onTick()`. It does not dispatch a bar event to `broker.onBar()`. The paper driver's `onBar()` contains next-bar pending-order and bar-dependent trailing-stop behavior. Replayed OHLCV bars therefore do not currently exercise the complete paper bar-processing path.

The data event model must distinguish ticks from bars, and the replay session must target its owning runtime.

### 4.8 Recovery does not persist the data-source binding

Files:
- `engine/strategyLoader.js`
- `engine/core/runtime/RuntimeLifecycle.js`
- `engine/core/runtime/RuntimeRegistry.js`
- `db/migrations/015_corex_runtime_isolation.sql`

The existing `strategy_runtimes` row persists runtime ID, user, strategy, symbol, mode, active state and strategy parameters. It does not persist a provider connection ID, dataset ID, replay settings or resolved runtime configuration.

On server startup, `_restoreDesiredRuntimeStates()` selects those rows and calls `startStrategy()` with user, symbol, mode and params only. It cannot restore the source selected at the original launch. With the current global default, a runtime could restart on Twelve Data even if the user originally selected a different source or a file.

Also, the strategy state flush/restore path uses `strategies.runtime_state_data` keyed by strategy name, rather than a runtime-specific state record. Multiple instances of one strategy can overwrite or restore the wrong state. This is an adjacent recovery/persistence issue that matters if independent runtime configurations are to be reliable.

The registry itself is in-memory. Existing fencing/rollback behavior is useful and should be retained, but provider sessions must join the same owned lifecycle and cleanup guarantees.

### 4.9 Existing provider and dataset capabilities

Current market-data package exports include Twelve Data, Yahoo Finance and FileDataProvider. Their capabilities differ; the design must not assume every provider supports both history and streaming.

The existing `DataProviderContract` already exposes capabilities such as max bars, supported intervals and streaming. Extend this capability model deliberately rather than treating every provider as interchangeable.

## 5. Proposed ownership and object model

This is a conceptual model for review, not a database schema or a demand to create one class per noun.

### 5.1 Provider definition / registry

A trusted catalog of supported provider adapter types:
- stable provider type ID and contract version;
- public display metadata;
- supported capabilities: historical bars, live ticks, live bars, replay, supported intervals, symbol coverage and limits;
- validated non-secret configuration schema;
- secret field names/credential requirements;
- provider-specific symbol mapping and error translation.

The registry resolves known implementations. It should not execute arbitrary files discovered from a directory. Drop-in code remains trusted-developer-only unless a separate plugin security boundary is designed.

### 5.2 Provider connection

A configured provider account/credential set owned by a user/account:
- `connectionId`;
- provider type;
- owner/account identity;
- non-secret connection configuration;
- secret reference stored through the existing encrypted credential mechanism;
- connection status and verification metadata;
- connection-level quota/rate-limit settings.

A provider connection is not a runtime. It can be selected by several compatible runtime sessions.

### 5.3 Dataset resource

A file is selected by a server-managed `datasetId`, not an arbitrary filesystem path supplied by the browser.

Dataset metadata should eventually include immutable file identity/hash, format, symbols, interval/timeframe, timestamp coverage, validation status and access owner. Exact persistence and upload ownership must follow the approved Stage-4 dataset resource model.

### 5.4 Runtime data selection

Each runtime selects exactly one of:
- a configured provider connection; or
- a configured dataset/replay resource.

Conceptual launch request:

```js
{
  mode: "PAPER",
  strategyId: "strategy-registration-id",
  symbol: "EURUSD",
  timeframe: "1m",
  params: {},
  dataSource: {
    kind: "provider",
    connectionId: "user-provider-connection-id"
  },
  execution: {
    // PAPER selects CoreX Paper execution; no data-provider field here.
  }
}
```

For file replay:

```js
{
  mode: "PAPER",
  strategyId: "strategy-registration-id",
  symbol: "EURUSD",
  timeframe: "1m",
  params: {},
  dataSource: {
    kind: "dataset",
    datasetId: "server-managed-dataset-id",
    replay: {
      speed: 1.0,
      loop: false,
      startOffset: null
    }
  }
}
```

For LIVE, execution selection is separate and identifies an authorized execution connection/account. For BACKTEST, the data selection identifies a historical source/dataset and execution is always the deterministic simulator.

These are illustrative object shapes. Names and persistence are subject to contract review.

### 5.5 Resolved runtime specification

The existing settings/configuration boundary should resolve the launch request into an immutable, validated runtime specification before activation.

Conceptually:

```js
{
  schemaVersion: 1,
  runtimeId: "...",             // Preserve current identity rule unless separately approved.
  strategy: {
    id: "...",
    version: "...",
    params: {}
  },
  runtime: {
    mode: "PAPER",
    symbol: "EURUSD",
    timeframe: "1m"
  },
  data: {
    kind: "provider",
    providerType: "twelvedata",
    connectionId: "...",
    providerSymbol: "EUR/USD",
    capabilities: {},
    replay: null,
    failoverPolicy: "none"
  },
  execution: {
    mode: "PAPER",
    driverType: "PAPER",
    connectionId: null,
    accountId: "..."
  },
  riskPolicyId: "...",
  configVersion: "...",
  resolvedAt: "..."
}
```

The resolved snapshot contains references and non-secret configuration only. It must never contain raw API keys or tokens. Credentials are resolved server-side immediately before adapter initialization.

Configuration precedence should be explicit: platform defaults → configured connection/profile → user/account defaults → runtime launch overrides. The user must be able to select a different source at launch without changing the execution selection.

## 6. Provider sessions, connection sharing and routing

The core distinction is between a **physical provider connection** and a **logical runtime data session**.

### 6.1 Logical runtime data session

One session per runtime owns:
- selected provider connection or dataset;
- selected canonical instrument and provider-specific symbol mapping;
- requested interval and event type;
- historical warmup request;
- live subscription or replay cursor;
- connection/session status;
- last received timestamp/sequence;
- reconnect and cleanup lifecycle;
- runtime-scoped data quality and error state.

This is what `RuntimeLifecycle` owns and what `RuntimeRegistry` references.

### 6.2 Shared physical provider connection

When multiple runtimes use the same configured API connection, CoreX may share a physical WebSocket/HTTP client if the provider supports multiplexing.

The shared connection manager must:
- key the physical connection by configured connection identity, not just provider name;
- enforce provider quotas at the credential/connection level;
- multiplex compatible subscriptions;
- reference-count logical subscriptions;
- prevent one runtime's stop/reconnect from disconnecting another runtime;
- preserve per-runtime event destinations.

Separate credentials/connections must not share mutable API-key state merely because they use the same provider type.

### 6.3 Source-aware event contract

Provider observations must retain source and event identity. A candidate normalized envelope:

```js
{
  eventType: "bar",              // or "tick"
  dataSessionId: "...",
  providerConnectionId: "...",
  providerType: "twelvedata",
  canonicalSymbol: "EURUSD",
  providerSymbol: "EUR/USD",
  eventTime: 0,
  receivedAt: 0,
  sequence: null,
  quality: "normal",
  data: {
    open: 0, high: 0, low: 0, close: 0, volume: 0
  }
}
```

Tick payloads use explicit bid/ask/last semantics rather than pretending all prices mean the same thing.

MarketFeed routes by `dataSessionId` (and validates the expected symbol/instrument), not by symbol alone. A shared physical connection may fan out to several logical sessions, but a replay session must never broadcast into every runtime using the same symbol.

Prefer an explicit provider-to-session callback/event boundary. If the application event bus is used, the envelope must carry the session/connection identity and all routing must enforce it.

### 6.4 Capability negotiation

The selected source must be checked against the runtime's requirements before start:
- does it support history for warmup?
- does it support the selected interval?
- does it support streaming, bar events or replay?
- can it serve the selected instrument?
- are quota/subscription limits available?
- does it return compatible price/timestamp semantics?

A provider that only supports history must not be accepted for a runtime requiring live streaming unless an explicit replay/polling adapter capability is configured. Unsupported capability must fail validation, not become a silent no-op.

## 7. Runtime startup handshake

Proposed logical sequence:

1. **Frontend selection:** user selects strategy, mode, symbol, timeframe, parameters, data source and (where applicable) execution account.
2. **Authenticated request:** frontend sends only IDs and non-secret runtime options. No API keys, tokens or raw filesystem paths.
3. **Resolve configuration:** existing configuration/settings boundary validates ownership, loads the configured provider connection/dataset, resolves secrets server-side and builds the immutable runtime specification.
4. **Validate capabilities:** check provider history/stream/replay capabilities, symbol mapping, interval, dataset compatibility, account readiness, mode and policy restrictions.
5. **Reserve runtime identity:** use the existing `RuntimeRegistry` reservation/fencing flow. Do not create a second registry.
6. **Create collaborators:** create the selected execution driver and a separate runtime data session.
7. **Initialize source and execution:** connect/prepare the data session, initialize the execution driver, and fetch warmup history through the same selected source.
8. **Register and attach:** commit the runtime using the existing ownership token, attach the strategy to its broker/runtime context, and store the data-session reference in the runtime entry.
9. **Subscribe/start replay:** start the logical session and route its tick/bar events only to that runtime.
10. **Activate:** only after required initialization succeeds, commit ACTIVE and publish runtime state.
11. **Rollback:** any failure destroys both provider session and execution driver, releases shared connection references and releases the runtime reservation. Cleanup failures remain owned/retryable under the existing lifecycle rules.

The exact order of registration versus warmup must preserve the current reservation/fencing guarantees and prevent an event from reaching a partially initialized runtime. The implementation design must state this explicitly.

## 8. PAPER, LIVE and BACKTEST behavior

| Mode | Data source | Execution |
|---|---|---|
| PAPER live practice | Selected provider connection | CoreXPaperDriver |
| PAPER dataset practice | Selected dataset replay | CoreXPaperDriver |
| LIVE | Selected compatible live market-data connection | Separately selected, verified live execution adapter/account |
| BACKTEST | Historical provider or dataset | Deterministic simulation driver |

### PAPER

The paper driver owns its ledger, fills, positions and account simulation. It receives normalized observations. It must not create a FileDataProvider or decide which API supplies prices.

The feed must distinguish `onTick` from `onBar`. OHLCV replay should reach the bar-processing path so next-bar fills, trailing stops and other bar-dependent behavior are exercised correctly.

### LIVE

Market-data selection does not imply execution selection. If market-data and broker quotes differ, CoreX must preserve source provenance and define which quote is used for strategy signals versus execution validation.

The existing audit still identifies MetaApiConnector as a non-executing skeleton. This report does not authorize real LIVE execution or Socket_X mounting.

### BACKTEST

BACKTEST remains distinct from PAPER replay. It needs a deterministic clock, reproducible run specification, simulation execution and existing backtest worker/persistence ownership. A dataset may be reusable by both modes, but their clocks, lifecycle and fill guarantees are not interchangeable.

## 9. Recovery, reconnect and shutdown

These are separate failure domains and need separate handling.

### 9.1 Provider disconnect while the process is running

- Mark the physical connection and affected logical sessions as disconnected/degraded.
- Reconnect with bounded backoff and provider-specific quota handling.
- Re-establish each runtime's subscriptions independently.
- Fetch missing history from the same selected source where supported.
- Track last sequence/time to detect gaps and duplicates.
- Resume only when the session is healthy and the gap policy is satisfied.
- If recovery cannot be proven, mark the runtime degraded/paused or failed according to an explicit policy.
- Do not silently switch to a different provider.

A configured failover policy may be considered later, but it must validate instrument, timestamp, price-side, interval and data-quality compatibility and record every source transition.

### 9.2 Process shutdown/restart

Persist the runtime's desired configuration, not live connection objects:
- strategy registration/version and parameter snapshot;
- runtime identity, mode, symbol and timeframe;
- provider connection ID or dataset ID;
- replay speed/loop/offset and relevant replay cursor;
- execution connection/account reference;
- configuration version and relevant risk policy reference.

On startup:
1. load desired runtime records;
2. resolve the exact saved configuration;
3. verify the strategy and dataset still exist;
4. re-check credential availability and provider capabilities;
5. reconstruct provider and execution sessions;
6. warm up/reconcile before marking ACTIVE;
7. report a blocked/degraded runtime if the original source is unavailable.

Never fall back to the default provider when the selected connection is missing or invalid.

LIVE restoration needs a separate safety gate: re-authenticate, reconcile broker positions and outstanding commands, and apply an explicit operator-approved auto-resume policy. The current restore loop starts every persisted ACTIVE runtime without persisting or resolving its data-source selection; this needs redesign before source-specific recovery can be trusted.

### 9.3 Shutdown

Stopping one runtime must:
- stop its replay clock or unsubscribe its logical session;
- cancel its pending provider work;
- release its reference to any shared physical connection;
- close the physical connection only when no logical session still needs it;
- destroy its execution driver and strategy instance;
- persist STOPPED state and runtime-specific strategy state;
- remain retryable if cleanup fails.

Runtime state persistence must be runtime-scoped. The current strategy-name-keyed `strategies.runtime_state_data` field is not sufficient for independent instances of the same strategy.

## 10. Configuration ownership proposal

| Concern | Owner to extend | Responsibility |
|---|---|---|
| Supported provider definitions | `corex-market-data` | Adapter catalog, capability metadata and validation |
| Provider credentials/connections | Existing `corex-accounts` + secrets vault | Secure connection profiles and secret resolution |
| User defaults and system settings | Existing settings/config services | Defaults, account-level configuration and refresh |
| Runtime launch specification | Application runtime orchestration | Resolve IDs into one immutable runtime config |
| Provider session and physical connection lifecycle | `corex-market-data` | Logical runtime sessions, connection sharing and quotas |
| Runtime ownership and recovery references | Existing `RuntimeRegistry` / runtime persistence | Store/restore session identity and configuration references |
| PAPER ledger and fills | `corex-broker-contract` | Consume observations; no provider ownership |
| Dataset metadata/storage | Existing Stage-4 dataset work | File identity, access, validation and replay resource |
| UI selection and status | Frontend run/settings feature | Show configured sources and submit IDs, never secrets |

The resolver can be implemented as a method/service within the existing application settings/configuration boundary. It should not create another global mutable `activeProvider`.

## 11. Confirmed defects and follow-up investigation register

| ID | Priority | Finding | Required characterization/acceptance |
|---|---|---|---|
| DATA-01 | P0 | MarketFeed routes by symbol without source/session identity | Two sources emit the same symbol; only their selected runtimes receive each event |
| DATA-02 | P0 | Runtime desired-state persistence omits data-source binding | Restart restores the exact same provider connection/dataset and replay settings |
| DATA-03 | P1 | TwelveDataProvider wraps a shared singleton | Two credentials/sessions cannot mutate or disconnect one another |
| DATA-04 | P1 | Paper driver owns file-provider initialization and config shape is mismatched | Paper driver has no provider construction; factory/runtime config path is tested end-to-end |
| DATA-05 | P1 | File replay emits global ticks, not scoped bar events | Replay targets one runtime and invokes correct bar/tick callbacks |
| DATA-06 | P1 | Runtime launch UI/API does not carry data-source selection | Both launch surfaces submit the same validated runtime-spec contract |
| DATA-07 | P1 | Strategy state persistence is strategy-scoped | Two instances of one strategy persist/restore independent state |
| DATA-08 | P1 | RuntimeRegistry enforces one runtime per account/symbol/mode | Owen decides whether this product restriction remains when different strategies select different sources |
| DATA-09 | P1 | Runtime timeframe is not consistently propagated from UI through strategyLoader | Launch timeframe is either applied or the UI stops offering a misleading override |
| DATA-10 | P2 | Connection config retrieval is incomplete and global env mutation remains | Connection profile resolves non-secret config and secret material per selected connection |
| DATA-11 | P2 | Provider quota and subscription ownership are not connection-scoped | Multiple runtimes share a configured connection without exceeding quotas or disconnecting each other |
| DATA-12 | P2 | Provider reconnect/gap-fill policy is not runtime-specific | Disconnect, retry, gap recovery, stale data and shutdown are tested per session |

These are discovery findings, not authorization to implement all fixes together. They should be characterized and assigned to the authoritative roadmap after review.

## 12. Proposed implementation sequence after architecture approval

1. **Contract and behavior characterization:** tests for current provider lifecycle, event routing, file replay, warmup, PAPER bar/tick handling, runtime identity and recovery.
2. **Configuration handshake:** define the approved launch request, provider connection reference, dataset reference, resolved runtime specification and secret boundary. Reuse existing settings services.
3. **Runtime data sessions:** introduce per-runtime logical session ownership, source-aware events and provider capability validation. Remove global active-provider dependence from runtime paths.
4. **Provider isolation and quota management:** make Twelve Data adapter/session ownership real; support connection sharing only with explicit reference counting and quota enforcement.
5. **PAPER replay correction:** remove file replay from CoreXPaperDriver; make replay session-owned and dispatch bars/ticks correctly.
6. **Runtime persistence and recovery:** persist selected source/config version and per-runtime strategy state; reconstruct safely after restart.
7. **Frontend integration:** provider connection management and launch-time source selection in all launcher surfaces.
8. **End-to-end verification:** two providers, same symbol isolation, multiple symbols, file replay, quota exhaustion, disconnect/reconnect, stop during boot, process restart, PAPER/LIVE isolation and BACKTEST separation.

Do not start a broad rewrite of the provider package before the contracts, lifecycle and routing tests establish the required behavior.

## 13. Questions for Claude's independent review

Claude should challenge the design rather than merely polish it.

1. Does "one source per runtime, multiple sources across runtimes" correctly supersede the 20 August global-provider wording without changing unrelated runtime identity rules?
2. Should the current one-runtime-per-account/symbol/mode restriction remain, or does it contradict the intended independent runtime model?
3. Is the physical-connection/logical-session split sufficient for API quota limits, or does any provider require a different ownership model?
4. Should provider events use injected callbacks or the event bus with mandatory session IDs? Which option gives the clearest package boundary?
5. What exact runtime configuration fields must be persisted to make restart deterministic without storing secrets?
6. How should file replay clock, bar/tick event semantics and PAPER fill behavior be specified?
7. What must happen when a saved provider connection is revoked, quota-limited or unavailable during recovery?
8. What is the safest LIVE restoration policy?
9. How should runtime-scoped strategy state be persisted without creating a second runtime registry?
10. Which responsibilities belong in existing packages versus the application composition layer, respecting roadmap L4 and the current package ownership?
11. What must be coordinated with the unconfirmed Stage-4 dataset resource model?
12. What is the smallest implementation sequence that proves isolation before adding more providers?

**Requested Claude output:** (a) corrections to this report, (b) final proposed object/contract map, (c) startup/data/recovery/shutdown sequence, (d) decisions requiring Owen, (e) bounded implementation milestones and acceptance tests. Claude's review is advisory; only Owen approves the final architecture.

## 14. Evidence inspected

Current GitHub `main`:
- `plans/decisions.md` — historical broker/data decisions, including the global-provider wording.
- `plans/ROADMAP.md` — L4 configuration restriction, L8 runtime identity, Stage-4 dataset resource model status.
- `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md` — existing market-data/execution separation proposal.
- `plans/architecture/BROKER_OWNERSHIP_AND_SOCKETX_AUDIT.md` — current package ownership, broker, Socket_X and MT5 findings.
- `packages/corex-market-data/index.js`, `src/DataProviderFactory.js`, `src/DataProviderContract.js`, `src/MarketFeed.js`, `src/providers/TwelveDataProvider.js`, `src/providers/FileDataProvider.js`, `src/legacy/twelvedata.js`.
- `packages/corex-broker-contract/src/RuntimeBrokerFactory.js`, `src/drivers/CoreXPaperDriver.js`.
- `engine/services/configService.js`, `services/integrationRuntime.js`, `packages/corex-accounts/src/connectionsService.js`.
- `engine/routes/executionController.js`, `engine/strategyLoader.js`, `engine/core/runtime/RuntimeLifecycle.js`, `engine/core/runtime/RuntimeRegistry.js`.
- `front_end/src/views/RunView.tsx`, `front_end/src/components/run/RuntimesSubTab.tsx`, `front_end/src/api/run.ts`.
- `db/migrations/015_corex_runtime_isolation.sql`.

Related planning:
- `plans/ROADMAP.md` is the active roadmap; `plans/COREX_DEVELOPMENT_PLAN.md` is marked superseded.
- `plans/KNOWN_ISSUES.md` records existing Socket_X, runtime recovery and ownership limitations.
- `plans/decisions.md` is append-only; do not rewrite historical decisions.

---

**Review boundary:** This report does not approve a database migration, new provider, new package, Socket_X mounting, live execution, automatic failover, or application-code implementation. The next gate is Claude's independent review followed by Owen's explicit decision.
