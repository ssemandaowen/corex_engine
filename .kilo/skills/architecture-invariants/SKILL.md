---
name: architecture-invariants
description: Architecture Invariants (do not violate)
---


These are locked decisions, not preferences. Treat any change that conflicts with one of these as
requiring an explicit flag-and-confirm step before writing code.

1. **Server decides everything.** Frontend renders server state; it never computes or decides
   trading/risk logic locally.
2. **WebSocket-only real-time.** No polling loops, no `setInterval` fetch cycles for live data.
3. **Full state recoverability.** A killed/restarted process must reconstruct exact state from
   PostgreSQL — nothing load-bearing lives only in memory.
4. **Complete audit logging.** Every state-changing action is logged in a way that can be replayed
   or audited later.
5. **Lazy, on-demand strategy loading.** Nothing compiles at startup. Strategies compile on first
   use and are cached by SHA256 of source.
6. **Polymorphic broker hierarchy.** All broker interaction goes through the
   `BrokerContract` / `BaseBroker` / `RuntimeBrokerFactory` pattern — never a direct provider call
   bypassing the factory.
7. **DSL sandwich pattern.** Strategy execution follows
   `BaseStrategy → SignalGenerationEngine → IndicatorAdapter` layering — don't collapse layers for
   convenience.

## Known failure modes to watch for (regressions to avoid reintroducing)
- Exporting a class/constructor where a singleton is expected (has silently dropped live signals
  before — always check whether a module is supposed to export an instance or a class).
- A controller fully built but never mounted in `server.js` — after adding a controller, verify it
  is actually wired into the Express app.
- Casing mismatches in protection/guard checks (e.g. a `_checkProtections` bug prevented SL/TP from
  firing) — treat any string-key comparison touching risk/order logic as a spot to double check
  case sensitivity.



