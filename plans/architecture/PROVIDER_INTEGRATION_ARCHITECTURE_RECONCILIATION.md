# CoreX Provider Integration Architecture — Reconciliation and Delivery Plan

> **Review notice (2026-11-22):** This is an earlier assistant-generated provider-only analysis, not an approved architecture or the controlling refinement baseline. Read it alongside `COREX_STRATEGY_BACKTEST_PROVIDER_DESIGN_REVIEW.md`, which is grounded in Owen's uploaded Claude proposal and reconciles it with the current roadmap and decision log. Do not treat this document's recommendations—especially the proposed single cross-domain Integration Catalog—as approved or as overriding Claude's separate data-side `ProviderRegistry` / execution-side `DRIVER_REGISTRY` model or any locked repository decision.

> **Status:** DRAFT FOR OWEN REVIEW — no implementation authorization
> **Track:** PROV (provider integration); do not use P2, which is already assigned to strategy-contract retirement.
> **Owner / decision authority:** Owen Ssemanda
> **Created:** 2026-11-22
> **Primary architectural anchor:** `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`
> **Review inputs:** Claude's provider architecture review and the accompanying DeepSeek review supplied in the conversation.
> **Local evidence:** current CoreX checkout, provider verification reports, and current `integrationRuntime.js`.
> **Important source limitation:** the Claude artifact URL could not be fetched from this environment. This document captures the detailed recommendations pasted into the conversation; it does not claim to reproduce unprovided sections of the artifact.

---

## 1. Purpose and decision boundary

This document consolidates the provider-related recommendations into the existing CoreX architecture. It is an extension and reconciliation of the Socket_X / market-data / execution / backtesting proposal, not a replacement architecture and not an authorization to implement.

The goal is to finish the provider work without:
- creating a parallel plugin framework or duplicate registries;
- conflating market-data sources with execution adapters;
- reintroducing a global active-provider selection;
- storing user/account credentials in process-global environment variables;
- claiming capabilities that have not been implemented and verified;
- pulling strategy P2, Socket_X execution redesign, or backtest package extraction into this track without their own approvals.

P1 provider-related implementation has been accepted separately:
- frontend credential-like defaults cleared;
- Yahoo Finance updated for yahoo-finance2 v4.x;
- authenticated API → queue → worker → runtime identity check completed for BTC/USD and BTCUSD;
- 79 historical backtest failures classified.

This PROV track addresses the remaining provider architecture and operational discoverability.

## 2. Existing architectural anchor — preserve and extend

`MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md` already establishes the governing invariants:

1. Market data and execution are independent choices.
2. A provider may offer one or both capabilities, but configuration and consumption remain independent.
3. No global active provider or implicit account selection.
4. Data sessions are owned per runtime/subscription; compatible physical connections may be shared as an optimization.
5. Capabilities and failures must be truthful.
6. No silent data mixing; source provenance is retained.
7. The market-data subsystem does not own order execution, account risk or trading decisions.

The existing proposal is the source of truth for these invariants. This document must not reopen them casually.

### 2.1 Confirmed implementation conflict

The current `packages/corex-market-data/src/DataProviderFactory.js` still contains the single-active-provider factory/selection behavior, while the target proposal requires independent per-runtime/per-subscription data sessions and no global active-provider choice.

**Decision needed:** supersede the old operational constraint in a dated ADR, while retaining current behavior until the per-runtime session implementation is proven. Do not silently remove the constraint in a registry/discoverability change.

### 2.2 Two orthogonal capability axes

Use two independent capability axes:
- **data-capable** — historical bars, streaming ticks/candles, replay or other explicitly defined data operations;
- **execution-capable** — order submission/modification/cancellation/close, account state, positions and execution events, each explicitly defined.

A manifest may describe an integration that implements either axis or both. A descriptive `category` field may exist for UI grouping, but must not define mutually exclusive architecture types.

Consequences:
- File/CSV/JSON replay is a market-data source, not a separate architectural subsystem category.
- MetaApi and MT5 local terminal adapters are execution integrations; they are not market-data providers unless a separately implemented and verified data capability exists.
- OANDA must not be treated as implemented merely because a dependency or environment variable exists.

## 3. Catalog and registration model

### Proposed direction: central trusted catalog, existing subsystem factories

Use one application-visible Integration Catalog as the source of discoverable integration metadata and registration policy. Keep instance creation and runtime ownership in the existing subsystem components.

