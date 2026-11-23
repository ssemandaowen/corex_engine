# Claude v2 — Current Checkout Validation

**Date:** 2026-11-22  
**Status:** PARTIAL — source and planning validation completed; runtime credential-state checks and test execution remain unverified.  
**Approved baseline:** Owen approved the complete Claude `Refined proposal v2.md` as the strategy, provider and backtest planning baseline.  
**Checkout:** `main`, HEAD `1f39d1fd87cba7d2b569c4120ddf16400b11878a`  
**Working tree:** Dirty before this validation. Existing modified and untracked files were preserved.

## 1. Executive result

Claude v2 is a coherent planning baseline and correctly preserves the major locked boundaries: separate data and execution ownership, no cross-domain Integration Catalog, no new credential framework or vault, D7 unchanged, risk in the engine, RuntimeRegistry as the only runtime owner, and no OANDA or `mt5_bridge` live-selectable connector types.

It is **not yet an implementation-ready description of the current checkout**. Several proposal findings are confirmed, some have changed since the 21-Nov snapshot, and several unknowns remain open. No implementation stage is scheduled by this validation.

## 2. Confirmed current-checkout findings

### Strategy package boundary

- `packages/corex-strategy-engine/src/Strategy.js` still imports `@utils/logger`, `@utils/strategy/StrategyStateStore`, `@utils/strategy/StrategyDataManager`, and `@core/core/strategy/StrategyContract`.
- `packages/corex-strategy-engine/src/ParamSchema.js` still imports `@utils/strategy/StrategyParamUtils`.
- The package validator is already package-based and uses `assertSafeInstance`; the legacy `utils/strategy/StrategyValidator.js` is still a full implementation that requires `BaseStrategy`. The legacy and package validators have diverged; they are not interchangeable wrappers.
- The package and legacy `StrategyManifest.js` files both remain present as full implementation files.
- `corex-broker-contract/src/base/BaseBroker.js` still imports `@utils/strategy/StrategyPositionManager`. The legacy path is a small shim to the package implementation, but D5 ownership still needs an explicit decision.
- The P2 task file says **“IN PROGRESS — scope reconciled; implementation not yet started”** and has no implementation branch/PR. Its roadmap row says IN PROGRESS. Treat P2 as planned/active for sequencing, but do not report its implementation as underway or completed.

**Disposition:** P2 is still required. P4 must inspect/repoint the remaining package leaks and legacy mirrors. P3/P4 ordering remains Owen's choice. P5 remains gated on both.

### Provider registry and manifests

- `packages/corex-market-data/index.js` constructs and auto-registers Twelve Data as the active provider during package load.
- `DataProviderFactory` has `register`, `setActive`, `getActive`, `getActiveName`, and dispatch methods, but no provider enumeration/list API was found.
- Yahoo Finance and FileDataProvider are exported by the package entrypoint but are not registered by the production entrypoint.
- No static provider manifest or ProviderManifest implementation was found in the market-data package.
- The current global active-provider factory is a real transitional limitation. PV-1 can add static metadata/conformance without changing registration, as Claude specifies. It does not implement per-runtime live sessions; PV-4 remains deferred.

**Disposition:** PV-1 is a valid additive foundation, not a fix for provider selection/session ownership. Do not describe Yahoo or FileDataProvider as production-selectable merely because they are exported.

### Credential ownership and resolution

- `engine/services/integrationRuntime.js` copies system integration settings into process-wide environment variables, including Twelve Data, MetaApi and MT5 bridge values, and applies configuration directly to legacy singleton services.
- `configService` decrypts system settings at the persistence edge. Its own comment says decryption is a no-op when `COREX_SECRETS_KEY` is not configured.
- `SecretsVault.encryptString()` deliberately returns plaintext when no encryption key is configured. The existence of the vault therefore does not prove persisted secrets are encrypted.
- `ConnectionsService` stores account-scoped connector credentials in `connections` through SecretsVault.
- Source search found no application read/write consumer of `user_connector_settings`; the live connector settings shim delegates to account-scoped `ConnectionsService`. The table is historical/dead schema, not a confirmed live user-credential store.
- A `credentialRef` field exists in the separate Socket_X account model, but no data-provider resolver for Claude's `{scope,id}` reference was found.
- The earlier P0 verification report recorded zero `connections` rows, zero `user_connector_settings` rows and no configured `ui.integrations` system settings. Those are prior observations, not rechecked in this validation.
- The presence of `COREX_SECRETS_KEY` and the encryption state of persisted values were not safely rechecked here. No secret values were read.

