# P0-06 — Test and Known-Issues Baseline

Status: REVIEW
Suggested owner: Kilo Code
Risk: Medium (test execution may require local services)
Dependencies: P0-01
Output: `plans/architecture/QUALITY_BASELINE.md`

## Owner / branch / commit
- Owner: Kilo Code
- Branch: review/p0-06-quality-baseline
- Starting commit: 435127546087f9d40486ea272cb337363ce0724e
- Current status: REVIEW (not DONE; acceptance criteria not ticked until Owen accepts)

## Objective
Establish a truthful test and quality baseline for the verified repository commit, separating product failures from environment limitations and historical reports.

## Scope
- Inventory unit, integration, contract, architecture, smoke and frontend test commands.
- Run safe relevant tests where environment permits, starting with package and targeted suites.
- Record exact commands, commit, environment prerequisites, duration where practical, pass/fail/skipped counts and failure summaries.
- Identify flaky tests, order-dependent tests, tests coupled to implementation details and missing behavior coverage.
- Review lint/typecheck/build scripts and record whether they are configured and runnable.
- Reconcile existing known-issue entries with current test evidence.

## Non-goals
- No test fixes, snapshots, dependency updates, lint autofixes or source changes.
- Do not run destructive integration tests or migrations against valuable databases.
- Do not claim a full suite ran if only selected tests ran.

## Procedure
1. Read P0-01 baseline and confirm commit/worktree.
2. Inspect test scripts and service requirements.
3. Run non-destructive targeted tests first; run broader suites only when safe.
4. Capture raw output/log paths and classify each failure.
5. Separate verified baseline failures, newly introduced failures, flaky results and environment blocks.

## Deliverable
Create `plans/architecture/QUALITY_BASELINE.md` with command matrix, environment, exact results, failure classification, coverage gaps, known-issue reconciliation and recommended next verification steps.

## Acceptance criteria
- [ ] Every executed command and result is recorded accurately.
- [ ] Not-run commands are explicitly marked NOT RUN with reason.
- [ ] Environment limitations are not misreported as code failures.
- [ ] Existing known issues are reconciled against current evidence.
- [ ] No application/test/config files changed.
