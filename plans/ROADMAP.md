# CoreX — Active Roadmap

> Single active roadmap. Last updated: 2026-11-23
> Owner: Owen Ssemanda (Apex Trait Ltd.) — approval authority
> Scope: phase order, task IDs, dependencies, status, approval gates
> Status dashboard of record: this file. `plans/STATUS.md` is superseded (banner only, history).
> Historical roadmap: `plans/COREX_DEVELOPMENT_PLAN.md` (banner only; do not update).
> Workflow rules: `plans/AGENT_WORKFLOW.md`. Decisions: `plans/decisions.md`. Issues: `plans/KNOWN_ISSUES.md`.

This P2 integration PR is based on `origin/main` at `1f39d1fd87cba7d2b569c4120ddf16400b11878a` (2026-11-21). It reconciles the merged B3 prerequisite and records P2 PR #82. Other roadmap rows are unchanged from the 2026-11-20 snapshot and must be reconciled before assigning additional work.

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
| 1 | STAGE-1 | Dataset upload multipart fix with a genuine regression test | IN PROGRESS | — | `fix/upload-multipart-transport` / PR #58 (OPEN) | task file created when the workstream starts | Verified: PR #58 head `b7cf6116d7f751410f815ab8bd3ced1f6311eb2b`, base `main`, 3 files (`front_end/src/api/client.ts`, `test/multipart-upload-fix.test.js`, `package.json`). **The fix is not yet covered by a genuine test:** `test/multipart-upload-fix.test.js` never imports `client.ts`, re-implements the interceptor inline, and its third test asserts the broken behaviour as expected — verified by reverting `client.ts` in a scratch worktree (3/3 still pass). **Decision (Owen):** a genuine test imports the REAL axios instance exported by `client.ts` (stub adapter); extract a module only if importing `client.ts` proves infeasible. Plan: new PR from `main` containing only the `client.ts` fix + that test; then close PR #58 as superseded (no force-push; leave its branch). #58's branch carries the divergent `7401e35` commit. |
| 2 | ROADMAP | Consolidate plans into this single roadmap | DONE | — | PR #64 | — | Merged as `20bad625434dcbefcd7bea2a5d389ff887159d82`; this document is the active roadmap. |
| 3 | E1 | `engine.js` caller inventory and ownership mapping — **INVENTORY ONLY** | DONE | ROADMAP reviewed | `docs/engine-e1-final-report` | `plans/tasks/ENGINE-02B-E1.md` | **Complete — report: `plans/Audit/ENGINE-02B_E1_engine_inventory.md`** (all seven questions answered, 26 CONFIRMED / 4 INFERRED / 3 UNKNOWN, eight prior findings re-verified). It does NOT repoint any caller; repointing happens inside E2–E4 (and E5), each PR moving only its own methods and separately approved. Implementation handoff is **proposed work, not approved**: four P0 correctness defects (recovery result check, recovery identity space, `stop()` leaves runtimes/timers/listeners, listener leak per restart), three P1 extractions that map to E2/E3/E4, and one P1 blocked on a product decision (warmup cache revive-vs-delete). |
| 4 | P1 | Instance-safety guard (`assertSafeInstance` in `corex-strategy-engine`) | DONE | STAGE-1 PR opened (#79) | `fix/strategy-instance-safety-guard` / PR #80 (MERGED) | `plans/tasks/P1-instance-safety-guard.md` | Accepted by Owen and squash-merged 2026-11-20 as `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`. Verification: package 12 suites / 125 tests; root compiler + loader/recovery 2 suites / 17 tests. Post-construction integrity guard only, not a sandbox. P2 is now active following the B3 merge; see PR #82. |
| 5 | B3 | Strategy module-resolution boundary + exact strategy-module allow-list | DONE | P1 (DONE, PR #80); Stage 2 (DONE, PR #63) | `fix/security-corex-strategy-engine` / PR #57 (MERGED 2026-11-21) | Merged into `main` as `1f39d1fd87cba7d2b569c4120ddf16400b11878a`. Full repository verification at merge: 67 suites / 766 tests passed. B3 restricts the injected CommonJS `require` channel only; SEC-01 execution isolation remains separate. |
| 6 | P2 | Retire `StrategyContract`; move `getStateSnapshot`, `__corexApi`, symbol normalization into the `Strategy` base class | IN PROGRESS | P1 DONE; B3 DONE (PR #57) | `fix/p2-strategy-contract-retirement` / PR #82 (OPEN — DRAFT) | `plans/tasks/P2-strategy-contract-retirement.md` | Isolated from clean `origin/main`; compiler, loader, backtest and executionController API handoff are covered. Verification: 68 suites / 773 tests passed. Awaiting review; do not mark DONE until merge. |
| 7a | E2 | `StrategySupervisor` extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | Fixes the `STATE_CHANGED` listener leak and recovery timers that survive `stop()`. |
| 7b | E3 | Banner + wiring extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | Wiring stays at construction time. |
| 7c | E4 | Telemetry extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | E2/E3/E4 are parallel-safe with P-phases subject to rule 3. |
| 8 | P3 | Authoring surface: template into the package, scripts, `::demo` + orphan runtime row cleanup | LATER | P2 | task file created when the workstream starts | task file created when the workstream starts | The `::demo` cleanup is a reviewed one-off script with before/after counts and explicit approval (D4). |
| 9 | P4 | Repatriate `utils/strategy` | LATER | P2 | task file created when the workstream starts | task file created when the workstream starts | Diff duplicate pairs first; owner question is D5 (open). |
| 10 | P5 | Delete legacy (`BaseStrategy`, legacy `utils/strategy`, security allowance) | LATER | P3, P4 | task file created when the workstream starts | task file created when the workstream starts | The `IncrementalIndicators` test MIGRATES to the package; it is not deleted. |
| 11 | E5 | Warmup consolidation into one owner (`engine.warmupStrategy` vs `RuntimeLifecycle._warmup`) | LATER | P5, D3, D9 | task file created when the workstream starts | task file created when the workstream starts | D9 decides the single owner. |
| 12 | P6 | Risk single-source + dead pipeline removal | LATER | P5 | task file created when the workstream starts | task file created when the workstream starts | D1, D6. A latency benchmark is required as evidence. |
| 13 | STAGE-3 | Stage 3 — WebSocket stage | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Status is not confirmed in any repository record. Owen to confirm before this row is scheduled. |
| 14 | STAGE-4 | Stage 4 — Dataset resource model | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Blocks the data-acquisition part of the `backtestManager` split (P7). |
| 15 | P7 | Recomposition: `backtestManager` responsibilities and `StrategyLoader` facade collapse into `engine/strategyLoader.js` | LATER | P5, P6, STAGE-4 | task file created when the workstream starts | task file created when the workstream starts | ENGINE-03 implementation half; derived from the E1 register (L7). Backtest-domain extraction is now tracked separately under BT-1/BT-2; re-scope P7 before it starts to prevent a duplicate `backtestManager` split. P7 retains its P5/P6/STAGE-4 dependencies. |
| 16 | P8 | Boundary enforcement (`madge` / `dependency-cruiser` rules) | LATER | P5, P6 | task file created when the workstream starts | task file created when the workstream starts | Rule set derived from P7's register. |
| 17 | ENGINE-02B-P0-1 | Recovery correctness: exact runtime target, `result.ok` check, attempt counter across recovery's own `STOPPED` | IN PROGRESS | E1 (DONE, `467e79c`) | `fix/engine-recovery-correctness` | `plans/tasks/ENGINE-02B-P0-1.md` | Fixes E1 report §10 P0-1 + P0-2 (D1 result handling, D2 identity, D3 hidden retry drop). No extraction, no shutdown or listener-lifecycle change. P0-2..P0-4 are not yet represented as rows. |
| 18 | P0-03 | Frontend architecture, performance and behavior audit — inventory only | LATER | Current frontend baseline verified | task file created when the workstream starts | `plans/tasks/P0-03-frontend-architecture.md` | Existing READY audit specification. Not an active workstream yet; starts only when one of the two current workstreams closes. Must map data/state/API/WS ownership, inactive-view work, polling, render pressure, bundle loading, charts, UI states and measured resource baselines. No implementation in the audit. |
| BT-0c | Golden-run harness and deterministic reference runs | NEXT | BT-0a and BT-0b (reported complete) | task file created when the workstream starts | task file created when the workstream starts | ChatGPT lane. Read-only baseline work: pin strategy-engine revision, define controlled fixture/config, record reproducible outputs and limitations. No package implementation. |
| BT-0R | BT-0 evidence review and baseline reconciliation | LATER | BT-0a, BT-0b, BT-0c | task file created when the workstream starts | task file created when the workstream starts | Review the ownership map, failed-job triage and golden runs; classify findings as confirmed/disproved/partial/unknown; freeze baseline and obtain Owen's implementation approval. |
| BT-1 | `corex-backtest` package contracts and skeleton | LATER | BT-0R + Owen approval | task file created when the workstream starts | task file created when the workstream starts | Establish package boundary, public API, dependency direction and tests. Contracts remain subject to BT-0 review; no Express, PostgreSQL, upload, job-queue or engine-service ownership in the package. |
| BT-2 | `corex-backtest` domain implementation | LATER | BT-1 | task file created when the workstream starts | task file created when the workstream starts | Implement BarSource, SimulationRunner and analytics behind approved contracts; preserve financial semantics unless separately approved; deterministic parity tests required. |
| BT-3 | Engine adapters and backtest cutover | LATER | BT-2, STAGE-4 dataset contract, Owen approval | task file created when the workstream starts | task file created when the workstream starts | Engine retains routes/controllers, authentication, PostgreSQL repositories, uploads/dataset lifecycle, durable jobs/workers, storage and API orchestration. Cut over only after parity and rollback evidence. |
| BT-4 | Confirmed correctness/reliability fixes | LATER | BT-0R, BT-2 | task file created when the workstream starts | task file created when the workstream starts | Fix only findings still confirmed against the implementation baseline; add focused regressions. Log deferred/failed items in KNOWN_ISSUES rather than blocking unrelated work. |
| BT-5 | Frontend contract integration | LATER | BT-3 API contract frozen | task file created when the workstream starts | task file created when the workstream starts | Frontend changes remain separate from package internals; align progress, terminal states, report fields and artifact access with the frozen API contract. |

### Completed workstreams (for traceability)

| ID | Title | Status | Merged | PR | Notes |
|---|---|---|---|---|---|
| ROADMAP | Consolidate plans into this single roadmap | DONE | `20bad625434dcbefcd7bea2a5d389ff887159d82` | PR #64 | Active roadmap and planning consolidation merged 2026-11-14. |
| ENGINE-01 P0 | Baseline persistence fix + characterization tests | DONE | `8dd6048` | PR #62 | 59 suites / 626 tests baseline. |
| ENGINE-01 S2 | Atomic runtime ownership | DONE | `e2f8f271a954dc2c426d5f43f059cdd6502f04c2` | PR #63 | 60 suites / 661 tests. Record: `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`. |
| P3-04 | Broker folder ownership cleanup | DONE | `36316b1` | PR #61 | Also on the Stage 1 branch as `7401e35` (same content, different SHA). |
| P1 | Strategy instance-safety guard | DONE | `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c` | PR #80 | Accepted by Owen 2026-11-20; 12 package suites / 125 tests and 2 root compiler/loader suites / 17 tests passed. Task: `plans/tasks/P1-instance-safety-guard.md`. |
| B3 | Strategy module-resolution boundary + exact strategy-module allow-list | DONE | `1f39d1fd87cba7d2b569c4120ddf16400b11878a` | PR #57 | Merged 2026-11-21; full repository verification 67 suites / 766 tests. Task: `plans/tasks/B3-sandbox-module-resolution.md`. |
| ENGINE-01A | Legacy strategy path removal — read-only impact report | DONE | pending this PR | — | `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`; decision support only, nothing implemented. |

## 4. Workstreams (parallel view)

### ENGINE-02A — strategy package hardening

| ID | Title | Status | Depends on |
|---|---|---|---|
| P1 | Instance-safety guard | DONE | STAGE-1 PR #79 opened; merged PR #80 |
| P2 | Retire `StrategyContract`, move state/API/symbol normalization | IN PROGRESS | P1 DONE, B3 DONE (PR #57) |
| P3 | Authoring surface (template, scripts, `::demo` cleanup) | LATER | P2 |
| P4 | Repatriate `utils/strategy` | LATER | P2 |
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

## 5. Open decisions (all OPEN; "rec" is a proposal, not an approval)

| ID | Question | Recommendation (not approved) | Blocks |
|---|---|---|---|
| D1 | Delete `runPipeline`? | Delete after a reference check. | P6 |
| D2 | `symbols` as `string[]` only? | Yes. | P2 |
| D3 | `generateSignal` alias / dormant `strategyWorker` | If the worker migration is small, migrate it to `onMarketData`; else keep a time-bounded alias. | E5 |
| D4 | `::demo` runtime row | Delete, with Owen's explicit approval (needs before/after counts). | P3 |
| D5 | Owner of `Position` / `StrategyPositionManager` | Keep open; inspect `Strategy.js` and broker usage first. | P4 |
| D6 | Backtest risk parity | Shared risk-decision function with mode-specific context; separate task. | P6 |
| D7 | Backtest simulation package | **ACCEPTED 2026-11-23 — reverse prior deferral:** schedule and build `packages/corex-backtest` now, after BT-0 baseline review and Owen's implementation approval. STAGE-4 remains a gate for engine dataset integration/cutover, not for package-domain development. | BT-0 / BT-1 / BT-2 |
| D8 | Owner of the strategy template | The strategy package. | P3 |
| D9 | Single warmup owner | Decide in E5. | E5 |

## 6. Backlog (side PRs, not phase work)

| ID | Title | Status | Notes |
|---|---|---|---|
| B1 | Backtest report filename safety | NEXT (work exists uncommitted) | Shared `safeFilename` helper used by the writer **and** the `backtestController` readers in the same change; reconcile with the P0 `_saveToFile` already on `main`; split the `_computeAnalytics` additions out. Present only in the Stage 1 dirty tree (`engine/backtestManager.js`, `engine/routes/backtestController.js`, `engine/services/userScope.js`); `safeFilename` does not exist on `main`. |
| B2 | `jobWorker.isNonRetryableError` | NEXT (work exists uncommitted) | Present only in the dirty tree (`engine/workers/jobWorker.js`, `test/job-worker-non-retryable.test.js`); not on `main`. |
| B3 | Strategy module-resolution boundary + exact allow-list | IN PROGRESS | See `plans/tasks/B3-sandbox-module-resolution.md`. PR #56 closed as noisy duplicate; PR #57 is the single active B3 integration PR. Current compiler/scanner bypasses are reproduced and recorded in the task file. |
| B4 | Runtime status flags (`marketDataAvailable` / `warmedUp` / `coldStart`) + stale reconciliation on restore | NEXT (work exists uncommitted) | Re-implement on Stage 2 code using the backup patch as the spec: `engine/core/runtime/RuntimeLifecycle.js`, `engine/core/runtime/RuntimeRegistry.js`, `engine/strategyLoader.js`. The dirty-tree versions are against pre-Stage-2 files and will not apply. |
| B5 | Ignore `repomix.xml` (2 copies) and `data/uploads/**` | NEXT | `main`'s `.gitignore` has only `repomix-output.xml`. Untracked artefacts: `repomix.xml`, `engine/core/repomix.xml`, `data/uploads/**`. |
| B9 | Stop-during-own-stop race in engine recovery (`B6`-`B8` unallocated) | IN PROGRESS — `fix/recovery-stop-request-marker` | A stop request for a strategy that lands while `_attemptRecovery` is awaiting `loader.stopStrategy()` — with the runtime already removed and no ledger record left — is indistinguishable from "nothing to stop", so the recovery still restarts the runtime. Needs a loader-boundary stop-request marker that survives the stop. Risk is highest in LIVE mode (an unintended restart of a live runtime). Found in P0-1 and documented as a limitation in `plans/tasks/ENGINE-02B-P0-1.md` §12.5; no code for it in P0-1. |
| B10 | Backtest pipeline discovery, performance/resource audit and implementation handoff | IN PROGRESS — READ-ONLY BASELINE | `plans/architecture/BACKTEST_PIPELINE_DISCOVERY_AND_HANDOFF.md` | Source scan is documented. Owen reports BT-0a ownership map and BT-0b failed-job triage complete; their evidence still needs review. BT-0c golden-run harness is the remaining baseline lane. No package implementation in B10. Findings feed the new BT sequence; STAGE-4 remains required for engine dataset integration/cutover. |
| SEC-01 | Strategy execution isolation and shared-intrinsic protection | NEEDS TRIAGE — NOT SCHEDULED | Strategy source runs through `vm.compileFunction()` in the engine process's current global context. P1 protects its own inspection intrinsics and B3 restricts the injected CommonJS `require` channel, but neither isolates execution. Reproduced on Node v22.20.0: `Object["con" + "structor"]("return process.getBuiltinModule('fs')")()` passes the scanner and obtains `fs`, bypassing the resolver without using `require`. Requires a separate threat model and reviewed execution-isolation design; do not treat P1 or B3 as a sandbox. |
| SEC-02 | Strategy module-resolution and AST-scanner bypasses | IN PROGRESS — B3 | Before B3, `Module._compile` exposed Node's normal `require`; reproduced aliased `require('fs')`, dynamic `import('node:fs')`, `require.resolve('fs')`, relative traversal to root `package.json`, module-alias package subpath loading, and the substring-based BaseStrategy exception. B3 replaces the injected CommonJS `require` channel with an exact resolver and scanner checks. Process-global execution escapes remain SEC-01; evidence and acceptance tests are in `plans/tasks/B3-sandbox-module-resolution.md`. |
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