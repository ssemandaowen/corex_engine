# CoreX — Active Roadmap

> Single active roadmap. Last updated: 2026-11-18
> Owner: Owen Ssemanda (Apex Trait Ltd.) — approval authority
> Scope: phase order, task IDs, dependencies, status, approval gates
> Status dashboard of record: this file. `plans/STATUS.md` is superseded (banner only, history).
> Historical roadmap: `plans/COREX_DEVELOPMENT_PLAN.md` (banner only; do not update).
> Workflow rules: `plans/AGENT_WORKFLOW.md`. Decisions: `plans/decisions.md`. Issues: `plans/KNOWN_ISSUES.md`.

Repository state refreshed against GitHub on 2026-11-18. Current main = 574fa7b45650805c303c95a47be510353acf199c2 (B10 / PR #72). PR and branch states below are point-in-time snapshots; refresh them when claiming a task.

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
| 1 | STAGE-1 | Dataset upload multipart fix with a genuine regression test | BLOCKED | — | fix/upload-multipart-transport / PR #58 (CLOSED, NOT MERGED) | task file created when the workstream starts | PR #58 was closed on 2026-11-14 without merging. Its test did not import the real client.ts Axios instance and was not regression-sensitive. The approved replacement remains: a focused change against current main with a test using the real exported Axios instance and a stub adapter. No replacement PR is currently recorded. This dependency blocks P1 until STAGE-1 is completed or Owen explicitly changes the dependency. |
| 2 | ROADMAP | Consolidate plans into this single roadmap | DONE | — | PR #64 (20bad62) | — | Single active roadmap established; plans/STATUS.md is superseded and retained for history. |
| 3 | E1 | `engine.js` caller inventory and ownership mapping — **INVENTORY ONLY** | DONE | ROADMAP reviewed | `docs/engine-e1-final-report` | `plans/tasks/ENGINE-02B-E1.md` | **Complete — report: `plans/Audit/ENGINE-02B_E1_engine_inventory.md`** (all seven questions answered, 26 CONFIRMED / 4 INFERRED / 3 UNKNOWN, eight prior findings re-verified). It does NOT repoint any caller; repointing happens inside E2–E4 (and E5), each PR moving only its own methods and separately approved. Implementation handoff is **proposed work, not approved**: four P0 correctness defects (recovery result check, recovery identity space, `stop()` leaves runtimes/timers/listeners, listener leak per restart), three P1 extractions that map to E2/E3/E4, and one P1 blocked on a product decision (warmup cache revive-vs-delete). |
| 4 | P1 | Instance-safety guard (assertSafeInstance in corex-strategy-engine) | BLOCKED | STAGE-1 completed | task file created when the workstream starts | task file created when the workstream starts | Scanner = pre-execution layer; instance check = post-construction layer. Two layers, one guard. STAGE-1 / PR #58 is closed unmerged; do not start P1 until the genuine upload regression test is merged or Owen changes this dependency. |
| 5 | B3 | Sandbox module resolution (strategyCompiler) + security.js exact corex-strategy-engine allow-list | NEXT | Stage 2 (DONE, PR #63) | PR #57 (focused allow-list patch); PR #56 (broad duplicate) | task file created when the workstream starts | Must precede P2. Neither PR completes B3: #57 changes only utils/security.js and test/round7.comprehensive.test.js; #56 is a 66-file branch with extra dynamic-import handling and unrelated changes. Neither includes strategyCompiler sandbox module-resolution work. Consolidate required behavior into one bounded change against current main; do not merge either PR as complete B3. |
| 6 | P2 | Canonical Strategy class: retire StrategyContract; consolidate state/API/symbol normalization and capability contract | LATER | P1, B3 | Existing candidate PRs #15 and #16 (not merged; stale base) | task file created when the workstream starts | One package-owned Strategy class and one class identity across loader/compiler/runtime/backtest. Move getStateSnapshot, __corexApi, and symbol normalization into it. Reconcile StrategyManifest, StrategyValidator, editor/runtime/backtest capability definitions against the locked five hooks (onStart, onBar, onTick, onFill, onStop); remove stale next, generateSignal, and onMarketData declarations where no longer valid. PR #15/#16 are old candidate work, not accepted implementation; reconcile before reuse. |
| 7a | E2 | Runtime supervision correctness + StrategySupervisor extraction | LATER | E1 approved; P0-3/P0-4 acceptance defined | task file created when the workstream starts | task file created when the workstream starts | First resolve E1 P0-3 (shutdown must terminate registered runtimes and clear recovery state/timers) and P0-4 (engine/loader listener lifecycle across start/stop/restart); then extract supervision without moving defects. Preserve one authoritative RuntimeRegistry. |
| 7b | E3 | Banner + wiring extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | Wiring stays at construction time. |
| 7c | E4 | Telemetry extraction | LATER | E1 approved | task file created when the workstream starts | task file created when the workstream starts | E2/E3/E4 are parallel-safe with P-phases subject to rule 3. |
| 8 | P3 | Authoring surface: template into the package, scripts, `::demo` + orphan runtime row cleanup | LATER | P2 | task file created when the workstream starts | task file created when the workstream starts | The `::demo` cleanup is a reviewed one-off script with before/after counts and explicit approval (D4). |
| 9 | P4 | Repatriate `utils/strategy` | LATER | P2 | task file created when the workstream starts | task file created when the workstream starts | Diff duplicate pairs first; owner question is D5 (open). |
| 10 | P5 | Delete legacy (`BaseStrategy`, legacy `utils/strategy`, security allowance) | LATER | P3, P4 | task file created when the workstream starts | task file created when the workstream starts | The `IncrementalIndicators` test MIGRATES to the package; it is not deleted. |
| 11 | E5 | Warmup consolidation into one owner (`engine.warmupStrategy` vs `RuntimeLifecycle._warmup`) | LATER | P5, D3, D9 | task file created when the workstream starts | task file created when the workstream starts | D9 decides the single owner. |
| 12 | P6 | Risk single-source + dead pipeline removal | LATER | P5 | task file created when the workstream starts | task file created when the workstream starts | D1, D6. A latency benchmark is required as evidence. |
| 13 | STAGE-3 | Stage 3 — WebSocket stage | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Status is not confirmed in any repository record. Owen to confirm before this row is scheduled. |
| 14 | STAGE-4 | Stage 4 — Dataset resource model | UNCONFIRMED | Owen confirmation of status | — | task file created when the workstream starts | Blocks the data-acquisition part of the `backtestManager` split (P7). |
| 15 | P7 | Recomposition: BacktestManager responsibility split; StrategyLoader facade collapse | LATER | P5, P6, STAGE-4 | task file created when the workstream starts | task file created when the workstream starts | Split by domain ownership, not file size: strategy validation, historical data acquisition/normalization, simulation orchestration, broker/execution integration, progress/cancellation, analytics, and report/artifact persistence each need one owner and explicit contracts. Preserve LIVE/PAPER/BACKTEST boundaries; derive folder moves from the approved E1 register (L7). |
| 16 | P8 | Boundary enforcement (`madge` / `dependency-cruiser` rules) | LATER | P5, P6 | task file created when the workstream starts | task file created when the workstream starts | ENGINE-03 enforcement half. Rule set derived from P7's register. |
| 17 | ENGINE-02B-P0-1 | Recovery correctness: exact runtime target and result.ok handling | DONE | E1 (DONE, `467e79c`) | PR #66 — da7dfd6 | plans/tasks/ENGINE-02B-P0-1.md | Merged 2026-11-15. B9 subsequently closed the user-stop-during-recovery-stop race; B11 tracks the separate stop-during-recovery-start window. E1 P0-3 shutdown and P0-4 listener lifecycle remain to be implemented under E2. |

### Current delivery focus — verified 2026-11-18

This section is the handoff for agents entering the repository. It does not override the dependency order above.

1. Finish LIVE-BAR-PARITY-01 publication. Implementation and targeted verification are present only in Owen's local diag/live-bar-parity worktree; they are not committed or pushed. The final local audit says READY FOR COMMIT. Preserve the limitation that the full project suite was not run.
2. Next runtime-safety fix: B11 (issue #69). B9 handles a user stop during recovery's own stop. B11 is the separate race where a user stop during recovery's startStrategy window is lost. Implement the strategy-keyed stop-request marker and post-start comparison; add a regression test proving recovery cannot resurrect a user-stopped runtime.
3. Strategy package sequence. B3 is eligible but incomplete: consolidate exact-package security authorization and sandbox module resolution in one focused change. P1 remains blocked by STAGE-1 under the current approved dependency. Then P2 establishes the canonical Strategy class and reconciles the manifest/validator/capability surface; P3/P4 prepare authoring and ownership migration; P5 deletes the legacy BaseStrategy hierarchy.
4. Engine coordination. E2 must address E1 P0-3 shutdown and P0-4 listener lifecycle before extracting StrategySupervisor. E3/E4 follow their own bounded ownership.
5. Backtesting. P7 is later, after P5/P6/STAGE-4. BacktestManager must be decomposed by domain responsibility and contracts, not merely split into smaller files.

**Current GitHub reconciliation (2026-11-18):**

- main is at B10 / 574fa7b; PR #72 is merged.
- PR #68 (B9, 6d35335) and PR #66 (recovery correctness, da7dfd6) are merged.
- PR #58 is closed without merge; STAGE-1 remains blocked pending the genuine regression-test replacement.
- PRs #56/#57 are both open but do not complete B3; #56 is broad (66 files), #57 is focused (2 files). Do not treat either as merged or complete.
- PR #15 (package finalization) and #16 (legacy deletion) remain open against an older base; #16 is currently not mergeable. They are candidate work only and must be reconciled against current main and the P2–P5 sequence.
- PR #54 remains a draft planning PR; PR #70 is the roadmap/B9/B10 documentation PR; PR #71 is the strategy lifecycle investigation. Do not create duplicate planning or audit PRs.

### Completed workstreams (for traceability)

| ID | Title | Status | Merged | PR | Notes |
|---|---|---|---|---|---|
| ENGINE-01 P0 | Baseline persistence fix + characterization tests | DONE | `8dd6048` | PR #62 | 59 suites / 626 tests baseline. |
| P0-01 | Repository baseline audit | DONE | `a97ae6359b0d1b960b19368e2bbff476e16b4405` | PR #53 | Accepted by Owen 2026-10-31; output `plans/architecture/REPOSITORY_BASELINE.md`. |
| ENGINE-01 S2 | Atomic runtime ownership | DONE | `e2f8f271a954dc2c426d5f43f059cdd6502f04c2` | PR #63 | 60 suites / 661 tests. Record: `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`. |
| ENGINE-02B-P0-1 | Recovery correctness | DONE | `da7dfd6` | PR #66 | Exact runtime target and result.ok handling; B9 and B11 are separate recovery race tasks. |
| P3-04 | Broker folder ownership cleanup | DONE | `36316b1` | PR #61 | Also on the Stage 1 branch as `7401e35` (same content, different SHA). |
| ENGINE-01A | Legacy strategy path removal — read-only impact report | DONE | pending this PR | — | `plans/Audit/ENGINE-01A_legacy_strategy_removal_report.md`; decision support only, nothing implemented. |

## 4. Workstreams (parallel view)

### ENGINE-02A — strategy package hardening

| ID | Title | Status | Depends on |
|---|---|---|---|
| P1 | Instance-safety guard | NEXT | STAGE-1 |
| P2 | Retire `StrategyContract`, move state/API/symbol normalization | LATER | P1, B3 |
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
| D7 | Backtest simulation package | Defer until after STAGE-4 / P7. | P7 |
| D8 | Owner of the strategy template | The strategy package. | P3 |
| D9 | Single warmup owner | Decide in E5. | E5 |

## 6. Backlog (side PRs, not phase work)

| ID | Title | Status | Notes |
|---|---|---|---|
| B1 | Backtest report filename safety | NEXT (work exists uncommitted) | Shared `safeFilename` helper used by the writer **and** the `backtestController` readers in the same change; reconcile with the P0 `_saveToFile` already on `main`; split the `_computeAnalytics` additions out. Present only in the Stage 1 dirty tree (`engine/backtestManager.js`, `engine/routes/backtestController.js`, `engine/services/userScope.js`); `safeFilename` does not exist on `main`. |
| B2 | `jobWorker.isNonRetryableError` | NEXT (work exists uncommitted) | Present only in the dirty tree (`engine/workers/jobWorker.js`, `test/job-worker-non-retryable.test.js`); not on `main`. |
| B3 | Sandbox module resolution + security allow-list | NEXT | See sequence row 5 (PRs #56/#57 duplicate pair). |
| B4 | Runtime status flags (`marketDataAvailable` / `warmedUp` / `coldStart`) + stale reconciliation on restore | NEXT (work exists uncommitted) | Re-implement on Stage 2 code using the backup patch as the spec: `engine/core/runtime/RuntimeLifecycle.js`, `engine/core/runtime/RuntimeRegistry.js`, `engine/strategyLoader.js`. The dirty-tree versions are against pre-Stage-2 files and will not apply. |
| B5 | Ignore `repomix.xml` (2 copies) and `data/uploads/**` | NEXT | `main`'s `.gitignore` has only `repomix-output.xml`. Untracked artefacts: `repomix.xml`, `engine/core/repomix.xml`, `data/uploads/**`. |
| B9 | Stop-during-own-stop race in engine recovery (`B6`-`B8` unallocated) | DONE — PR #68 (`6d35335`) | A stop request for a strategy that lands while `_attemptRecovery` is awaiting `loader.stopStrategy()` — with the runtime already removed and no ledger record left — is indistinguishable from "nothing to stop", so the recovery still restarts the runtime. Needs a loader-boundary stop-request marker that survives the stop. Risk is highest in LIVE mode (an unintended restart of a live runtime). Found in P0-1 and documented as a limitation in `plans/tasks/ENGINE-02B-P0-1.md` §12.5; no code for it in P0-1. |
| B10 | Desired-state consistency: orphaned runtimes and non-atomic strategy delete | DONE — PR #72 (`574fa7b`) | `strategy_runtimes` has no foreign key onto `strategies`, so deleting a strategy left its `ACTIVE` rows behind. Restore reads exactly those rows, so every boot retried a start that can only fail (`Strategy '<id>' not found in DB`) and the orphan stayed `ACTIVE` forever — and a re-registered name started by itself on the next boot. Fixed by reconciling orphaned `ACTIVE` rows to `STOPPED` before restore (one statement, boot cold path) and by deleting the strategy row with its desired-state rows in one transaction, with the delete refused while a runtime is owned, reserved, or a start is still compiling. Verified by `test/strategyLifecyclePersistence.test.js`, the atomic-delete tests in `test/runtimeOwnership.test.js`, and `test/live-reconciliation-probe.js` against real PostgreSQL (15/15, rolled back, no residue). No schema change. Deferred by Owen's decision: `strategy_ticks`/`strategy_signals` retention, soft deletion for strategies with order history (`orders_strategy_id_fkey` still NO ACTION), and historical identity — see issue #73. |
| B11 | Recovery restart window: a user stop during `startStrategy` is lost (issue #69) | NEXT | A strategy-level stop issued while recovery is inside `startStrategy` resolves no targets (no registered entry, no `cleanupFailures` reservation), returns `false` before the B9 marker is reached, and emits nothing, so recovery completes the restart. Needs a strategy-keyed stop request plus a second comparison in `_attemptRecovery`. Same class as B9, different marker key. |
| LIVE-BAR-PARITY-01 | Closed-candle dispatch, live/backtest indicator parity, and MarketFeed per-tick timer removal | IN PROGRESS — local-only, ready for commit | diag/live-bar-parity exists only in Owen's local corex_diag_livebar worktree at B9 baseline 6d35335; changes are uncommitted and not pushed. Targeted tests reported: parity 6/6, Strategy 7/7, SoACandleStore 4/4; independent review APPROVE WITH CONDITIONS, condition fixed; final audit READY FOR COMMIT. Full project suite not run. Task record: plans/tasks/LIVE-BAR-PARITY-01.md (local worktree; publish with implementation). |

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
