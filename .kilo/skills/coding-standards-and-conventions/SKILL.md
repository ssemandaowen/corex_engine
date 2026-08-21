---
name: coding-standards-and-conventions
description: Coding Standards & Conventions
---


## Module export shape matters
Before assuming a module's export shape, check it. CoreX has shipped real bugs from exporting a
class/constructor where a singleton instance was expected (silently dropped all live signals). When
creating or refactoring a module meant to be a singleton, export the instance, and add a short
comment noting *why* (so a future change doesn't "fix" it back to a class export).

## Controller wiring
Any new Express controller must be explicitly mounted in `server.js` (or the current server entry
point). CoreX has had fully-built controllers that were never mounted — after writing a controller,
verify the mount, don't assume it.

## No fake/placeholder data
Never introduce mock, synthetic, or placeholder data as a stand-in for a real pipeline, in any
environment. If real data isn't available yet, say so explicitly rather than filling the gap
silently (see `07-websocket-realtime-conventions.md`).

## String comparisons in risk/order logic
Guard/protection checks that compare string keys/flags have previously broken due to casing
mismatches (e.g. SL/TP not firing). Treat any such comparison as worth an explicit case-sensitivity
check when you touch it.

## General style
- Prefer explicit, small, single-purpose functions over clever/compressed ones — this codebase is
  actively being modularized for comprehensibility, not optimized for brevity.
- Match the existing pattern for a subsystem (Contract/Base/Factory, sandwich layering, etc.)
  rather than introducing a new structural idiom for a similar problem.



