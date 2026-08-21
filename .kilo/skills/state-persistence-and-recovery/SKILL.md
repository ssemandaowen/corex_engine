---
name: state-persistence-and-recovery
description: State Persistence & Recovery
---


## `StrategyStateStore`
Debounced DB persistence — writes are batched/delayed, not synchronous on every state change.
When adding new runtime state, persist it through this store rather than a new ad hoc write path,
and respect the existing debounce behavior (don't force synchronous writes "to be safe" — that
defeats the point and can reintroduce write-storm issues).

## `MetricsAccumulator`
Shared between broker modes (Backtest/Paper/Live) — metrics logic should not fork per-mode unless
there's a real behavioral difference. If you find yourself writing mode-specific metrics code, ask
whether it belongs in the shared accumulator instead.

## Full recoverability
Any new piece of runtime state must answer: "if the process restarts right now, how is this state
reconstructed from PostgreSQL?" If there's no good answer, that's a design gap to flag, not to
silently accept.

## Session revocation
Server-side session revocation goes through the `corex_sessions` table. Don't add a parallel
session/logout mechanism (e.g. client-only token expiry) that isn't reflected there.