The catalog should not become a universal factory, connection manager, credential store or runtime registry.

| Existing component | Retained responsibility |
|---|---|
| `DataProviderFactory` | Market-data adapter construction and data operations, evolved to support scoped sessions |
| `DataProviderContract.getCapabilities()` | Market-data contract and truthful runtime capability reporting |
| `DRIVER_REGISTRY` | Execution/broker driver construction |
| `SecretsVault` | Secret encryption/decryption and safe masking; not ownership policy by itself |
| `RuntimeRegistry` | Strategy runtime ownership/lifecycle; not the integration catalog |

No second market-data registry, broker registry, credential vault or runtime registry should be introduced.

### 3.1 Registration policy

- Initially use explicit, centrally controlled registration of trusted integrations.
- Do not scan directories, execute arbitrary package entrypoints or dynamically load third-party code in this track.
- Define a declarative, versioned manifest format with `schemaVersion: 1`.
- The manifest describes identity, display metadata, supported capability identifiers, configuration schema references, credential requirements, lifecycle/probe requirements and implementation package identity.
- The manifest is data; it must not contain executable code or arbitrary import paths.
- Define an internal `resolveEntrypoint(packageName)` seam only if needed to keep future packaging options open. Do not implement dynamic resolution or package installation now.
- Dynamic plugin discovery is a separate future decision after security isolation and PROV end-to-end verification.

This is a central registry now with a future-compatible manifest seam, not a hybrid runtime loader.

## 4. Capability model

Capabilities must use a versioned vocabulary (stable identifiers / enum), not unrestricted free-form strings.

The capability model must:
- distinguish data from execution;
- represent each operation independently (for example historical bars vs streaming; submit vs cancel vs positions);
- reject unknown capability identifiers during manifest/adapter validation;
- distinguish declared capability from verified/available capability;
- expose limits and constraints (symbols, intervals, history depth, rate limits, order types, account requirements, etc.);
- never infer support merely because a method exists;
- report a missing dependency, missing credentials, unsupported operation, provider outage and failed health probe as distinct states.

The existing provider contract's `getCapabilities()` remains the runtime source for actual adapter capabilities. The catalog manifest is the declared contract; registration/health verification must detect disagreement.

## 5. Credential ownership and resolution — architectural blocker

### 5.1 Current-state finding

The current `engine/services/integrationRuntime.js` reads global integration settings and copies values into `process.env` using `applyEnvVar()`. This includes Twelve Data, MetaApi and MT5 bridge configuration. It also applies some settings directly to legacy singleton services.

This is confirmed in the current local checkout. A process-global environment variable cannot safely represent concurrent per-user or per-account credentials and is not an acceptable target credential-resolution boundary.

### 5.2 Target model

Use credential references resolved at the point of use by the owning integration service. Do not pass raw secrets through strategy configuration, manifests, logs, UI defaults or general runtime state.

Credential ownership scopes:
- system-level credentials for explicitly system-owned integrations;
- user-level credentials for user-owned provider connections;
- account-level credentials for a specific broker/trading account or connector binding.

A binding must identify owner, integration, credential purpose and scope. It must not infer ownership from a process-global environment variable.

### 5.3 Precedence and hard isolation

For eligible non-execution data integrations, a policy may resolve the most-specific available credential (account > user > system) only where the integration and product policy explicitly permit fallback. The resolver must report the source/scope identifier to authorized diagnostics without returning secret material.

**Execution credentials must never silently fall back to a system token.** The execution path must require an explicitly authorized account-scoped binding (or another explicitly approved ownership model); absence is a hard failure.

No cross-user or cross-account credential fallback is allowed.

### 5.4 P2/PROV sequencing

Credential ownership and resolution constraints are PROV-01 architecture acceptance criteria. The code migration away from `process.env` is a separate bounded implementation task, dependent on inspection of every current consumer and credential source. Do not simply remove environment variables before adapters have a safe replacement path.

Verify encryption-at-rest and key management separately. The existence of `SecretsVault` does not prove all persisted connector secrets are encrypted correctly.

## 6. Lifecycle and readiness states

Do not compress registration, configuration and health into one boolean.

