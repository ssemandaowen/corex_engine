# CoreX Strategy, Backtest and Provider Design — Consolidated Review Baseline

> **Status:** SUPERSEDED — RETAINED FOR HISTORY; use Claude `Refined proposal v2.md` and the approved baseline recorded in `plans/ROADMAP.md` / `plans/decisions.md`.  
> **Date:** 2026-11-22  
> **Superseded by:** Owen's approval of the complete Claude `Refined proposal v2.md` on 2026-11-22.  
> **Existing architecture anchor:** `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`.  
> **Authority:** This earlier assistant consolidation is not the controlling design and must not override Claude v2 or the approved roadmap dispositions.

## 1. Purpose and source discipline

This document places Claude's three-part proposal into the current CoreX planning context so Claude can refine it into bounded implementation scope.

The source proposal explicitly distinguishes:
- **EVIDENCE** — statements Claude says it derived from the uploaded repomix snapshot or repository plans.
- **PROPOSAL** — Claude's recommendations, not existing decisions.

That distinction must remain visible. This consolidation does not independently verify every source-code claim in Claude's snapshot. It does not convert a proposal into a locked decision.

### Source hierarchy for this review

1. **Claude's uploaded proposal** is the primary design input for this refinement.
2. **The current repository decision log and active roadmap** remain authoritative for locked decisions, workstream order, dependencies and approval.
3. **The existing Socket_X / market-data / execution proposal** remains the architecture anchor; Claude's proposal should extend and reconcile with it, not replace it.
4. The earlier provider-only reconciliation note, `PROVIDER_INTEGRATION_ARCHITECTURE_RECONCILIATION.md`, is prior assistant-generated analysis. Its recommendations are not user-approved decisions and must not silently override Claude's proposal or the repository's locked decisions. In particular, its “single central Integration Catalog” formulation is not assumed here; Claude's proposal instead describes the data-side `ProviderRegistry` and the existing execution-side `DRIVER_REGISTRY` pattern.

## 2. Claude proposal — consolidated design

### 2.1 Strategy engine

**Claude's repository findings (to be re-verified against the current working tree):**
- Several legacy strategy utility files reportedly duplicate package-owned implementations; several others are shims.
- `StrategyValidator` and `StrategyManifest` reportedly diverged between legacy and package locations.
- `corex-strategy-engine` reportedly retains imports from legacy utility paths and a `StrategyContract.adapt()` call.
- Claude lists remaining consumers in broker, controller, scripts, compiler, loader and backtest paths.

**Claude's proposed cleanup order:**
1. **P2:** Make `Strategy` own state snapshot, `__corexApi` and symbol normalization; remove its `StrategyContract` import. Gate: class identity across compiler, loader and backtest.
2. **P4a:** Repoint package leaks and `BaseBroker` to package-owned copies; remove duplicate mirrors and shims.
3. **P4b:** Repoint controller and scripts to package manifest/validator; remove legacy utility versions.
4. **P3:** Move the template into the package and clean up `::demo` under the existing decision/approval rules.
5. **P5:** Delete the remaining legacy strategy path and move the incremental-indicator test into the package.
6. **P8:** Enforce package boundaries in CI.

Claude notes that the order must respect the active workstream limit and existing dependencies. The exact ordering must be reconciled with the active roadmap before it is scheduled.

**Claude's proposed package strengthening, in suggested priority order:**
- Headless `StrategyHost` / `runBars(strategy, barSource, broker)` seam.
- Look-ahead and warmup-dependence analyzers.
- Multi-timeframe consolidators using closed higher-timeframe bars.
- Manifest-versus-runtime conformance tests.
- Hard limits for indicator count and total warmup.
- Backtest/Paper/Live parity harness.
- Indicator snapshot and restore.
- Static API version and an explicit migration script, without a runtime legacy adapter.

Claude identifies strategy process isolation and worker AST-validation bypass as security gaps outside the strategy package's own reach. These remain separate security work, not solved by package cleanup.

### 2.2 Backtest engine

