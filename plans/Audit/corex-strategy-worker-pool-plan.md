# CoreX — Strategy Worker-Pool Scalability Plan

> **Status:** Draft / Review Only (No implementation code written in this task)
> **Author:** Kilo Agent / CoreX Engineering

---

## 1. Current Bottleneck Specifics & Real Load Requirements

### 1.1 Current Architecture & Bottleneck
As identified in the CoreX strategy engine audit (`plans/Audit/corex-strategy-engine-audit.md`), the current "worker pool" (`engine/modules/strategyRuntime/workerPool.js` and `engine/workers/strategyWorker.js`) is architecturally a **single shared child process** (`child_process.fork()`) handling all active strategies concurrently within one Node.js event loop.

- **Event Loop Starvation:** Because multiple user strategies share a single background process event loop, a computationally intensive loop, heavy indicator recalculation, or synchronous array manipulation in one strategy starves all other co-located strategies.
- **IPC Serialization Overhead:** Every tick, bar, and parameter update is serialized via IPC (`process.send()`) to the single worker process and back, creating serialization/deserialization pressure on the IPC channel.
- **Fault Domain Risk:** An unhandled exception or fatal memory issue in the shared worker process can disrupt all active strategies simultaneously.

### 1.2 Realistic Expected Load for CoreX
For CoreX's target operational profile (proprietary algorithmic trading engine supporting multiple tenants, user accounts, and parallel trading strategies):
- **Concurrent Runtimes:** A realistic production scale is **10 to 50 active strategy runtimes** running concurrently across various symbols and timeframes.
- **Throughput:** High-frequency ticks or multi-symbol bar closes arriving simultaneously across 50 strategies require predictable, isolated execution latency (<5ms per tick dispatch).
- **Conclusion:** A single shared worker process is insufficient for multi-tenant isolation and CPU-bound fairness at this scale.

---

## 2. Scalability Architecture Options & Tradeoffs

To replace the single-process bottleneck, we evaluate three architectural patterns:

### Option A: Bounded Pool of N Worker Processes (Round-Robin / Load-Balanced)
- **Description:** Maintain a configurable pool of $N$ persistent child processes (`child_process.fork()`). When a strategy runtime boots, it is assigned to a worker via round-robin or least-loaded strategy count.
- **Pros:** 
  - Bounds total OS process overhead ($N$ processes instead of 1-per-strategy).
  - Isolates heavy computational loads across $N$ independent event loops.
- **Cons:** 
  - Inter-strategy fairness is still imperfect if two heavy strategies land on the same worker process.
  - Requires request routing and load-balancing logic in the coordinator.

### Option B: One Process per Active Runtime (Isolated Runtime Process)
- **Description:** Spawn a dedicated child process for each active strategy runtime upon boot (`RuntimeLifecycle.boot()`), terminating the process upon `terminate()`.
- **Pros:** 
  - **Maximum Isolation:** Absolute fault domain separation (a crash or CPU starve in Strategy A has zero impact on Strategy B).
  - Simplest routing logic (1:1 mapping between runtimeId and child process).
- **Cons:** 
  - Higher memory and OS process overhead if running 50+ concurrent runtimes (each Node child process baseline memory footprint is ~30MB–50MB).

### Option C: Node.js `worker_threads` Instead of `child_process`
- **Description:** Use `worker_threads` to run strategies in separate threads within the main Node.js process (or a pool of thread workers).
- **Pros:** 
  - Significantly lower memory overhead than separate child processes (shared heap/v8 isolate characteristics or lightweight thread instances).
  - Fast message passing via `SharedArrayBuffer` or structured clone.
- **Cons:** 
  - **Security & Sandboxing Risk:** Node.js `worker_threads` share the same process memory address space and V8 instance internals. While module requires can be restricted, full process isolation and crash containment are weaker than `child_process`.
  - CoreX's existing security AST validator (`utils/security.js`) explicitly blocks `worker_threads` to prevent sandbox escapes.

### Recommendation
**Option A (Bounded Pool of N Worker Processes)** or **Option B (One Process per Active Runtime)** are the viable production candidates, depending on target resource limits. Given CoreX's security mandate and process-level sandboxing, separate processes (`child_process`) are preferred over `worker_threads`.

---

## 3. Evaluation of the Disruptor / Lock-Free Ring Buffer Pattern

### Is the LMAX Disruptor / Lock-Free Ring Buffer Pattern Justified at CoreX's Scale?
- **Theoretical Appeal:** In ultra-low-latency systems (e.g., matching engines processing millions of orders per second), lock-free ring buffers eliminate mutex contention and OS scheduling jitter.
- **CoreX Reality & Evidence:**
  1. **Bottleneck is CPU/JS Execution, Not Queue Contention:** CoreX strategy runtimes execute JavaScript strategy code (`onBar`, `onTick`, indicators). The execution time of strategy business logic dominates IPC message passing overhead.
  2. **Node.js Single-Threaded Event Loop per Worker:** Node.js processes execute JavaScript on a single thread per event loop. Within a worker process, concurrency is cooperative/event-driven, not multi-threaded. Therefore, multi-producer/multi-consumer lock-free ring buffers solve a problem (thread mutex contention in shared memory) that does not exist in Node.js IPC message passing.
  3. **IPC Overhead:** Node.js `child_process` IPC requires `JSON.stringify` / serialization and OS pipe writes. A lock-free ring buffer in JS cannot span across separate OS process boundaries without shared memory (`SharedArrayBuffer`), which brings synchronization complexity and security review overhead.
- **Verdict:** **Not Justified.** A simple bounded async queue (or standard worker task queue with backpressure) is entirely sufficient and maintainable at CoreX's scale.

---

## 4. Migration Path from Single-Process to Scalable Pool

A hard cutover carries unnecessary operational risk. We recommend an **incremental, feature-flagged rollout**:

1. **Phase 1: Abstract Worker Pool Interface**
   - Introduce a clean `StrategyExecutorPool` interface wrapping both the legacy single-process worker and the new multi-worker implementation.
2. **Phase 2: Feature Flag Rollout**
   - Introduce configuration flag `COREX_STRATEGY_POOL_MODE=single|bounded|isolated` (defaulting to `single` for backward compatibility).
3. **Phase 3: Bounded Pool Implementation & Testing**
   - Implement the bounded pool of $N$ workers in `engine/modules/strategyRuntime/workerPool.js`.
   - Run integration tests validating parallel execution without starvation.
4. **Phase 4: Gradual Default Switch**
   - Switch default mode to `bounded` in staging environments, monitor CPU/memory metrics, then promote to production default.

---

## 5. Explicit List of Decisions Needed from Owen Before Implementation

1. **Concurrency Model Selection:** Does Owen prefer **Option A** (bounded pool of $N$ worker processes, e.g., $N = 4$ or $8$) or **Option B** (dedicated child process per active runtime)?
2. **Resource Limits:** What is the maximum expected number of concurrent production strategy runtimes per server instance (to size process limits and memory thresholds)?
3. **Rollout Timeline:** Should worker pool scalability be prioritized immediately, or scheduled after ongoing modularization work (Package extractions)?
