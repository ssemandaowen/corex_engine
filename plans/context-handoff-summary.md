# CoreX Context Handoff Summary

Last updated: 2026-11-21
Purpose: concise navigation summary. ROADMAP.md and linked task files are authoritative.

## Repository and working boundaries

- Repository: ssemandaowen/corex_engine
- Main checkout: C:/Users/SBUM/Desktop/corex
- P2 worktree: C:/Users/SBUM/Desktop/corex-p2
- P2 branch: p2-strategy-contract-retirement
- P2 base and current origin/main at branch creation: 1f39d1fd87cba7d2b569c4120ddf16400b11878a
- The P2 implementation is isolated in corex-p2; do not reset, clean, or overwrite the main checkout.
- Active roadmap: plans/ROADMAP.md.
- plans/tasks contains scope/evidence/completion records; it is not an independent priority queue. Follow roadmap status and dependencies.
- plans/STATUS.md is superseded. COREX_DEVELOPMENT_PLAN.md and to_do.md are historical.

## Completed prerequisites

### P1 — strategy instance-safety guard

- PR #80 merged 2026-11-20 as a2c1fc7e5087d2a9d67eda4d70f597fd08fbcf4c.
- Package-owned assertSafeInstance is used after construction in compiler, loader and package validator paths.
- Verification at completion: package 12 suites / 125 tests; root compiler and loader/recovery 2 suites / 17 tests.
- This is an instance-integrity guard, not a process sandbox.
- Record: plans/tasks/P1-instance-safety-guard.md.

### B3 — strategy module-resolution boundary

- PR #57 merged 2026-11-21 as 1f39d1fd87cba7d2b569c4120ddf16400b11878a.
- Full repository verification at merge: 67 suites / 766 tests.
- B3 restricts the injected CommonJS require channel using an exact compiler-owned resolver and scanner checks. It is not process isolation.
- PR #56 was closed as a noisy duplicate.
- SEC-01 (process-global execution escape) and SEC-03 (worker AST validation bypass) remain separate.
- Record: plans/tasks/B3-sandbox-module-resolution.md.

## P2 — active implementation

- Task: plans/tasks/P2-strategy-contract-retirement.md
- Branch/worktree: p2-strategy-contract-retirement / corex-p2
- PR: pending creation
- Goal: make the public corex-strategy-engine Strategy class authoritative for the canonical path. Move getStateSnapshot, immutable __corexApi metadata and singular-symbol normalization into the package class; remove package-to-engine StrategyContract dependency.
- Compiler and loader now use the exact public Strategy constructor. The temporary compatibility branch is limited to the existing legacy BaseStrategy path; unsupported strategy bases are rejected.
- Backtests using canonical Strategy bypass StrategyContract. The existing plain-object legacy characterization remains supported until its planned retirement.
- The recovery test fixture now extends the package Strategy class, matching the real loader boundary.
- P2 does not migrate utils/template.txt or the stored ::demo record (P3), repatriate utils/strategy (P4), or delete BaseStrategy/StrategyContract (P5).
- Full Jest verification after the final implementation changes: 67 suites / 772 tests passed using --runInBand --forceExit --testTimeout=25000.
- Focused P2 tests: 4 suites / 25 tests; engine recovery: 1 suite / 15 tests. All passed.
- P2 is not DONE until the PR is reviewed, accepted and merged.

## Remaining strategy sequence

- P3: move the authoring template into the package and migrate the stored ::demo strategy / orphan runtime cleanup.
- P4: repatriate remaining utils/strategy modules to their owning package.
- P5: remove legacy BaseStrategy, legacy utilities, StrategyContract and the temporary compatibility allowance after P3/P4 consumers are migrated.
- P6 and later work remain sequenced in plans/ROADMAP.md. Do not start them early based only on a task file existing.

## Other tracked work

- STAGE-1 dataset multipart upload: replacement PR #79 is the active implementation; PR #58 was superseded. Check the roadmap and live PR before changing its status.
- ENGINE-02B-P0-1 recovery correctness and B9 recovery-stop race are separate engine workstreams. Do not fold them into P2.
- SEC-01 and SEC-03 remain separate security workstreams; B3 does not close them.

## Working discipline

- Inspect actual callers and implementation before changing code.
- Keep each phase to one bounded PR. Do not combine P2 with P3/P4/P5 or unrelated runtime/backtest work.
- Keep the roadmap status synchronized with task files and merged PRs.
- Distinguish confirmed behavior, test evidence, limitations and assumptions.
