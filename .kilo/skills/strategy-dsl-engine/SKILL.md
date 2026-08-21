---
name: strategy-dsl-engine
description: Strategy DSL Engine
---


## Layering (the "sandwich")
`BaseStrategy` (user-facing strategy definition)
  → `SignalGenerationEngine` (turns strategy + market data into signals)
    → `IndicatorAdapter` (lazy-cached indicator computation)

Never let a strategy call an indicator directly, and never let the signal engine bypass the adapter
cache to recompute an indicator that's already cached for this runtime.

## Compilation
- Strategies compile lazily, on first use per runtime — not at server startup.
- Compiled strategy code is cached, keyed by a SHA256 hash of its source, so identical strategy
  source across runtimes/users reuses the compiled artifact.
- When modifying the compile path, preserve both properties above; don't introduce eager
  compilation "for simplicity."

## Signal engines
`SignalProcessingEngine` and `SignalExecutionEngine` must be exported/used as singletons, not
classes instantiated ad hoc — CoreX has previously had a bug where these were exported as
constructors, silently dropping all live signals. When touching either engine, verify the export
shape explicitly.