**Disposition:** PV-2 remains blocked on the U-5/U-6 evidence. Based on current source, user scope should not be treated as available. Do not remove the environment fallback until each consumer has a safe replacement.

### Backtest and data-source contract

- `engine/backtestManager.js` remains a large orchestration module (919 lines in the current checkout) and still owns validation, strategy adaptation, data acquisition, simulation orchestration and persistence.
- The backtest controller's existing `dataSource` field is a string mode (`ONLINE` / `OFFLINE`), not Claude's proposed `{providerId, credentialRef?}` object. The route does not currently validate provider ID, provider interval or provider bar-count metadata.
- `jobQueue.enqueue()` persists the payload as JSONB. The current backtest worker consumes `payload.options`; no `schemaVersion` was found in the engine job payload path.
- No production `BarSource`, `BacktestSpec`, `ProgressEvent` or `BacktestResult` contract was found in the package source. These remain proposed contracts.
- B10 is **SOURCE SCAN COMPLETE — empirical validation/benchmarks pending**. The B10 handoff says no representative backtest resource benchmark has been run. STAGE-4 remains UNCONFIRMED.
- BT-2/P7 therefore remains gated by BT-1, P5, P6, STAGE-4 confirmation and B1/B2 reconciliation.

**Disposition:** The additive PV-3 provider selection contract is approved as a design, but not implemented or scheduled. The existing ONLINE/OFFLINE string must not be mistaken for it.

### The 5,000-bar limit — U-4 resolved by source inspection

- `backtestDataResolver.MAX_BARS_LIMIT` rejects a requested total `outputsize` above 5,000.
- `DataProviderFactory.MAX_BARS_LIMIT` also rejects a total request above 5,000.
- The factory uses the provider's `getCapabilities().maxBars` to choose request chunk size when that provider limit is lower than the requested total.

**Finding:** In the current code, 5,000 is a global total-request cap, not a universal pagination block size. The roadmap/decision wording that calls it a “default block size” needs reconciliation against this implementation before any limit change.

### Execution and Socket_X boundary

- No application `ExecutionAuthority` implementation was found; it remains a design invariant in the Socket_X proposal.
- `RuntimeBrokerFactory` maps `LIVE` to `MetaApiDriver`. The current `MetaApiConnector` is explicitly a structural skeleton: `executeOrder()` returns success and a synthetic order ID without a real MetaApi API call.
- The MT5 bridge module is still exported and used by the server's `/mt5` WebSocket route and live-order services. The current `CONNECTOR_SCHEMAS` does not list `mt5_bridge`; the existing bridge module/receiver path must not be conflated with permission to reintroduce a live-selectable connector type.
- Provider stages must not add execution behavior or bypass the future common authority.

**Disposition:** Claude's decision to keep execution manifests metadata-only is correct. The current LIVE/MetaApi skeleton and legacy MT5 receiver are separate product/runtime risks, not provider-manifest work.

## 3. Claude unknowns U-1 to U-12

