---
name: job-queue-worker-conventions
description: Job Queue & Worker Conventions
---


## Transactional claiming
The job queue uses transactional claiming — a worker claims a job inside a DB transaction so two
workers can never process the same job. Preserve this when touching queue code; don't introduce a
claim step that reads-then-writes outside a transaction.

## Logging conventions
Worker/supervisor logs use tagged prefixes: `[JOB_SUPERVISOR]` and `[JOB_WORKER]`. When adding new
log lines in this subsystem, keep the existing tag convention so log-grep-based debugging keeps
working.

## Debugging stuck/queued jobs
If a backtest (or other) job is stuck in `queued` and never completes:
1. First ask for or fetch the actual server console output filtered to `[JOB_SUPERVISOR]` /
   `[JOB_WORKER]` lines — do not guess at the cause without it.
2. Check whether the worker actually claimed the job (transactional claim succeeded) vs. whether it
   claimed but then silently failed/hung mid-execution.
3. Don't "fix" a stuck-job symptom by adding a timeout/retry without first identifying why the
   worker didn't progress — that can mask a real bug (e.g. a broker injection or compile-cache
   issue upstream).