**Claude's current-state findings (to be re-verified):**
- `engine/backtestManager.js` combines validation, compilation, data loading, simulation loop, analytics and persistence.
- The current path reportedly copies bar objects, collects unbounded logs, patches `strategy.log` on a shared instance, and writes a report file before the database row; the latter is associated with roadmap finding F-3.
- The B10 discovery document contains additional leads that must be verified rather than treated as confirmed defects.

**Claude's proposed target:**
- A pure backtest domain with a Runner, SimulationLoop, accumulators and ReportBuilder.
- A headless strategy host from `corex-strategy-engine`.
- A deterministic simulation path through the broker-contract backtest driver and shared fill simulation.
- A `BarSource` contract supplied by file datasets and provider historical data.
- Engine-owned jobs, repositories and storage orchestration remain outside the pure package.

**Proposed contracts:**
- `BacktestSpec`: strategy/version, resolved parameters, dataset or provider reference, costs/slippage and risk settings; stable hash for idempotency.
- `BarSource`: async chunks of typed arrays, monotonic timestamps and valid OHLC guarantees, with typed failures.
- `ProgressEvent`: throttled/coalesced rather than emitted per bar.
- `BacktestResult`: compact summary plus artifact references and typed retryable/non-retryable failures.

**Proposed resilience and correctness:**
- Validate source data before simulation and enforce memory budgets.
- Enforce per-bar and total execution budgets, while acknowledging that true hostile-code isolation is a separate security requirement.
- Cancel at chunk boundaries and only remove job-owned temporary files.
- Write artifacts to temporary paths, atomically rename, and persist the report row last.
- Keep simulation time independent of wall-clock time.
- Bound logs and coalesce progress.
- Make BACKTEST incapable of accessing live execution credentials or live order endpoints.
- Preserve deterministic run specifications and golden-run regression tests.

**Package decision is not settled:** Claude's target diagram shows a new `corex-backtest` package, but the existing decision log's D7 defers that package until the dataset resource stage / P7 decision. Claude explicitly asks whether to reverse D7. No package extraction is approved by this draft.

### 2.3 Provider integrations

**Claude's proposed model: two independent capability axes.**
- **Data:** historical bars, streaming ticks, symbol search and related data operations.
- **Execution:** account information, positions, order placement and management.
- One integration may provide either axis or both; category labels are descriptive rather than mutually exclusive types.

**Registration and manifests:**
- Data-side registration uses a `ProviderRegistry` in `corex-market-data`.
- Execution-side registration follows the existing `DRIVER_REGISTRY` pattern.
- Manifests are static and declarative initially; arbitrary dynamic package discovery/loading is deferred.
- Manifest metadata covers identity/version, axes, capabilities, limits, credential requirements/scopes and verified capabilities.
- Existing runtime `getCapabilities()` and implementation validation are extended so claimed capabilities are checked against actual behavior.
- Capability resolution should remain a small function over manifest data, not a new subsystem.

**Selection and lifecycle:**
- Selection is explicit per runtime or backtest; automatic failover is initially disabled.
- Claude proposes replacing global active-provider selection with per-runtime data sessions.
- Data sessions are lazy, health-checked, bounded in reconnect behavior and cleaned up with their owning runtime.
- `RuntimeRegistry` remains the single runtime owner; do not create a second lifecycle ledger.
- Provider-specific history limits, quotas, intervals, symbol coverage and subscription limits are surfaced as capabilities rather than hardcoded global assumptions.

**Credential handling:**
- Claude proposes system, user and account ownership scopes.
- Execution credentials are account-scoped and never fall back to a system credential.
- Data credentials may fall back from user to system only under an explicit administrative policy.
- Replace process-global environment mutation with credential references resolved when a session is created.
- Reuse `SecretsVault`; do not create a second vault.
- BACKTEST receives no execution credential reference.

**Admin experience:**
- An Integrations view is derived from registered manifests and runtime status.
- It distinguishes declared from verified capabilities, configured state, credential requirements, health, last connection test and selectable operations.
- An unverified capability must not be represented as usable.

### 2.4 Cross-track seams

Claude connects the three designs through four seams:
1. `StrategyHost`: strategy execution driven by backtest or runtime hosts.
2. `BarSource`: common historical data contract for files and provider history.
3. Capability manifests: validate source selection and supported operations.
4. `credentialRef`: resolve protected secrets into the session that needs them.

