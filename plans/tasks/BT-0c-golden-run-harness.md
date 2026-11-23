# BT-0c — Golden-run harness and deterministic reference runs

**Owner:** ChatGPT (Owen approval authority remains unchanged)  
**Status:** IN PROGRESS  
**Work type:** Read-only baseline / test-harness work  
**Package implementation:** NOT AUTHORIZED

## Objective

Produce a small, reproducible golden-run baseline for the current backtest pipeline so BT-0R can compare future `packages/corex-backtest` behavior against known outputs.

## Required evidence

1. Identify and pin the exact strategy-engine source revision used by the run. If the working tree is dirty, record the base commit and a clear changed-file/diff fingerprint; do not mislabel an uncommitted tree as a commit.
2. Identify the existing backtest entry point, fixture/data source, strategy, configuration, and relevant execution options.
3. Use a controlled deterministic fixture with fixed timestamps and input bars. Avoid live provider/network data.
4. Capture stable outputs that the existing implementation actually exposes: trades/fills, equity or balance series, summary metrics, terminal job state, and report/artifact fields where available.
5. Repeat the same run and compare outputs. Separate deterministic fields from volatile fields (IDs, wall-clock timestamps, durations, generated paths).
6. Record commands, environment/runtime versions, results, failures, and known limitations.

## Scope and guardrails

- Inspect first; do not change production source or financial semantics.
- No creation or implementation of `packages/corex-backtest`.
- No DB mutation, job insertion, schema migration, provider calls, or modification of existing production data.
- Test-only/helper additions are allowed only if they are isolated, necessary for the golden-run harness, and do not alter existing tests or package behavior. Record exact paths changed.
- Preserve the current working tree. Do not stash, reset, clean, checkout over, or commit unrelated dirty files.
- If a required run is blocked by missing DB state, credentials, fixtures, or unstable behavior, record the blocker and stop that branch of work rather than looping.
- Escalate substantial harness design or broad fixture work to Claude with a bounded prompt.

## Deliverables

- A reproducible run recipe and fixture/config identity.
- First-run and repeat-run output snapshots or a precise explanation of why a safe run was not possible.
- A deterministic-vs-volatile field classification.
- A concise known-limitations list for BT-0R.
- No package implementation.

## Exit criteria

BT-0c is complete when the run can be repeated from the documented inputs, the stable output comparison is recorded, and all deviations/blockers are classified. BT-0R then reviews BT-0a, BT-0b, and BT-0c together before Owen decides whether BT-1 may begin.
