# CoreX — Active Roadmap

> Single active roadmap. Last updated: 2026-11-23
> Owner: Owen Ssemanda (Apex Trait Ltd.) — approval authority
> Scope: phase order, task IDs, dependencies, status, approval gates
> Status dashboard of record: this file. `plans/STATUS.md` is superseded (banner only, history).
> Historical roadmap: `plans/COREX_DEVELOPMENT_PLAN.md` (banner only; do not update).
> Workflow rules: `plans/AGENT_WORKFLOW.md`. Decisions: `plans/decisions.md`. Issues: `plans/KNOWN_ISSUES.md`.

Baseline statuses, branches, PR numbers and SHAs were refreshed against Git and GitHub on 2026-11-22 (`origin/main` = `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`). On 2026-11-22 Owen approved Claude's complete `Refined proposal v2.md` as the planning baseline for strategy, provider and backtest design. This approval does not schedule implementation or waive dependencies, unknowns, roadmap rules or stage-specific gates.

---

## 1. Rules

1. **The repository is the only source of truth.** Chat advice (any agent, any reviewer) counts only
   after it has been written into a task file under `plans/tasks/` or into a row of this roadmap.
2. **Reviewers are reviewers.** ChatGPT, Gemini and Claude may review; they never approve. A plan is
   approved only by Owen, and the approval is recorded here (row status + date + PR).
3. **At most two workstreams open at a time.** Only phase/stage workstreams count toward the limit:
   rows in section 3 with an ID of `ROADMAP`, `STAGE-n`, `E-n` or `P-n`. Backlog items (B-series)
   and completed workstreams do not count.
4. **One PR per phase.** Phases do not share PRs. No merging before review. A PR that completes a
   workstream updates its row in this file in the same PR.
5. **Old audits live in `plans/archive/`** with a supersession header. They are history, not authority.
6. **No new task file is created for a workstream until it starts.** Until then the row says
   "task file created when the workstream starts".
7. **Folder recomposition is derived, never improvised.** No folder moves before E1's caller
   inventory is approved, and P7/P8 execute it.
8. **Scope changes need Owen.** Any change to a protected boundary (`AGENTS.md` §11) stops the work.

## 2. Locked decisions (do not reopen without Owen)

> L8–L10 are taken from `AGENTS.md` and the merged Stage 2 work; they are recorded here, not new decisions.

