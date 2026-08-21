---
name: modularization-package-extraction
description: Modularization / Package Extraction Plan
---


## Why
The app's scope grew far beyond what was originally planned, to the point of being genuinely
overwhelming to reason about as one cluster. The fix is extracting it into separate, independently
verified npm workspace packages, one at a time, before refactoring the main engine to plug into
them — not a big-bang rewrite.

## Sequencing rules
1. The full feature list / scope is defined **before** package boundaries and extraction order are
   decided. Don't propose package boundaries against an incomplete feature list.
2. Each package is extracted and tested in isolation before the next one starts.
3. Only after the packages exist does the main engine get refactored to consume them — the engine
   refactor is not bundled into the extraction of any single package.

## Incorporated architecture feedback (treat as current guidance, not just history)
- **Strangler Fig pattern**: the old monolith continues running while new packages are grown
  alongside it and gradually take over responsibilities — don't rip out the old path before the
  new package is proven.
- **TypeScript project references** define package boundaries formally (not just folder
  convention) — new packages should be wired into the TS project reference graph.
- **Audit logging as an event-emitter-based middleware package** — audit logging should become its
  own extracted package built on an event-emitter middleware pattern, not scattered inline logging
  calls, consistent with the "complete audit logging" invariant.

## Working with this plan
When asked to work on "the next package," check what's already been extracted and verified before
proposing new boundaries — don't re-derive the plan from scratch each session.



