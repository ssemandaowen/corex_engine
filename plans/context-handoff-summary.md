# CoreX Context Handoff Summary

Last updated: 2026-11-21
Purpose: concise navigation summary. `plans/ROADMAP.md` and the linked task files are authoritative.

## Repository and working boundaries

- Repository: `ssemandaowen/corex_engine`
- Main checkout: `C:\\Users\\SBUM\\Desktop\\corex`
- Current branch: `main`
- Current main SHA: `1f39d1fd87cba7d2b569c4120ddf16400b11878a` (matches `origin/main` at the last check).
- The checkout was clean before the current planning-document updates. The current changes are documentation only; no application source code has been edited. Do not reset or clean the checkout.
- Active roadmap: `plans/ROADMAP.md`.
- `plans/STATUS.md` is superseded; `plans/COREX_DEVELOPMENT_PLAN.md` and `plans/to_do.md` are historical. Do not use them as the active task queue.
- `plans/tasks/` stores the scope, evidence, acceptance criteria and completion records for individual workstreams. The folder is not itself a priority queue: follow the IDs, statuses and task-file links in `plans/ROADMAP.md`. Completed task files remain as historical evidence; LATER/backlog files are not authorization to start work.

## P1 — complete

- PR #80 merged 2026-11-20 as `a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c`.
- Added package-owned `assertSafeInstance(instance, ExpectedClass)` and integrated it after construction in compiler, loader and package validator paths.
- Verification recorded in `plans/tasks/P1-instance-safety-guard.md`: 12 package suites / 125 tests; 2 root compiler/loader suites / 17 tests.
- This is an instance-integrity guard, not a process sandbox.

## B3 — complete

- PR #57 merged into `main` on 2026-11-21 as `1f39d1fd87cba7d2b569c4120ddf16400b11878a`.
- Full repository verification: 67 suites / 766 tests passed.
- B3 restricts the injected CommonJS `require` channel with an exact compiler-owned resolver and scanner checks. It is not execution isolation.
- PR #56 was closed as the noisy duplicate. The prior PR #57 COMMENT review was owner-authored; this handoff does not claim an independent review occurred. Owen directed the merge.
- Authoritative completion record: `plans/tasks/B3-sandbox-module-resolution.md`.
- SEC-01 (process-global execution escape) and SEC-03 (worker AST-scanner bypass) remain separate issues.

## P2 — active

- Task: `plans/tasks/P2-strategy-contract-retirement.md`.
- Goal: remove `StrategyContract` from the canonical package-based Strategy path; move `getStateSnapshot`, `__corexApi` and singular-symbol normalization into `corex-strategy-engine`'s `Strategy` base class.
- Required class-identity regression: strategy source, compiler, loader/runtime and backtest must use the same public `corex-strategy-engine` `Strategy` constructor.
- The compiler currently calculates `__corexApi` independently, while the base class receives it through `StrategyContract.adapt()`; P2 should consolidate this rather than duplicate it.
- The existing `BaseStrategy` template and stored `::demo` record still use the legacy contract. P2 must not break them prematurely. P3 owns template/demo migration; P5 owns final legacy source and contract deletion. The temporary legacy boundary must not become the canonical API.
- P2 scope and acceptance criteria are in its task file. No P2 application source changes or implementation branch have been started yet.

## Remaining sequence

- P3: move authoring template into the strategy package and migrate the stored `::demo` strategy / orphan runtime cleanup.
- P4: repatriate remaining `utils/strategy` modules to their owning package.
- P5: delete legacy `BaseStrategy`, legacy strategy utilities and the final compatibility allowance/contract once P3/P4 consumers are migrated.
- P6 and later work remain sequenced in `plans/ROADMAP.md`; do not start them early based only on the presence of a task file.

## Other tracked work

- STAGE-1 upload transport: replacement PR #79 is the current implementation; PR #58 was superseded. See the live PR and roadmap before changing its status.
- ENGINE-02B-P0-1 recovery correctness and B9 recovery-stop race are separate engine work. Do not fold them into P2.
- SEC-01 and SEC-03 remain separate security workstreams; B3 does not close them.

## Working discipline

- Inspect the current implementation and exact callers before changing code.
- Keep each phase to one bounded PR; do not combine P2 with P3/P4/P5 or unrelated runtime/backtest work.
- Distinguish confirmed behavior, test evidence, limitations and assumptions.
- Update the roadmap and the task record as implementation progresses; a completed task requires merged code and recorded acceptance evidence.