| Unknown | Validation result |
|---|---|
| U-1 — current tree vs 21-Nov snapshot | **PARTIAL.** HEAD is still `1f39d1f`; working tree has extensive pre-existing modified/untracked source, tests and plans. P2 source still contains the legacy imports. B1/B2/B4-related files are dirty. No diffs were changed. |
| U-2 — legacy validator/manifest wrappers | **RESOLVED.** Legacy validator/manifest are full files, not simple re-export wrappers. The legacy validator still requires BaseStrategy and differs from the package validator. |
| U-3 — production provider registration | **RESOLVED.** The package entrypoint auto-registers Twelve Data. No other production registration call was found; Yahoo/File are exported but not registered. |
| U-4 — 5,000 semantics | **RESOLVED.** Current code enforces 5,000 as a total request cap; provider-specific `maxBars` controls chunking. Reconcile the old “block size” wording. |
| U-5 — actual encryption in each environment | **BLOCKED / UNKNOWN.** Source has a plaintext fallback if no key is configured. Prior report did not check key presence or encrypted-row counts. Runtime key presence and stored-row encryption were not checked here. |
| U-6 — user_connector_settings usage | **RESOLVED BY SOURCE.** No application consumer found; account connector service uses `connections`. Prior DB report recorded zero rows. Do not use user credential scope without new evidence. |
| U-7 — STAGE-3, STAGE-4 and B10 | **PARTIAL / OWEN CONFIRMATION REQUIRED.** STAGE-3/4 remain UNCONFIRMED. B10 source scan is complete, but empirical validation and benchmarks are pending. |
| U-8 — job payload versioning | **RESOLVED BY SOURCE.** Jobs persist JSONB payloads; the current backtest path has no payload `schemaVersion`. The proposed provider-specific `dataSource` object is not present. |
| U-9 — PROV-01 and prior provider note | **RESOLVED.** PROV-01 is a review placeholder. The prior provider-only cross-domain catalog proposal is marked superseded; Claude's separate data/execution registry model governs. |
| U-10 — MT5 receiver vs prohibition | **RESOLVED WITH DISTINCTION.** The legacy `/mt5` receiver/module still exists; `mt5_bridge` is not in current `CONNECTOR_SCHEMAS`. Do not conflate an existing receiver with approval for a live-selectable connector or a new Socket_X terminal protocol. |
| U-11 — Position / StrategyPositionManager owner | **OPEN — D5.** Package implementation exists; BaseBroker still imports the legacy shim. Requires ownership decision after consumer inspection. |
| U-12 — old pipeline references | **PARTIAL.** Old pipeline files and engine imports remain. Search found no production call to `runPipeline()` outside its own definition; engine references the pipeline object for execution metrics/settings. D1 still needs a complete reference/caller check before removal. |

## 4. Scheduling and governance validation

- GitHub confirms **STAGE-1 / PR #79 is OPEN**.
- Roadmap P2 is IN PROGRESS, but the P2 task file says implementation has not started and no implementation branch/PR exists.
- `ENGINE-02B-P0-1` task file also says its PR is OPEN.
- The roadmap's statement that P2 and ENGINE-02B-P0-1 are the two active workstreams does not reconcile with the still-open STAGE-1 row. The exact classification of ENGINE-02B-P0-1 under rule 3 also needs to be made explicit. **No free slot is verified; do not schedule PV/BT/SH work yet.**
- `AGENT_WORKFLOW.md` still directs agents to `COREX_DEVELOPMENT_PLAN.md` and `STATUS.md` as authoritative sources, while `ROADMAP.md` explicitly supersedes both. This governance conflict can send agents to stale task/status data.
- The superseded Claude consolidation and handoff files remain in `plans/architecture/`; roadmap rule 8 says superseded documents should be moved to `plans/archive/` with a supersession header. This is documentation hygiene, not an application defect.

## 5. Approval boundary retained

The following remain as approved design dispositions: separate data/execution registries; no cross-domain Integration Catalog; D7 unchanged; additive per-backtest provider selection; one global default historical provider; reuse existing config/SecretsVault/ConnectionsService; no new risk package or runtime ledger; no dynamic package loading; no OANDA or `mt5_bridge` live-selectable connector types.

The following remain gated and are **not** authorized by approving Claude v2: per-runtime live data sessions, LIVE failover, any MT5 terminal protocol, StrategyHost implementation, behavior-changing SH-3 caps, D1/D2/D4/D5/D6/D9 decisions, and STAGE-3/STAGE-4 confirmation.

## 6. Verification limitations

- This was a read-only source and plan inspection. No application source or tests were modified.
- No test suite was run during this validation. The prior P0 verification report records 77 suites / 911 tests, but that result was not rerun here.
- No live provider request, authenticated API workflow or DB query was run during this validation.
- Runtime `COREX_SECRETS_KEY` presence and actual persisted-secret encryption remain unknown.
- All existing dirty working-tree changes were preserved; no staging, commit, push, merge, rebase, reset, stash or branch operation was performed.

## 7. Recommended next sequence

1. Reconcile the roadmap's active-workstream count and P2 task state before allocating any new slot.
2. Keep PV/BT/SH unscheduled. Do not turn B11/PROV-01 into an executable Kilo prompt.
3. Complete P2 implementation only under its existing bounded task; then Owen selects P3 vs P4.
4. Resolve U-5 through a secret-safe environment-presence check and sanitized database encryption counts before PV-2.
5. Confirm STAGE-3/STAGE-4 status with Owen and finish B10 empirical baseline/golden-run work before BT-1/BT-2.
6. Reconcile the 5,000 total-cap behavior with the old decision wording before any provider-limit change.
7. Correct the stale agent workflow source-of-truth references before handing work to another agent.
