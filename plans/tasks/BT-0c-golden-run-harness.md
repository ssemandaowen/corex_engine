# BT-0c — Golden-run harness and deterministic reference runs

**Owner:** ChatGPT (Owen approval authority remains unchanged)  
**Status:** IN PROGRESS  
**Work type:** Read-only baseline / test-harness work  
**Package implementation:** NOT AUTHORIZED

## Objective

Produce a small, reproducible golden-run baseline for the current backtest pipeline so BT-0R can compare future corex-backtest behavior against known outputs.

## Required evidence

1. Identify and pin the exact strategy-engine source revision used by the run. If the working tree is dirty, record the base commit and a clear changed-file/diff fingerprint; do not mislabel an uncommitted tree as a commit.
2. Identify the existing backtest entry point, fixture/data source, strategy, configuration, and relevant execution options.
3. Use a controlled deterministic fixture with fixed timestamps and input bars. Avoid live provider/network data.
4. Capture stable outputs that the existing implementation actually exposes: trades/fills, equity or balance series, summary metrics, terminal job state, and report/artifact fields where available.
5. Repeat the same run and compare outputs. Separate deterministic fields from volatile fields (IDs, wall-clock timestamps, durations, generated paths).
6. Record commands, environment/runtime versions, results, failures, and known limitations.

## Scope and guardrails

- Inspect first; do not change production source or financial semantics.
- No creation or implementation of packages/corex-backtest.
- No DB mutation, job insertion, schema migration, provider calls, or modification of existing production data.
- Test-only/helper additions are allowed only if they are isolated, necessary for the golden-run harness, and do not alter existing tests or package behavior. Record exact paths changed.
- Preserve the current working tree. Do not stash, reset, clean, checkout over, or commit unrelated dirty files.
- If a required run is blocked by missing DB state, credentials, fixtures, or unstable behavior, record the blocker and stop that branch of work rather than looping.
- Escalate substantial harness design or broad fixture work to Claude with a bounded prompt.

## Phase 1 — Existing baseline and safety inspection (completed)

Repository and source inspection established:

- Local corex working tree base: 1f39d1fd87cba7d2b569c4120ddf16400b11878a (branch main), with extensive unrelated/uncommitted changes. This is not a clean source snapshot and must not be represented as the final baseline.
- GitHub main after PR #83: 2c10e53981d69e5d6501a85b1ab032d01c720029; BT-0c task registration was then committed separately as 540a11ed8f0025c09f87eb1ff4a52dd0b2becac0.
- No packages/corex-backtest directory exists in the inspected local package tree.
- Current simulation entry point is engine/backtestManager.js; it loads/normalizes bars, sorts them, runs the simulation, computes analytics, invokes report persistence and emits progress.
- The manager invokes storage.cleanupBacktestsAsync(this.storagePath) before saving each report. The default storage path is under the engine data/backtests directory.
- test/StrategyClassIdentity.test.js builds a deterministic 30-bar synthetic CSV with fixed timestamps and stubs the PostgreSQL query method, but it does not compare repeated runs and leaves report output in the manager's default storage directory.
- test/backtest-report-path.test.js builds a deterministic 120-bar synthetic CSV and stubs DB writes, but it also exercises the default report directory. Its cleanup removes matching p0-* files, while the manager's cleanup routine can prune older JSON reports beyond its retention floor. Do not run this test as-is against the active local data directory.
- test/backtest-resolver-public-api.test.js is a package-surface assertion, not a simulation golden run.
- The inspected broker driver is packages/corex-broker-contract/src/drivers/BacktestDriver.js; it uses market-data timestamps when supplied, but falls back to Date.now() for missing timestamps. Fixture timestamps therefore need to be explicit.

Safety conclusion: existing synthetic fixtures are useful starting points, but neither existing end-to-end characterization test is safe to execute against the active local report directory without first isolating the manager's storagePath to a fresh temporary directory and restoring it afterward.

No tests were executed in this phase. A clean detached worktree was created at the merged GitHub main commit for isolation, but the local execution bridge could not access its protected worktree path; that temporary worktree was removed. No source files or existing tests were changed. No database or active report data was touched.

## Phase 2 — Isolated golden-run execution (NEXT)

1. Execute from a clean, pinned source snapshot; do not use the dirty local main tree as the baseline.
2. Add the isolated test at test/backtest-golden-run.test.js. Use a deterministic synthetic CSV, a fresh Strategy instance per run, stubbed DB persistence, and a temporary manager storage directory. Restore the manager's original storagePath and readiness flags in teardown.
3. Run the identical fixture/config twice and compare only stable report fields. Explicitly normalize wall-clock timestamps, execution duration, generated file paths, and any random IDs.
4. Capture trade/fill and performance outputs only where the existing simulation actually produces them; do not invent expected values.
5. Write the normalized evidence JSON to the path in BT_GOLDEN_OUTPUT when that environment variable is set.
6. Record the test command, runtime, source SHA, output hash/summary, and all limitations. If the environment prevents a safe repeat run, stop and report the blocker.

## GitHub Actions setup (in progress)

- Workflow draft: .github/workflows/backtest-golden.yml on branch bt0c/github-actions-golden-run; PR #85.
- Runner uses GitHub-hosted Ubuntu, Node 22, npm ci from package-lock.json, runs only test/backtest-golden-run.test.js, and uploads BT_GOLDEN_OUTPUT as a short-retention artifact. This avoids consuming the user's Dell machine resources and does not require PostgreSQL or live provider credentials.
- First workflow execution: dependency installation succeeded (515 packages in 6 seconds); test step failed with Jest "No tests found" because test/backtest-golden-run.test.js has not yet been added. This is an expected harness-not-present blocker, not a simulation regression. No output artifact was produced.
- Once the test file exists on the PR head, rerun the workflow and record the actual test result. Do not mark BT-0c complete based on dependency installation alone.

## Deliverables

- A reproducible run recipe and fixture/config identity.
- First-run and repeat-run output snapshots or a precise explanation of why a safe run was not possible.
- A deterministic-vs-volatile field classification.
- A concise known-limitations list for BT-0R.
- No package implementation.

## Exit criteria

BT-0c is complete when the run can be repeated from the documented inputs, the stable output comparison is recorded, and all deviations/blockers are classified. BT-0R then reviews BT-0a, BT-0b, and BT-0c together before Owen decides whether BT-1 may begin.