The existing Socket_X architecture adds a further invariant: strategy, Socket_X and manual execution requests must still pass through one application-level execution authority. Provider work must not create a second order-routing or risk authority.

## 3. Conflicts and dependencies that must be resolved

These are repository reconciliation items, not decisions made by this document.

| Area | Existing repository record | Claude proposal / tension | Required treatment |
|---|---|---|---|
| Active data provider | `plans/decisions.md` (2026-08-20) records one active historical provider at a time and a 5,000-candle pagination convention. | Claude proposes per-runtime sessions and capability-derived limits; the Nov 14 Socket_X proposal says no global active provider. | Treat as a real decision conflict. Confirm which decision supersedes the older locked record and define migration/test gates before changing behavior. |
| Same-symbol concurrency | The 2026-08-20 decision log records same-symbol driver exclusivity at session creation. | Per-runtime/per-subscription data sessions may permit concurrent providers/sessions. | Define exact uniqueness and sharing rules; do not infer concurrency semantics from the phrase “per-runtime”. |
| OANDA / MT5 bridge | The 2026-08-28 decision log says `oanda` and `mt5_bridge` must not be re-added as live-selectable connector types. It also records MT5 bridge as having no real instantiation in the then-current live path. | Claude lists OANDA and MT5 terminal/EA as possible data or execution capabilities if adopted and verified. | Preserve the prohibition. Distinguish a future Socket_X-connected local MT5 terminal protocol from reintroducing the prohibited `mt5_bridge` connector. OANDA is not in scope unless Owen explicitly changes the prior decision. |
| Runtime ownership | Roadmap L9 makes `RuntimeRegistry` the single authoritative runtime owner. | Claude proposes sessions owned by RuntimeRegistry. | Compatible in principle; define session ownership/cleanup without a second runtime ledger. |
| Backtest package | Existing decision D7 defers a separate backtest simulation package until after STAGE-4 / P7. STAGE-4 is marked UNCONFIRMED in the roadmap. | Claude's diagram proposes `corex-backtest` and asks whether to reverse D7. | Keep D7 unchanged until Owen decides. Verify B10 and STAGE-4 status first. |
| Risk ownership | Roadmap L5 says risk logic stays in the engine; no standalone `corex-risk` package. | Claude proposes shared risk-decision behavior and parity across modes. | Keep the authoritative risk owner in the engine unless Owen changes L5. Shared behavior does not imply a new package. |
| Configuration | Roadmap L4 prohibits a new configuration framework. | Claude proposes manifests, credential references and integration settings. | Implement through existing settings/config services; manifests are metadata/contracts, not a replacement configuration framework. |
| Strategy ordering | Active roadmap P2 is strategy-contract retirement; P3 precedes P4 and P5 in the current sequence. | Claude's proposed ordered cleanup places P4a/P4b before P3. | Reconcile dependencies and roadmap order; do not alter the active P2 task or reorder roadmap rows in this draft. |
| Workstream capacity | Roadmap rule 3 allows at most two open phase workstreams; P2 and ENGINE-02B-P0-1 are currently marked IN PROGRESS. | Claude says provider PROV-0 docs can start now, with PROV-1 onward after P5. | Keep provider work as review material only until roadmap scheduling and capacity are explicitly resolved. |
| Task-file policy | Roadmap rule 6 says no new task file is created until a workstream starts. | A prior provider-only draft created a PROV-01 placeholder. | Treat it as a review placeholder, not an active task or authorization. Reconcile it before scheduling; do not create PROV-02+ task files yet. |
| Socket_X / execution | Existing Socket_X proposal requires one application-level ExecutionAuthority and transport-only Socket_X. | Claude's provider proposal reuses broker execution drivers and runtime sessions. | Provider manifests and drivers must remain subordinate to the common authority; no direct provider-to-strategy order routing. |

## 4. Review questions for Claude

Claude should refine the proposal against the repository records above and answer each item with evidence, recommendation and exact change to the design. Do not silently resolve a locked decision.