Proposed observable states:
- `registered`: trusted manifest and implementation are known to CoreX;
- `configured`: required configuration and authorized credential references exist;
- `connecting`: lifecycle initialization or connection probe is in progress;
- `healthy`: required health probe succeeded and declared capabilities are currently usable;
- `degraded`: integration is present but one or more capabilities are unavailable or constrained;
- `unavailable`: missing dependency, failed connection, invalid configuration or other explicit blocker;
- `stopping` / `stopped`: lifecycle teardown states where applicable.

"Usable" must be capability-specific and health-aware. A healthy historical-data capability does not imply a healthy streaming or execution capability.

Lazy initialization is preferred where safe. Lifecycle, connection sharing, cleanup and per-runtime ownership remain with the existing subsystem runtime/factory.

## 7. Per-runtime data sessions and single-provider retirement

The target architecture requires data selection/session ownership per runtime or subscription, with optional safe sharing of physical connections.

The current single-active-provider factory constraint is therefore a transitional implementation limitation, not the target design.

Proposed migration:
1. Document the old constraint as superseded for the target architecture.
2. During catalog/capability work, retain compatibility and emit a clear deprecation/diagnostic signal where the old selection path is used.
3. Define session identity, owner, provider binding, canonical instrument, provider symbol, interval/fields, subscription reference counting, cancellation and provenance.
4. Implement multiple provider instances/sessions without cross-runtime subscription collisions.
5. Prove concurrent same-symbol runtimes can use different compatible sources.
6. Retire the global active-provider operational constraint only after concurrency, cleanup, failover and regression tests pass.

Failover is not automatic by default. It requires an explicit policy and compatibility checks for instrument, timestamp, bid/ask/last semantics, intervals, data quality and source provenance. Active LIVE runtime failover requires separate explicit approval.

## 8. Backtest and BarSource boundary

Retain the existing D7 decision to defer whether `corex-backtest` becomes a separately installable/package-owned implementation.

Architecturally anticipate a `BarSource` seam: backtesting consumes bars through a stable source contract without knowing the concrete provider. The same source boundary should be testable against historical providers and the live market-data subsystem without coupling backtest orchestration to provider internals.

The package decision is deferred until PROV end-to-end verification demonstrates the seam under backtest and live load. Do not impose a P7 date or extract a package merely to satisfy this proposal.

Provider capability validation should replace hardcoded assumptions (including duplicated historical bar limits) only after the actual call paths and capability semantics are verified.

## 9. Migration and database safety preconditions

No schema migration is authorized by this architecture document.

Before any PROV task adds migrations:
- inspect the current migration runner and transaction helper;
- verify whether nested `BEGIN`/`COMMIT` statements can break the runner's `withTransaction` atomicity;
- verify migration file discovery does not accidentally execute verification/probe SQL;
- migration files must contain idempotent schema changes only;
- verification and probe scripts belong under `db/verify/` or another non-migration location;
- schema changes require explicit owner, backfill/rollback plan and production-data safety review.

The nested-transaction and `029_verify.sql` concerns were raised by the independent review but have not yet been independently verified in this reconciliation. Treat them as preflight checks, not established defects.

## 10. Out-of-track findings to preserve

These findings must not silently expand PROV scope:

- `SignalGenerationEngine._recordError` may write ERROR to `stateManager` while `RuntimeRegistry` is the lifecycle source read elsewhere. Independently verify and record a separate runtime-state consistency issue if confirmed.
- MT5 EA hardening concerns (URL allowlisting, negative-number parsing, configured heartbeat URL handling) belong to the MT5 execution/security workstream. Either explicitly exclude MT5 production support from PROV acceptance or require that separate workstream to close before advertising MT5 as production-ready.
- Strategy sandbox concerns (SEC-01 / SEC-03) are separate security workstreams. They are one reason dynamic third-party module loading is not approved.
- The 79 failed historical backtest jobs have been classified in the P1 investigation; do not reopen them as provider defects without new evidence.

## 11. Current provider inventory and truthfulness

Based on the provider verification and subsequent P1 acceptance:
| Integration | Current classification | Current status / boundary |
|---|---|---|
| Twelve Data | Market data | Active implementation; REST and WebSocket EUR/USD verified; BTC/USD historical verified in prior evidence |
| Yahoo Finance | Market data | v4 compatibility implementation accepted; 21 provider tests reported passing; production registration/real external request after fix must be verified before claiming operational support |
| FileDataProvider | Market data / local replay | Implemented and exported; not registered by default; local file path, parsing, replay and lifecycle need bounded contract verification |
| OANDA | Candidate data and/or execution integration | No application provider/consumer verified in prior inventory; dependency and environment variable are not implementation |
| MetaApi | Execution integration | Existing connector reported as skeleton; not a market-data provider; no real execution claim |
| MT5 Bridge / local EA | Execution transport/adapter path | Authentication/transport integration, not a market-data provider; real terminal execution remains separately unverified |

