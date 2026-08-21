---
name: testing-and-verification
description: Testing & Verification / Definition of Done
---


## Current status
Testing strategy is not yet finalized project-wide — whether each fix/package ships with tests is
still an open decision. Don't assume a house-wide test requirement exists yet, but do:
- Verify a fix actually resolves the reported symptom before declaring it done (e.g. reproduce a
  stuck job, confirm it now completes; reproduce a broadcast gap, confirm the frontend now updates).
- For newly extracted packages (see `11-modularization-package-extraction.md`), each package should
  be independently verifiable — prefer adding at least minimal tests for a new package's public
  contract, and say so explicitly if you're choosing not to.

## Definition of done, per task
A task is done when:
1. The specific symptom/requirement in the request is verifiably addressed (not just "should work
   in theory").
2. No locked architectural invariant (see `02-architecture-invariants.md`) has been silently broken.
3. Any new state has a clear recovery story (see `08-state-persistence-and-recovery.md`).
4. Nothing was faked or stubbed in place of real data/logic without saying so.

## Reporting back
When reporting completion, state plainly what was verified and how (ran X, observed Y) rather than
asserting correctness without evidence.