1. **Source freshness:** Which of the strategy and backtest findings still hold on the current main branch and dirty working tree? Separate verified facts, stale snapshot findings and assumptions.
2. **Strategy sequence:** Reconcile P2/P3/P4/P5 ordering with the current roadmap, dependencies and the already active P2 strategy-contract task. Identify any step that is redundant or already complete.
3. **StrategyHost boundary:** Define the smallest public contract required by backtest and live runtime. Identify what belongs in strategy-engine versus the engine composition root.
4. **Backtest ownership:** Explain how `BarSource`, `BacktestSpec`, replay clock, simulation, accumulators and persistence map to current packages and STAGE-4/P7. State whether D7 should remain or be changed, with evidence.
5. **Provider registration:** Confirm why data and execution should retain separate registration owners rather than a new cross-domain catalog. Specify the manifest fields and versioning needed for current providers only.
6. **Provider compatibility:** Reconcile the August single-active-provider and 5,000-bar decisions with the November no-global-active-provider proposal. State the exact compatibility, concurrency and cleanup rules required before per-runtime sessions.
7. **Provider scope:** Reconcile OANDA and MT5 wording with the explicit 2026-08-28 prohibition. Do not re-add either as a live-selectable connector by implication. Distinguish a new Socket_X terminal protocol from the retired bridge connector.
8. **Credential security:** Trace every current credential write and consumer, verify SecretsVault persistence/encryption paths without exposing secret values, and define credentialRef ownership and resolution boundaries.
9. **Runtime lifecycle:** Define how RuntimeRegistry owns session lifecycle, failure cleanup, reconnect and health without a second registry or ledger.
10. **Execution authority:** Show how all strategy, Socket_X and manual execution requests still pass through the one authority in the existing Socket_X proposal.
11. **Storage and atomicity:** Reconcile the report-file/database ordering proposal with current report persistence, B10 findings and existing job lifecycle.
12. **Delivery sequence:** Produce a bounded sequence with prerequisites, changed-file boundaries, tests, migration constraints, rollback/safety notes and explicit stop conditions. Respect the active roadmap and workstream limit.

## 5. Candidate delivery shape for refinement (not scheduled)

This is a discussion structure drawn from Claude's proposal, not a roadmap update:

- **Design reconciliation:** resolve conflicts and record only Owen-approved decisions.
- **Strategy cleanup:** follow the authoritative P2/P3/P4/P5 roadmap after dependency review.
- **Provider foundation:** static manifests and contract/conformance work, reusing existing data and execution owners.
- **Provider sessions and credentials:** only after credential inventory, explicit selection semantics and concurrency rules are approved.
- **Backtest seam and engine separation:** only after B10, STAGE-4 status and D7/P7 ownership are resolved.
- **Admin visibility and end-to-end verification:** after the underlying contracts and lifecycle are stable.

Each implementation stage must be a separate bounded task/PR when scheduled. Do not combine all three tracks into one implementation change.

## 6. Scope and safety boundaries

Until Claude's refinement is reviewed and Owen approves the resulting scope:
- No application source edits for these proposed features.
- No schema or migration changes.
- No package extraction or dependency changes.
- No reintroduction of OANDA or `mt5_bridge` as live-selectable connectors.
- No dynamic plugin/package loading.
- No changes to the active strategy P2 task, locked decisions or roadmap ordering.
- No changes to live execution, risk routing or Socket_X authority.
- No staging, commit, push, merge or branch creation.
- Preserve every existing uncommitted working-tree change.

## 7. Reference documents

- `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`
- `plans/architecture/BACKTEST_PIPELINE_DISCOVERY_AND_HANDOFF.md`
- `plans/architecture/PROVIDER_INTEGRATION_ARCHITECTURE_RECONCILIATION.md` (prior assistant-generated provider-only notes; not an approved baseline)
- `plans/tasks/P2-strategy-contract-retirement.md`
- `plans/tasks/PROV-01-provider-discoverability-and-runtime-config.md` (bounded B11 implementation task; per-runtime sessions remain deferred)
- `plans/ROADMAP.md`
- `plans/decisions.md`
- `plans/KNOWN_ISSUES.md`