Provider support is capability-specific. A provider name in the catalog is not proof of usable support. Exact supported symbols, intervals, history depth, streaming, account operations and order operations must be verified independently.

## 12. Proposed PROV delivery sequence

The sequence is intentionally bounded. These are proposals, not approved task statuses.

| ID | Proposed scope | Exit evidence |
|---|---|---|
| PROV-01 | Reconcile architecture, manifest v1, capability vocabulary, credential boundary and superseding decisions | Approved ADRs and interface/ownership map |
| PROV-02 | Central trusted catalog and explicit registration; enumerate current integrations | Catalog lists only trusted implementations with truthful metadata; no dynamic loading |
| PROV-03 | Capability validation and provider conformance | Declared vs actual capabilities validated; unknown capability rejected |
| PROV-04 | Credential reference resolution and removal of unsafe process-global credential propagation | Concurrent users/accounts isolated; execution has no system-token fallback; secret values absent from logs |
| PROV-05 | Per-runtime data sessions and retirement of global active-provider constraint | Concurrent runtimes, same symbol/different providers, reference counting, cleanup and provenance tests |
| PROV-06 | Configuration refresh, health/readiness and UI discoverability | State reflects registered/configured/healthy/degraded accurately; settings do not imply unsupported capability |
| PROV-07 | End-to-end provider verification and regression | REST/WS/history/replay, concurrent sessions, credentials, backtest BarSource and failure cases evidenced |

Dependencies:
- PROV-02 depends on PROV-01.
- PROV-03 depends on PROV-01/02.
- PROV-04 depends on PROV-01 and a complete credential-consumer inventory; it can proceed in parallel with catalog tests only after the boundary is approved.
- PROV-05 depends on PROV-01/02/03 and requires explicit approval to retire the operational single-provider constraint.
- PROV-06 depends on the actual catalog/capability/credential/runtime APIs, not UI-first assumptions.
- PROV-07 validates the integrated result and the `BarSource` seam.

Do not implement PROV-02 through PROV-07 as one large change. Each task needs changed-file boundaries, tests, migration/security constraints and an explicit acceptance checklist.

## 13. Decisions requiring Owen's approval

1. Approve the existing Socket_X proposal as the controlling architecture and this document as an extension.
2. Approve the two capability axes (data-capable and execution-capable), with category as descriptive metadata only.
3. Approve one trusted central catalog with explicit registration and manifest schema v1; defer dynamic module discovery/loading.
4. Approve reuse of existing subsystem factories, contracts, SecretsVault and RuntimeRegistry; prohibit parallel registries.
5. Approve the credential ownership model and the hard rule that execution credentials never fall back to a system token.
6. Approve capability identifiers as a versioned vocabulary with unknown identifiers rejected.
7. Approve lifecycle/readiness as capability-specific states, not a single configured/healthy boolean.
8. Approve the target per-runtime data-session model and schedule operational single-active-provider retirement for the session implementation stage, not the catalog stage.
9. Retain D7's backtest package deferral until the `BarSource` seam is proven.
10. Require migration-runner preflight before any PROV schema change; the reported runner issues remain unverified.
11. Keep MT5 EA hardening and runtime-state/circuit-breaker divergence as separately owned findings unless a later dependency review proves they block a specific PROV task.

No item above is an approved ADR until Owen explicitly approves it and it is recorded in `plans/decisions.md` and the authoritative roadmap.

## 14. Explicit non-goals

- No dynamic plugin installation, directory scanning or arbitrary module loading.
- No parallel IntegrationRegistry/ProviderRegistry/BrokerRegistry/SecretsVault/RuntimeRegistry.
- No change to Socket_X execution authority or mounting/routing.
- No LIVE trading enablement or claim of production-ready MetaApi/MT5 execution.
- No OANDA implementation solely because an API key/dependency exists.
- No automatic provider failover for active LIVE runtimes.
- No backtest package extraction or schema change.
- No strategy-contract P2 work.
- No staging, commit, push, merge or modification of unrelated working-tree changes.
