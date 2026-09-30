# Worker Pool: Dual Registry Issue (Open, Must Be Resolved Before Future Wiring)

**Date:** 202-09-30
**Status:** Open issue. Documented only — deliberately NOT fixed in this task.
**Scope:** Analysis of two unconnected sources of truth for "which strategies are active".

---

## 1. The Issue

There are two independent trackers for the same concept — "a strategy is loaded and active":

| Tracker | Location | Status | Scope |
|---|---|---|---|
| `RuntimeRegistry` | `engine/core/runtime/RuntimeRegistry.js` | **Real and live.** Used by `RuntimeLifecycle`, WebSocket broadcasting, and the rest of the engine. Keyed by the canonical `runtimeId` = `userId::strategyName::symbol::mode`. | The authoritative runtime state. |
| `activeStrategies` | `engine/workers/strategyWorker.js:16` (`const activeStrategies = new Map()`) | **Dormant.** Lives inside the forked worker child process. Only reachable through the `workerPool.js` path, which is itself never invoked. | Private, per-worker, process-local. Not visible to any other part of the engine. |

The two have no connection whatsoever. The worker's `activeStrategies` map is not
read, written, mirrored to, or reconciled with `RuntimeRegistry` at any point. There is
no synchronisation, no reconciliation, and no shared key space.

## 2. Why It Is Not Currently a Live Bug

`engine/modules/strategyRuntime/workerPool.js` is never invoked from any HTTP route,
`RuntimeLifecycle`, or any live execution path. Because the worker is only reachable
through that dormant pool, its `activeStrategies` map is never populated and never
consulted. The two trackers cannot disagree about anything that matters, because the
second tracker never has anything in it.

See `plans/Audit/worker-pool-cost-scaling-analysis.md` for why the pool is intentionally
dormant (measured ~2,370x per-tick latency penalty and a ~40 MB per-fork memory floor),
and `packages/corex-strategy-engine/AGENTS.md` for the intended future scope of the
mechanism (untrusted/third-party strategy sandboxing only).

## 3. Why It Becomes a Bug the Moment the Worker Is Wired

The moment any part of the engine decides to route a strategy through the worker pool,
`RuntimeRegistry` continues to believe it owns the authoritative view of that runtime
while the worker process independently believes it owns a different view. Any of the
following would then be possible, with no error raised anywhere:

- A strategy unloaded in `RuntimeRegistry` still present (and still executing) in the
  worker's map.
- A strategy reported as stopped by the engine still holding resources inside the worker.
- Two objects for the same logical runtime, diverging in state, with the engine reading
  the wrong one.
- The engine reporting a runtime as healthy while the worker has already lost or crashed
  the underlying instance.

Silent divergence of authoritative trading state is precisely the class of defect that
must not be allowed to ship.

## 4. Requirement for the future wiring task

**Whichever task wires this worker pool to anything real MUST resolve this first.**
Shipping a wired worker pool while two independent trackers exist is not acceptable.

The resolution must end with exactly one source of truth for "which strategies are
active". Two acceptable shapes, both of which are legitimate:

1. The worker reports its state back to `RuntimeRegistry`, and `RuntimeRegistry` remains
   the single authoritative tracker; or
2. Some other explicit design is chosen and documented, in which the ownership of
   runtime state is unambiguous.

**This note deliberately does not propose which mechanism to use.** That is a decision
for whoever performs the actual wiring, and it should be informed by the real use case
as it exists at that time (which is expected to be untrusted/third-party strategy
execution sandboxing) rather than decided in advance in a document written while the
path is still dormant.

## 5. Related Observation (not fixed, not in scope)

While writing the verification test for `WARMUP_BAR` in `engine/workers/strategyWorker.js`,
one further observation was made and is recorded here for the same future task, since it
is also only reachable through this dormant path:

`StrategyContract.adapt()` (`engine/core/strategy/StrategyContract.js`) installs a
`generateSignal` shim that calls `this.onMarketData(...)` when present, and then — only
if `onMarketData` is absent — installs an `onMarketData` shim that calls
`this.generateSignal(...)`. For a strategy class that implements neither method
explicitly, the two shims call each other. Executing such an instance (e.g. via
`WARMUP_BAR` or `EXEC_BAR` in the worker) recurses until the stack overflows.

This is not addressed here: it is outside the scope of the `WARMUP_BAR` error-semantics
fix, it is not observable in any live path, and changing `StrategyContract` would touch
an architectural boundary. It is recorded so the future wiring task considers it.

---

## 6. Related Documents

- `plans/Audit/worker-pool-cost-scaling-analysis.md` — why the pool stays dormant.
- `packages/corex-strategy-engine/AGENTS.md` — "Human verification required" section.
- `engine/core/runtime/RuntimeRegistry.js` — the authoritative registry.
- `engine/workers/strategyWorker.js` — the dormant worker.
- `engine/modules/strategyRuntime/workerPool.js` — the dormant pool.