| # | Decision |
|---|---|
| L1 | Forward-only strategy lifecycle: no legacy adapter path. `utils/BaseStrategy.js` and the legacy `adapt()` path are deleted, not shimmed. |
| L2 | Lifecycle vocabulary is `onStart` / `onBar` / `onTick` / `onFill` / `onStop` (DeclarativeStrategy). |
| L3 | No DSL. Strategies are classes; no new authoring language. |
| L4 | No new configuration framework. Reuse the existing config/settings services. |
| L5 | Risk logic stays in the engine. There is no standalone `corex-risk` package. |
| L6 | Packages own domain logic; the engine coordinates (orchestration only). |
| L7 | Folder recomposition comes last, derived from the register produced by E1 and executed by P7/P8. |
| L8 | Runtime identity is `userId::strategyName::symbol::mode` (`AGENTS.md` §7.6, unchanged). |
| L9 | `RuntimeRegistry` is the single authoritative runtime owner (Stage 2, PR #63). No second ledger. |
| L10 | Broker modes are exactly `Backtest` / `Paper` / `Live`, through `BrokerContract` → `BaseBroker` → `RuntimeBrokerFactory`. |

## 3. Planned sequence (dependency order)

| Order | ID | Title | Status | Depends on | Branch / PR | Task file | Notes |
|---|---|---|---|---|---|---|---|
| 1 | STAGE-1 | Dataset upload multipart fix with a genuine regression test | IN PROGRESS | — | `fix/upload-multipart-genuine-regression` / PR #79 (OPEN) | task record not yet created | PR #79 replaces closed-unmerged PR #58. Its body records the actual-client regression: imports the real Axios client through Vite SSR, exercises the XHR adapter in a browser-like environment, verifies FormData remains FormData, and includes a forced-JSON control. Targeted test 1/1 and frontend build passed. PR #58 is superseded; do not revive it. |
| 2 | ROADMAP | Consolidate plans into this single roadmap | DONE | — | PR #64 | — | Merged as `20bad625434dcbefcd7bea2a5d389ff887159d82`; this document is the active roadmap. |
| 3 | E1 | `engine.js` caller inventory and ownership mapping — **INVENTORY ONLY** | DONE | ROADMAP reviewed | `docs/engine-e1-final-report` | `plans/tasks/ENGINE-02B-E1.md` | **Complete — report: `plans/Audit/ENGINE-02B_E1_engine_inventory.md`** (all seven questions answered, 26 CONFIRMED / 4 INFERRED / 3 UNKNOWN, eight prior findings re-verified). It does NOT repoint any caller; repointing happens inside E2–E4 (and E5), each PR moving only its own methods and separately approved. Implementation handoff is **proposed work, not approved**: four P0 correctness defects (recovery result check, recovery identity space, `stop()` leaves runtimes/timers/listeners, listener leak per restart), three P1 extractions that map to E2/E3/E4, and one P1 blocked on a product decision (warmup cache revive-vs-delete). |
| 4 | P1 | Instance-safety guard (`assertSafeInstance` in `corex-strategy-engine`) | DONE | STAGE-1 PR opened (#79) | `fix/strategy-instance-safety-guard` / PR #80 (MERGED) | `plans/tasks/P1-instance-safety-guard.md` | Accepted by Owen and squash-merged 2026-11-20 as `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`. Verification: package 12 suites / 125 tests; root compiler + loader/recovery 2 suites / 17 tests. Post-construction integrity guard only, not a sandbox. B3 subsequently merged; P2 is now active. |
| 5 | B3 | Strategy module-resolution boundary + exact strategy-module allow-list | DONE | P1 (DONE, PR #80); Stage 2 (DONE, PR #63) | `fix/security-corex-strategy-engine` / PR #57 (MERGED 2026-11-21) | Merged into `main` as `1f39d1fd87cba7d2b569c4120ddf16400b11878a`. Full repository verification: 67 suites / 766 tests passed. B3 restricts the injected CommonJS `require` channel only; SEC-01 execution isolation remains separate. P2 subsequently merged; P3 is now active. See `plans/tasks/B3-sandbox-module-resolution.md`. |
| 6 | P2 | Remove `StrategyContract` from the canonical Strategy path; move `getStateSnapshot`, `__corexApi`, symbol normalization into the `Strategy` base class | DONE | P1 (DONE); B3 (DONE) | `fix/p2-strategy-contract-retirement` / PR #82 (MERGED) | Merged as `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`. Full verification: 79 suites / 947 tests. Legacy `BaseStrategy` remains for P5; canonical Strategy path no longer uses StrategyContract. |
| 7a | E2 | `StrategySupervisor` extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | Fixes the `STATE_CHANGED` listener leak and recovery timers that survive `stop()`. |
| 7b | E3 | Banner + wiring extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | Wiring stays at construction time. |
| 7c | E4 | Telemetry extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | E2/E3/E4 are parallel-safe with P-phases subject to rule 3. |
| 8 | P3 | Authoring surface: template into the package, scripts, `::demo` + orphan runtime row cleanup | IN PROGRESS | P2 (DONE) | main checkout / PR pending | `plans/tasks/P3-strategy-authoring-surface.md` | Package template and strategy-package documentation now describe the current lifecycle, typed params, declarative indicators, context operations and supported boundaries (2026-11-23). `::demo` deletion remains gated by D4; STRAT-DEL-1 targets only the three VerifyStrategy IDs and requires the owner approval file. Indicator parity/purity follow-ups are in `plans/KNOWN_ISSUES.md` §2 and package `docs/KNOWN_ISSUES.md`. |
| 9 | P4 | Repatriate `utils/strategy` | LATER | P2 (DONE); scheduled after P3 | task file created when the workstream starts | task file created when the workstream starts | Owen selected P3 then P4. The stages are technically independent after P2; this is the chosen delivery order. Repoint consumers to package-owned logic, remove mirrors/shims, and inspect D5 ownership without deleting BaseStrategy (P5). |
| 10 | P5 | Delete legacy (`BaseStrategy`, legacy `utils/strategy`, security allowance) | LATER | P3, P4 | task file created when the workstream starts | task file created when the workstream starts | The `IncrementalIndicators` test MIGRATES to the package; it is not deleted. |
| 11 | E5 | Warmup consolidation into one owner (`engine.warmupStrategy` vs `RuntimeLifecycle._warmup`) | LATER | P5, D3, D9 | task file created when the workstream starts | task file created when the workstream starts | D9 decides the single owner. |
| 12 | P6 | Risk single-source + dead pipeline removal | LATER | P5 | task file created when the workstream starts | task file created when the workstream starts | D1, D6. A latency benchmark is required as evidence. |
| 13 | STAGE-3 | Stage 3 — WebSocket stage | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Status is not confirmed in any repository record. Owen to confirm before this row is scheduled. |
| 14 | STAGE-4 | Stage 4 — Dataset resource model | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Blocks the data-acquisition part of the `backtestManager` split (P7). |
| 15 | P7 | Recomposition: `backtestManager` split; `StrategyLoader` facade collapse into `engine/strategyLoader.js` | LATER | P5, P6, STAGE-4 | task file created when the workstream starts | task file created when the workstream starts | ENGINE-03 implementation half; split `backtestManager` inside `engine/` using the E1 register (L7), not a new package. Requires BT-1, P5, P6, STAGE-4 confirmation, and B1/B2 reconciliation. See approved Claude v2 planning baseline below. |
| 16 | P8 | Boundary enforcement (`madge` / `dependency-cruiser` rules) | LATER | P5, P6 | task file created when the workstream starts | task file created when the workstream starts | Rule set derived from P7's register. |
| 17 | ENGINE-02B-P0-1 | Recovery correctness: exact runtime target, `result.ok` check, attempt counter across recovery's own `STOPPED` | DONE | E1 (DONE, `467e79c`) | `fix/engine-recovery-correctness` / PR #66 (MERGED) | `plans/tasks/ENGINE-02B-P0-1.md` | Merged as `da7dfd63f1c94c2d7657945ef91635f8808b9639`. Verification: 12 recovery tests passed; full suite 61 suites / 673 tests. B9 remains a separate follow-up. |
| 18 | P0-03 | Frontend architecture, performance and behavior audit — inventory only | LATER | Current frontend baseline verified | task file created when the workstream starts | `plans/tasks/P0-03-frontend-architecture.md` | Existing READY audit specification. Not an active workstream yet; starts only when one of the two current workstreams closes. Must map data/state/API/WS ownership, inactive-view work, polling, render pressure, bundle loading, charts, UI states and measured resource baselines. No implementation in the audit. |

### Completed workstreams (for traceability)

| ID | Title | Status | Merged | PR | Notes |
|---|---|---|---|---|---|
| ROADMAP | Consolidate plans into this single roadmap | DONE | `20bad625434dcbefcd7bea2a5d389ff887159d82` | PR #64 | Active roadmap and planning consolidation merged 2026-11-14. |
| ENGINE-01 P0 | Baseline persistence fix + characterization tests | DONE | `8dd6048` | PR #62 | 59 suites / 626 tests baseline. |
| ENGINE-01 S2 | Atomic runtime ownership | DONE | `e2f8f271a954dc2c426d5f43f059cdd6502f04c2` | PR #63 | 60 suites / 661 tests. Record: `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`. |
| P3-04 | Broker folder ownership cleanup | DONE | `36316b1` | PR #61 | Also on the Stage 1 branch as `7401e35` (same content, different SHA). |
| P1 | Strategy instance-safety guard | DONE | `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c` | PR #80 | Accepted by Owen 2026-11-20; 12 package suites / 125 tests and 2 root compiler/loader suites / 17 tests passed. Task: `plans/tasks/P1-instance-safety-guard.md`. |
| B3 | Strategy module-resolution boundary + exact allow-list | DONE | `1f39d1fd87cba7d2b569c4120ddf16400b11878a` | PR #57 | Merged 2026-11-21; full repository verification 67 suites / 766 tests. Task: `plans/tasks/B3-sandbox-module-resolution.md`. |
| P2 | StrategyContract retirement and canonical Strategy ownership | DONE | `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b` | PR #82 | 79 suites / 947 tests; task: `plans/tasks/P2-strategy-contract-retirement.md`. |
| ENGINE-02B-P0-1 | Recovery correctness | DONE | `da7dfd63f1c94c2d7657945ef91635f8808b9639` | PR #66 | 12 recovery tests; full suite 61 suites / 673 tests. Task: `plans/tasks/ENGINE-02B-P0-1.md`. |
| ENGINE-01A | Legacy strategy path removal — read-only impact report | DONE | pending this PR | — | `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`; decision support only, nothing implemented. |

## 4. Workstreams (parallel view)

### ENGINE-02A — strategy package hardening

| ID | Title | Status | Depends on |
|---|---|---|---|
| P1 | Instance-safety guard | DONE | STAGE-1 PR #79 opened; merged PR #80 |
| P2 | Remove `StrategyContract` from canonical Strategy path; move state/API/symbol normalization | DONE | P1, B3 (both DONE) |
| P3 | Authoring surface (template, scripts, `::demo` cleanup) | IN PROGRESS | P2 |
| P4 | Repatriate `utils/strategy` | LATER | P2; scheduled after P3 |
| P5 | Delete legacy strategy path | LATER | P3, P4 |
| P6 | Risk single-source + dead pipeline removal | LATER | P5 |

### ENGINE-02B — engine coordination cleanup

| ID | Title | Status | Depends on |
|---|---|---|---|
| E1 | `engine.js` caller inventory — **DONE**, report `plans/Audit/ENGINE-02B_E1_engine_inventory.md`; handoff proposed (4 P0 defects, E2/E3/E4, warmup decision) | DONE | ROADMAP |
| E2 | `StrategySupervisor` extraction (+ listener/timer fixes) | LATER | E1 |
| E3 | Banner + wiring extraction | LATER | E1 |
| E4 | Telemetry extraction | LATER | E1 |
| E5 | Warmup consolidation into one owner | LATER | P5, D3, D9 |

### ENGINE-03 — structure

| ID | Title | Status | Depends on |
|---|---|---|---|
| P7 | Recomposition (`backtestManager` split, `StrategyLoader` facade collapse) | LATER | P5, P6, STAGE-4 |
| P8 | Boundary enforcement (`madge` / `dependency-cruiser`) | LATER | P5, P6 |

### ENGINE-01 — runtime ownership

| ID | Title | Status | Depends on |
|---|---|---|---|
| ENGINE-01 P0 | Baseline persistence fix | DONE | — |
| ENGINE-01 S2 | Atomic runtime ownership | DONE | ENGINE-01 P0 |
| STAGE-3 | WebSocket stage | UNCONFIRMED | Owen |
| STAGE-4 | Dataset resource model | UNCONFIRMED | Owen |

## 4A. Approved design baseline — Claude v2 (2026-11-22; not scheduled)

Owen approved the complete `Refined proposal v2.md` as the planning baseline. This adopts its architecture recommendations and delivery design, but it does not create active workstreams, close the open decisions below, or authorize source changes. Stage labels are proposal labels until a workstream starts and receives a roadmap ID under rule 6.

### Governing architecture

- **Strategy ownership:** `corex-strategy-engine` owns Strategy, ctx, indicators, ParamSchema, validation, manifests and the strategy template. It must not own database, network or credentials and must not import `@utils/strategy` or `@core`.
- **Engine composition root:** `engine/` owns routes, jobs/workers, repositories, settings/config services, risk, RuntimeRegistry coordination and `backtestManager` until P7. It orchestrates; it does not duplicate package domain logic.
- **Execution:** `corex-broker-contract` retains BrokerContract, drivers, RuntimeBrokerFactory / `DRIVER_REGISTRY`, BacktestDriver and the shared fill simulation. Execution drivers do not own market data. Strategy, Socket_X and manual orders must ultimately pass through one application-level ExecutionAuthority; no implementation is authorized by this proposal.
- **Market data:** `corex-market-data` owns the data-provider contract/registry, pagination, FileDataProvider and proposed BarSource. It does not own execution, accounts or credential storage.
- **Credentials:** reuse `corex-auth` SecretsVault, `corex-accounts` ConnectionsService and existing config services. No second vault, credential table or configuration framework.
- **Backtest:** keep D7 unchanged. Split `backtestManager` inside `engine/` at P7. Reconsider `corex-backtest` extraction only after P7 is accepted; STAGE-4 remains UNCONFIRMED.
- **Registration:** keep independent data-side and execution-side registries. Reject the cross-domain Integration Catalog. A future Integrations view may be read-only over both registries.
- **Prohibitions and locked rules:** no live-selectable `oanda` or `mt5_bridge`; no new `corex-risk`; no second runtime ledger; no dynamic package/plugin loading; no change to the 5,000 default block size without separate evidence and approval.

### Strategy delivery design (proposed stages; not scheduled)

- **P2 is DONE** (PR #82, merged `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`). It removed StrategyContract from the canonical Strategy path and moved state snapshot / `__corexApi` / symbol normalization into Strategy. No BaseStrategy deletion in P2.
- **P3 and P4 are independent after P2.** P3 is selected and active: it moves the template into the package and repoints authoring scripts; `::demo` cleanup remains gated by D4. P4 repatriates `utils/strategy`, removes mirrors/shims and repoints consumers; D5 remains open and must be inspected. P4 follows P3 in the current delivery order.
- **P5** deletes the remaining legacy strategy path only after P3 and P4; move IncrementalIndicators tests into the package and prove every stored strategy still compiles.
- **P6** follows P5; risk remains engine-owned, D6 backtest risk parity is handled there, and dead pipeline removal requires D1/reference evidence plus a latency benchmark.
- **SH-1** headless StrategyHost (`runBars(strategy, barSource, broker)`) requires a new open decision and P5 completion. SH-2 look-ahead/warmup analyzers follow SH-1. SH-3 manifest conformance and hard caps follow B10 baseline; behavior-changing cap values require Owen approval. Multi-timeframe, indicator snapshot/restore, parity harness and static apiVersion remain deferred.

### Provider delivery design (PV stages; not scheduled)

- **PV-1:** static manifests/conformance for Twelve Data, Yahoo Finance and FileDataProvider; Paper and MetaApi execution entries are metadata-only. No factory behavior or registration change in this stage.
- **PV-2:** credential references `{scope,id}` resolved through existing configService / ConnectionsService; preserve environment fallback. Requires PV-1 and U-5/U-6 inspection.
- **PV-3:** additive per-backtest `dataSource: {providerId, credentialRef?}`, validated before job creation. If omitted, current behavior is unchanged. No change to global active provider.
- **PV-4:** per-runtime live data sessions remain deferred until separate approval of the data-session rule (rows 1, 3 and 8 of Claude's decision table), B4 and U-3. RuntimeRegistry owns handles; no second ledger, no LIVE failover.
- **PV-5:** read-only Integrations view only after PV-1 to PV-3; no config writes or secrets.
- Keep Decision 8's single global default historical provider and 5,000 default pagination block. The additive per-backtest `dataSource` override is approved; per-runtime live sessions are not approved. Manifest-specific `maxBarsPerRequest` metadata may describe provider limits but does not silently change the 5,000 default.

### Backtest delivery design (BT stages; not scheduled)

- **BT-1:** finish B10 read-only discovery, record reproducible performance/resource baseline and golden runs, and document `BacktestSpec`, `BarSource`, `ProgressEvent` and `BacktestResult`. No behavior change or package extraction.
- **BT-2:** P7 split of validation, data acquisition, simulation loop, analytics and persistence into engine-owned modules. Requires BT-1, P5, P6, STAGE-4 confirmation and B1/B2 reconciliation. Preserve fill simulation and golden metrics; coordinate artifact-first / row-last atomic persistence, cancellation and job-owned cleanup.
- **BT-3:** extraction to `corex-backtest` is not staged; it requires a later explicit reversal of D7 after P7 acceptance.

### Contract and lifecycle detail retained from Claude v2

- **Static manifests:** metadata fields are `id`, `version`, `axis` (`data` / `execution`), truthful capabilities, `credentialKeys` and `verified`. Runtime capability conformance must reject a manifest that over-claims implementation behavior. Execution-side manifests are metadata-only until the separate authority workstream.
- **Credential references:** `credentialRef` is `{scope,id}`; system scope resolves through `configService`, account scope through `ConnectionsService`, and user scope is permitted only if U-6 confirms the user-level table is live. Execution credentials are account-scoped only and never fall back to system credentials. BACKTEST receives no execution credential reference. Preserve the environment fallback until each consumer is migrated; no secret values in logs, descriptors or API output.
- **Data-source selection:** explicit backtest `dataSource` must validate provider ID, interval and bar count against the manifest before a job row is created. If omitted, today's result path remains unchanged. Inspect whether the existing 5,000 constant is a block size or total cap (U-4) before any limit change.
- **Live data-session proposal:** if separately approved later, session identity is `(runtimeId, providerId, credential scope)`; RuntimeRegistry owns the handles. A physical connection may be shared only for matching provider and credential, using reference counts. Stop/failure releases handles; B4 status flags reflect data availability; no automatic LIVE failover.
- **Strategy P4/P5 details:** P4 is one PR with two commits: repoint package/base-broker consumers and remove duplicate mirrors/shims, then repoint controller/scripts and remove legacy validator/manifest copies. P5 removes BaseStrategy, IndicatorAdapter, RuleChain, StrategySignalUtils, StrategyDevHelpers, StrategyContract and legacy resolver/security allowances only after P3/P4; migrate IncrementalIndicators tests and prove every stored strategy still compiles.
- **StrategyHost tooling:** SH-1 exposes only `runBars(strategy, barSource, broker)`, with stub-broker contract, golden-fixture parity and determinism tests; no engine import. SH-2 analyzers run as package tooling, never at runtime. SH-3 checks manifest-member conformance and applies caps derived from B10; caps default off until their behavior-changing values are approved.
- **Backtest contracts:** `BacktestSpec` records strategy/version, resolved parameters, dataset/provider reference, costs/slippage and risk settings with a stable idempotency hash. `BarSource` supplies typed chunks with monotonic timestamps, valid OHLC and typed failures. `ProgressEvent` is throttled/coalesced. `BacktestResult` is a compact summary plus artifact references and typed retryable/non-retryable failures.
- **Backtest BT-2 constraints:** split validation, acquisition, simulation, analytics and persistence into engine-owned modules; bound logs and progress, enforce source/memory/execution budgets, cancel at chunk boundaries, and remove only job-owned temporary files. Write artifacts to temporary paths and atomically rename; persist the report row last. No vectorized path, fill-simulation change or live execution access. Keep simulation time independent of wall clock.

### Scheduling and approval gates retained

- Current-checkout validation is recorded in `plans/reports/CLAUDE_V2_CURRENT_CHECKOUT_VALIDATION.md`. On 2026-11-22, P2 / PR #82 and ENGINE-02B-P0-1 / PR #66 were verified merged and reconciled to DONE. STAGE-1 / PR #79 remains OPEN; P3 is the second active workstream. No PV, BT or SH stage is scheduled.
- B11 / PROV-01 is retained as a review placeholder only. Do not create PV/BT/SH task files until the relevant stage actually starts. Working labels are not roadmap IDs; assign real IDs at start.
- P3 was selected and started after P2 completion. P4 remains the next strategy-engine workstream after P3, subject to its dependencies and Owen's approval. STAGE-3 and STAGE-4 status still require Owen confirmation.
- D1, D2, D4, D5, D6, D9 remain open. D3 and D8 remain governed by their existing roadmap entries. D7 stays unchanged. The separate live-session decision, terminal-protocol decision, StrategyHost decision and SH-3 cap values are deferred to their own gates.
- Before any stage starts, verify Claude's snapshot findings against the current dirty checkout, complete the applicable unknowns U-1 to U-12, preserve all pre-existing modifications, and create one bounded task/PR with explicit tests, migration, rollback and stop conditions.

## 5. Open decisions (D1–D9 remain OPEN; proposal approval does not silently close them)

| ID | Question | Recommendation (not approved) | Blocks |
|---|---|---|---|
| D1 | Delete `runPipeline`? | Delete after a reference check. | P6 |
| D2 | `symbols` as `string[]` only? | Yes. | P2 |
| D3 | `generateSignal` alias / dormant `strategyWorker` | If the worker migration is small, migrate it to `onMarketData`; else keep a time-bounded alias. | E5 |
| D4 | `::demo` runtime row | Delete, with Owen's explicit approval (needs before/after counts). | P3 |
| D5 | Owner of `Position` / `StrategyPositionManager` | Keep open; inspect `Strategy.js` and broker usage first. | P4 |
| D6 | Backtest risk parity | Shared risk-decision function with mode-specific context; separate task. | P6 |
| D7 | Backtest simulation package | Defer until after STAGE-4 / P7. | P7 |
| D8 | Owner of the strategy template | The strategy package. | P3 |
| D9 | Single warmup owner | Decide in E5. | E5 |

## 6. Backlog (side PRs, not phase work)

| ID | Title | Status | Notes |
|---|---|---|---|
| B1 | Backtest report filename safety | NEXT (work exists uncommitted) | Shared `safeFilename` helper used by the writer **and** the `backtestController` readers in the same change; reconcile with the P0 `_saveToFile` already on `main`; split the `_computeAnalytics` additions out. Present only in the Stage 1 dirty tree (`engine/backtestManager.js`, `engine/routes/backtestController.js`, `engine/services/userScope.js`); `safeFilename` does not exist on `main`. |
| B2 | `jobWorker.isNonRetryableError` | NEXT (work exists uncommitted) | Present only in the dirty tree (`engine/workers/jobWorker.js`, `test/job-worker-non-retryable.test.js`); not on `main`. |
| B4 | Runtime status flags (`marketDataAvailable` / `warmedUp` / `coldStart`) + stale reconciliation on restore | NEXT (work exists uncommitted) | Re-implement on Stage 2 code using the backup patch as the spec: `engine/core/runtime/RuntimeLifecycle.js`, `engine/core/runtime/RuntimeRegistry.js`, `engine/strategyLoader.js`. The dirty-tree versions are against pre-Stage-2 files and will not apply. |
| B5 | Ignore `repomix.xml` (2 copies) and `data/uploads/**` | NEXT | `main`'s `.gitignore` has only `repomix-output.xml`. Untracked artefacts: `repomix.xml`, `engine/core/repomix.xml`, `data/uploads/**`. |
| B9 | Stop-during-own-stop race in engine recovery (`B6`-`B8` unallocated) | IN PROGRESS — `fix/recovery-stop-request-marker` | A stop request for a strategy that lands while `_attemptRecovery` is awaiting `loader.stopStrategy()` — with the runtime already removed and no ledger record left — is indistinguishable from "nothing to stop", so the recovery still restarts the runtime. Needs a loader-boundary stop-request marker that survives the stop. Risk is highest in LIVE mode (an unintended restart of a live runtime). Found in P0-1 and documented as a limitation in `plans/tasks/ENGINE-02B-P0-1.md` §12.5; no code for it in P0-1. |
| B10 | Backtest pipeline discovery, performance/resource audit and implementation handoff | NEXT — READ-ONLY DISCOVERY | `plans/architecture/BACKTEST_PIPELINE_DISCOVERY_AND_HANDOFF.md` | Trace upload → dataset → job → worker → simulation → analytics/report → retrieval/cleanup. Record ownership, contracts, confirmed defects, unused/duplicated features and reproducible CPU/memory/storage baselines. No source changes, no task-file creation and no new active workstream. Findings inform STAGE-4/P7; P7 dependencies remain unchanged. |
| B11 / PROV-01 | Strategy, provider and backtest architecture planning baseline (Claude v2) | REVIEW ONLY — NOT SCHEDULED; NOT APPROVED | Review placeholder only; no executable task file until a workstream starts | Owen approved the complete Claude `Refined proposal v2.md` on 2026-11-22 as the planning baseline, including its architecture boundaries, corrections, dependencies, stage definitions and exclusions. This approval does not schedule PV/BT/SH stages or authorize implementation. Keep the two-workstream limit and rule 6. Keep D7, L4, L5, L9, the 5,000 default and the OANDA/`mt5_bridge` prohibition. Approvals recorded in `plans/decisions.md`; unresolved choices and unknowns remain explicit below. `PROV-01` remains a review placeholder, not an executable task. |
| SEC-01 | Strategy execution isolation and shared-intrinsic protection | NEEDS TRIAGE — NOT SCHEDULED | Strategy source runs through `vm.compileFunction()` in the engine process's current global context. P1 protects its own inspection intrinsics and B3 restricts the injected CommonJS `require` channel, but neither isolates execution. Reproduced on Node v22.20.0: `Object["con" + "structor"]("return process.getBuiltinModule('fs')")()` passes the scanner and obtains `fs`, bypassing the resolver without using `require`. Requires a separate threat model and reviewed execution-isolation design; do not treat P1 or B3 as a sandbox. |
| SEC-02 | Strategy module-resolution and AST-scanner bypasses | DONE — B3 merged 2026-11-21 | B3 replaces the injected CommonJS `require` channel with an exact resolver and scanner checks. The merge does not provide process isolation; process-global execution escapes remain SEC-01. Evidence and acceptance tests are in `plans/tasks/B3-sandbox-module-resolution.md`. |
| SEC-03 | Strategy worker bypasses AST security validation | NEEDS TRIAGE — NOT SCHEDULED | `engine/workers/strategyWorker.js` calls `StrategyCompiler.compile()` directly in `LOAD_STRATEGY` without `validateStrategyCode()`. `workerPool.isEnabled()` defaults to enabled in production unless explicitly overridden, and `engine/modules/strategyRuntime/index.js` routes `LOAD_STRATEGY` through it. This skips AST checks outside module resolution; B3's runtime resolver does not cover those rules. Separate task required; evidence in `plans/KNOWN_ISSUES.md` §11. |

### P0 findings from `plans/Audit/BASELINE.md` (backlog, unfixed)

| ID | Finding | Evidence |
|---|---|---|
| F-1 | `MarketFeed` dispatch timeout does not cancel the losing call, so bars can overlap (a slow tick is accounted as a strategy crash). | `plans/Audit/BASELINE.md` B3/B4; `MarketFeed._feedRuntime` |
| F-2 | Warmup sets `strategy._warmedUp = true` even when a bar threw and the loop `break`-ed, and when the strategy has neither `onBar` nor `onTick`. | `plans/Audit/BASELINE.md` C4; `engine/core/engine.js:542-565` |
| F-3 | `_saveToDatabase` throws `BACKTEST_DB_REQUIRED` when no DB is configured **after** the report file has been written, so `run()` rejects even though a report exists. | `plans/Audit/BASELINE.md` A5; `engine/backtestManager.js`, `engine/routes/backtestController.js` |

### Found untracked, undecided

| Item | Disposition |
|---|---|
| `plans/architecture/QUALITY_BASELINE.md` | Found untracked in the Stage 1 worktree (P0-06 output). **Not added** by the consolidation PR; needs Owen's decision on whether P0-06 is still wanted. |

## 7. How to update this file

1. **Claim a row** — set status `IN PROGRESS`, record branch and PR, and create the task file under
   `plans/tasks/` if it does not exist. Update `plans/STATUS.md` only if it is still the dashboard of record.
2. **Before implementation** — confirm the row's dependencies are `DONE` or merged, and that no more
   than two workstreams are open (rule 3). If a dependency is missing, stop.
3. **During** — record evidence (commands, results, limitations) in the task file, not in this table.
4. **Completion** — a task is complete only with acceptance evidence and review. Set status `DONE`,
   record the merge SHA, and check that the PR that completes the workstream updated this row in the
   same PR (rule 4).
5. **Blocked** — use `BLOCKED`, name the blocker in Notes, and add an entry to `plans/KNOWN_ISSUES.md`.
6. **New idea** — it goes to Backlog or an open decision (D-series) first. It does not enter the
   sequence until Owen approves it and this table says so.
7. **Status vocabulary** — `DONE`, `IN PROGRESS`, `NEXT`, `LATER`, `BLOCKED`, `UNCONFIRMED` only.
8. **Supersession** — when a document is superseded, move it to `plans/archive/` with the header
   `ARCHIVED <date> — superseded by <path>. Content below is unchanged.` and update this file's
   references. Never edit the archived body.