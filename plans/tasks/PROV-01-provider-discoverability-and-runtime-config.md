# B11 / PROV-01 — Review Placeholder (Claude v2 Planning Baseline)

> **REVIEW ONLY — NOT SCHEDULED; NOT APPROVED.**
> This file is a roadmap-linked placeholder, not an executable implementation task. Owen approved Claude's complete `Refined proposal v2.md` on 2026-11-22 as the planning baseline. That approval adopts the design recommendations but does not schedule PV stages, authorize implementation, or waive their prerequisites.

**Owner / approval authority:** Owen Ssemanda  
**Status:** REVIEW ONLY — NOT SCHEDULED; NOT APPROVED  
**Current source:** Claude, `Refined proposal v2.md`, 2026-11-22  
**Roadmap row:** B11 / PROV-01  
**Architecture anchor:** `plans/architecture/MARKET_DATA_EXECUTION_SOCKETX_BACKTEST_PROPOSAL.md`  
**Approval record:** `plans/decisions.md` — Claude v2 adoption entry  
**Current task policy:** Roadmap rules 3 and 6; create a stage task only when that stage starts.

## 1. Purpose

Track the approved cross-domain strategy, provider and backtest design baseline from Claude v2. This placeholder exists for traceability only. It does not replace the active roadmap, create a new workstream, or assign implementation work.

## 2. Approved architecture baseline

- `corex-strategy-engine` owns strategy domain logic, including Strategy, ctx, indicators, ParamSchema, validation, manifests and the strategy template. No database, network, credentials, `@utils/strategy` or `@core` imports.
- `engine/` remains the composition root for routes, jobs/workers, repositories, settings/config, risk, RuntimeRegistry coordination and `backtestManager` through P7.
- `corex-broker-contract` owns broker contracts, drivers, RuntimeBrokerFactory / `DRIVER_REGISTRY`, BacktestDriver and shared fill simulation. Execution does not own market data.
- `corex-market-data` owns data-provider contracts/registry, pagination, FileDataProvider and the proposed BarSource contract.
- Keep separate data and execution registries. Reject a cross-domain Integration Catalog. A future Integrations view may be read-only across both.
- Reuse SecretsVault, ConnectionsService and existing config services. No second vault, new credential tables or configuration framework.
- Keep D7: no separate `corex-backtest` package before P7 is accepted. Backtest separation initially stays inside `engine/`.
- Keep risk in the engine, RuntimeRegistry as the only runtime owner, and the permanent prohibition on `oanda` and `mt5_bridge` as live-selectable connector types.

## 3. Approved delivery design — stages are not scheduled

### Strategy
- P2 is DONE (PR #82 merged `f71fdfcfd7f2241c1d7ac337caff7916e7523c9b`).
- Owen selected P3 followed by P4. P3 owns the package template and authoring scripts; `::demo` deletion remains gated by D4. P4 repatriates `utils/strategy`, removes mirrors/shims and repoints consumers; D5 must be inspected first.
- P5 follows both P3 and P4; delete the remaining legacy strategy path and move the IncrementalIndicators tests into the package.
- P6 follows P5; risk remains engine-owned, D6 parity is handled there, and pipeline removal requires D1/reference evidence plus a latency benchmark.
- SH-1 StrategyHost requires a new open decision and P5. SH-2 analyzers follow SH-1. SH-3 conformance and hard caps use B10 baseline; behavior-changing caps need explicit approval. Other advanced strategy enhancements remain deferred.

### Providers — data side and execution side stay separate
- PV-1 static manifests/conformance for Twelve Data, Yahoo Finance and FileDataProvider; Paper and MetaApi execution entries are metadata-only. No registration behavior change.
- PV-2 credential references resolve through existing configService / ConnectionsService; preserve environment fallback. Requires PV-1 and U-5/U-6 inspection.
- PV-3 additive per-backtest `dataSource: {providerId, credentialRef?}`, validated before job creation; omission preserves current behavior.
- PV-4 per-runtime live sessions remain deferred pending separate approval of data-session semantics, B4 and U-3. RuntimeRegistry owns session handles; no second ledger and no LIVE failover.
- PV-5 read-only Integrations view follows PV-1 to PV-3; no config writes or secrets.
- Preserve Decision 8's single global default historical provider and 5,000 default pagination block. The additive per-backtest `dataSource` override is approved; it does not authorize per-runtime live sessions or change the 5,000 default.

### Backtest
- BT-1 completes B10 read-only discovery, records reproducible resource/performance baselines and golden runs, and documents BacktestSpec, BarSource, ProgressEvent and BacktestResult. No behavior change or package extraction.
- BT-2 splits validation, data acquisition, simulation, analytics and persistence into engine-owned modules at P7. Requires BT-1, P5, P6, STAGE-4 confirmation and B1/B2 reconciliation. Preserve shared fill simulation and golden metrics.
- BT-3 package extraction is not staged; it requires an explicit later reversal of D7 after P7 acceptance.

## 4. Explicitly retained constraints and gates

- No more than two open phase workstreams. Claude v2 identifies P2 and ENGINE-02B-P0-1 as active; the roadmap also still shows STAGE-1 / PR #79 as IN PROGRESS / OPEN. Reconcile that apparent third open phase row against current GitHub status before assigning any new slot.
- No PV, BT or SH stage is scheduled. Do not create stage task files until a stage starts. Working labels are not roadmap IDs; assign IDs at start.
- The next available workstream slot is not assigned. P3 versus P4 order remains Owen's choice.
- STAGE-3 and STAGE-4 require Owen confirmation. STAGE-4 remains a prerequisite for BT-2 / P7.
- D1, D2, D4, D5, D6 and D9 remain open; D3 and D8 retain their existing roadmap treatment. D7 stays unchanged.
- Per-runtime live data sessions, any MT5 terminal transport protocol, StrategyHost, and SH-3 behavior-changing cap values each require their own explicit gate.
- Claude's evidence was based on the 2026-11-21 repomix snapshot. Verify U-1 through U-12 against the current checkout before scheduling relevant work; do not treat snapshot claims as current facts without verification.
- Preserve all dirty working-tree changes. No source edits, migrations, staging, commits, pushes, merges, rebases, resets, stash operations or branch creation are authorized by this placeholder.

## 5. Next action

Keep this file as a review placeholder. When a relevant stage receives an available workstream slot and all prerequisites/decisions are satisfied, create a fresh bounded task file for that stage under roadmap rule 6. Do not execute this placeholder or use it as a Kilo Code handoff.
