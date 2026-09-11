# CoreX — Strategy Subsystem Architecture & Performance Audit (Issue #5 / Strategy Engine)

> **Status:** Read-Only Audit & Inventory Report
> **Target:** Grounding the eventual `corex-strategy-engine` extraction in real code without assumptions or speculation.
> **Date:** 2026-09-11

---

## 1. Full File Inventory — Strategy Subsystem

The strategy subsystem spans loader components, execution pipelines, runtime management modules, workers, base classes, security validators, and strategy utilities. Below is the complete file inventory with line counts, dependencies, and responsibilities.

### Loader & Compiler
1. **`engine/strategyLoader.js` (621 lines)**
   - *What it does:* Main orchestration service for loading, compiling, starting, stopping, and restarting user strategies. Manages strategy state persistence (`StrategyStateStore`), market data subscriptions, tick dispatching, and worker pool coordination.
   - *Depends on:* `strategyCompiler.js`, `StrategyStateStore`, `RuntimeRegistry`, `MarketFeed`, `workerPool.js`, `postgres.js`, logger.
   - *Depended on by:* `server.js`, `strategyManager.js`, `runtimeService.js`.

2. **`engine/core/loader/StrategyLoader.js` (141 lines)**
   - *What it does:* Core bootloader helper for parsing and instantiating strategy classes from database storage or file templates.
   - *Depends on:* `strategyCompiler.js`, `StrategyContract.js`, logger.
   - *Depended on by:* `strategyLoader.js`.

3. **`engine/services/strategyCompiler.js` (295 lines)**
   - *What it does:* Compiles strategy source code from strings into executable JS constructor functions/classes via `_loadModuleFromString` (`Module._compile`), validating AST safety (assumes security scan passed) and extracting metadata/schema via temporary instantiation (`validateAndExtractClass`).
   - *Depends on:* `acorn`, `StrategyContract.js`, `StrategyIntrospection.js`, logger.
   - *Depended on by:* `strategyLoader.js`, `StrategyLoader.js`.

### Contracts & Base Classes
4. **`engine/core/strategy/StrategyContract.js` (225 lines)**
   - *What it does:* Defines the abstract strategy interface and static validation/adaptation methods (`validate`, `adapt`, `validateAndAdapt`). Enforces presence of `generateSignal`, validates symbols, and guards against prototype pollution (`FORBIDDEN_PROPERTIES`).
   - *Depends on:* logger.
   - *Depended on by:* `strategyCompiler.js`, `StrategyLoader.js`, `BaseStrategy.js`.

5. **`utils/BaseStrategy.js` (476 lines)**
   - *What it does:* Abstract base class for user strategies. Provides reactive lifecycle hooks (`init`, `generateSignal`, `onMarketData`, `teardown`), indicator convenience methods, order submission helpers (`buy`, `sell`, `close`), state store access (`this.state`), and data lookback wrappers (`this.data.getLookbackWindow`).
   - *Depends on:* `StrategyContract.js`, `IndicatorAdapter.js`, `StrategyDataManager.js`, `StrategyPositionManager.js`, `StrategyStateStore.js`, logger.
   - *Depended on by:* User strategy implementations.

### Pipeline Engines
6. **`engine/core/pipeline/SignalGenerationEngine.js` (248 lines)**
   - *What it does:* Executes the strategy's `generateSignal` method on incoming market packets (ticks/bars), managing lookback warmup, error isolation, and signal packet formatting.
   - *Depends on:* `RuntimeRegistry`, `strategyLoader.js`, logger.
   - *Depended on by:* `runPipeline.js`, `MarketFeed.js`.

7. **`engine/core/pipeline/SignalProcessingEngine.js` (70 lines)**
   - *What it does:* Portfolio risk validation gate (`_validateRisk`). Checks drawdown thresholds (`maxDrawdownThresholdPct = 10.0`), daily loss limits, and position conflict/scaling rules.
   - *Depends on:* `RuntimeRegistry`, logger.
   - *Depended on by:* `runPipeline.js`, `RiskGateway.js`, `BaseBroker.js`.

8. **`engine/core/pipeline/SignalExecutionEngine.js` (96 lines)**
   - *What it does:* Routes accepted validated trading intents to the runtime broker instance (`broker.handle()`) and records metrics.
   - *Depends on:* `RuntimeRegistry`, logger.
   - *Depended on by:* `runPipeline.js`.

9. **`engine/core/pipeline/runPipeline.js` (111 lines)**
   - *What it does:* Orchestrates the three-stage pipeline (`SignalGenerationEngine` → `SignalProcessingEngine` → `SignalExecutionEngine`) for a given market tick/bar packet.
   - *Depends on:* `SignalGenerationEngine`, `SignalProcessingEngine`, `SignalExecutionEngine`, logger.
   - *Depended on by:* `MarketFeed.js`, `strategyLoader.js`.

10. **`engine/core/pipeline/SignalPipelineUtils.js` (53 lines)**
    - *What it does:* Helper utilities for signal packet formatting and validation.
    - *Depends on:* logger.
    - *Depended on by:* Pipeline engines.

11. **`engine/core/pipeline/SocketXRiskEngine.js`**
    - *What it does:* Bridges Socket_X command validation into `SignalProcessingEngine`.
    - *Depends on:* `SignalProcessingEngine`.
    - *Depended on by:* `RiskGateway.js`.

### Runtime Management & Workers
12. **`engine/modules/strategyRuntime/index.js` (53 lines)**
    - *What it does:* Module export wrapper for strategy runtime execution facilities.
    - *Depends on:* `workerPool.js`.
    - *Depended on by:* `engine.js`.

13. **`engine/modules/strategyRuntime/workerPool.js` (202 lines)**
    - *What it does:* Manages a background child process (`child_process.fork()`) running `strategyWorker.js` via IPC for isolated strategy execution, request timeouts, and automatic worker restarts.
    - *Depends on:* `child_process`, `crypto`, logger.
    - *Depended on by:* `strategyLoader.js`.

14. **`engine/workers/strategyWorker.js` (181 lines)**
    - *What it does:* Child process execution entry point that loads strategies in a sandboxed subprocess and responds to IPC messages (`LOAD_STRATEGY`, `EXEC_TICK`, etc.).
    - *Depends on:* `strategyCompiler.js`, `StrategyContract.js`, logger.
    - *Depended on by:* `workerPool.js`.

15. **`engine/core/runtime/RuntimeLifecycle.js` (305 lines)**
    - *What it does:* Manages the lifecycle of active runtimes (initializing broker factories, market data bindings, and pipeline wiring).
    - *Depends on:* `RuntimeBrokerFactory`, `RuntimeRegistry`, `MarketFeed`, logger.
    - *Depended on by:* `server.js`, `strategyLoader.js`.

16. **`engine/core/runtime/RuntimeRegistry.js` (123 lines)**
    - *What it does:* In-memory registry mapping runtime IDs (`userId::strategyName::symbol::mode`) to active runtime contexts, broker instances, and strategy references.
    - *Depends on:* logger.
    - *Depended on by:* Pipeline engines, `RuntimeLifecycle.js`, `strategyLoader.js`.

17. **`engine/signalAdapter.js` (50 lines)**
    - *What it does:* Adapts raw signals or strategy output structures into canonical order intents.
    - *Depends on:* logger.
    - *Depended on by:* Pipeline.

### Security & Utilities (`utils/`)
18. **`utils/security.js` (262 lines)**
    - *What it does:* Static AST security scanner using `acorn` and `acorn-walk`. Validates strategy code against forbidden globals, dangerous module requires, infinite loops, prototype pollution, and dynamic code execution.
    - *Depends on:* `acorn`, `acorn-walk`, `logger`.
    - *Depended on by:* `strategyLoader.js`.

19. **`utils/strategy/` Subfolder Inventory (15 files)**
    - `index.js` (13 lines): Re-exports strategy utility classes.
    - `IndicatorAdapter.js` (72 lines): Wraps technical indicator calculations.
    - `Position.js` (146 lines): Position data model and PnL calculation helper.
    - `RuleChain.js` (150 lines): Composable entry/exit rule evaluation chain.
    - `StrategyDataManager.js` (132 lines): Manages OHLCV candle buffers via `CircularBuffer` and tick updates.
    - `StrategyDevHelpers.js` (131 lines): Developer diagnostic helpers for strategy execution.
    - `StrategyIntrospection.js` (24 lines): Extracts strategy API schema and capabilities.
    - `StrategyManifest.js` (396 lines): Strategy configuration manifest parser and validator.
    - `StrategyParamUtils.js` (321 lines): Strategy parameter definition, validation, and optimization helpers.
    - `StrategyPluginRegistry.js` (30 lines): Plugin extension registry for strategies.
    - `StrategyPositionManager.js` (246 lines): Manages open positions, stops, targets, and fills per strategy session.
    - `StrategyRuntimeUtils.js` (149 lines): Runtime utility functions for strategy context.
    - `StrategySignalUtils.js` (107 lines): Signal generation helper functions.
    - `StrategyStateStore.js` (142 lines): Key-value state store with 5s debounced async flush callback.
    - `StrategyValidator.js` (535 lines): Comprehensive strategy schema and input validator.

---

## 2. Data Structure Audit — The Performance Question

### Data Structures for OHLCV / Tick History
- **Confirmed:** OHLCV candles are stored in a fixed-capacity **Circular Buffer** (`CircularBuffer` in `StrategyDataManager.js:9-46`), implemented using a preallocated backing `Array(capacity)` (`StrategyDataManager.js:12`), NOT a typed array (`Float64Array`).
- **Confirmed:** Individual candles are stored as plain JS objects (`{ time, open, high, low, close, volume }`) (`StrategyDataManager.js:87-90`).

### Rolling Windows & History Management
- **Confirmed:** Lookback windows and historical bars use `CircularBuffer.last(n)` (`StrategyDataManager.js:31-41`), which indexes into the circular buffer in $O(n)$ time without calling `Array.shift()` or `Array.push()` on dynamic arrays, preventing V8 re-indexing and memory reallocation overhead.

### Hot Path Allocations
- **Confirmed:** In `StrategyDataManager.updateTick()` (`StrategyDataManager.js:73-102`), incoming ticks update the `activeCandle` in place by direct property mutation (`c.high = price; c.low = price; c.close = price; c.volume += volume;`) without object spreading or temporary allocation, keeping GC pressure low on the tick hot path.
- **Confirmed (Minor Allocation):** `CircularBuffer.last(n)` allocates a new array (`new Array(count)`) when returning recent items (`StrategyDataManager.js:35`), and `ingestBar()` uses object spreading (`{ ...bar }`) (`StrategyDataManager.js:110`), but these occur primarily during historical backfill or bar closure, not per incoming tick.

### Persistence Performance (`StrategyStateStore`)
- **Confirmed:** `StrategyStateStore` (`StrategyStateStore.js:30-140`) uses synchronous in-memory `Map` lookups for `get()` and `set()`. Database persistence is debounced by 5 seconds (`FLUSH_DEBOUNCE_MS = 5000`, `StrategyStateStore.js:28`) via `setTimeout` and flushed asynchronously (`_persist()`, `StrategyStateStore.js:130-139`). It does **not** block or slow down the hot strategy execution path.

---

## 3. Contract Enforcement Audit

- **Confirmed:** `StrategyContract` is strictly enforced at compile time. In `strategyCompiler.js:127`, `StrategyCompiler.validateAndExtractClass()` invokes `StrategyContract.validate(tmp)` on a temporary strategy instance. If validation fails (`!contractCheck.ok`), compilation is rejected immediately before execution.
- **Comparison with `DataProviderContract` & `BrokerContract`:**
  - `DataProviderContract` enforces implementation via `validateProviderImplementation()` which checks that concrete subclasses override required methods.
  - `BrokerContract` defines abstract throwing methods.
  - `StrategyContract` uses `validateAndAdapt()` (`StrategyContract.js:78-94`), which both validates required methods (`generateSignal`) and **automatically adapts** legacy methods (`next`, `onBar`, `onTick`, `onMarketData`) into the canonical `generateSignal()` interface (`StrategyContract.js:103-118`), providing robust backwards compatibility alongside strict validation.

---

## 4. Security Scanner Audit (`utils/security.js`)

### Blocklist Inventory (`utils/security.js:33-57`)
- **Dangerous Globals:** `eval`, `Function`, `setTimeout`, `setInterval`, `setImmediate`, `clearTimeout`, `clearInterval`, `process`, `global`, `globalThis`, `root`, `constructor`, `__proto__`, `__defineGetter__`, `__defineSetter__`, `Buffer`, `SharedArrayBuffer`, `ArrayBuffer`, `Proxy`, `Reflect`, `Symbol`, `WebAssembly`.
- **Dangerous Modules (Blocked Requires):** `fs`, `fs/promises`, `child_process`, `cluster`, `net`, `tls`, `dgram`, `http`, `https`, `http2`, `os`, `path`, `vm`, `module`, `crypto`, `worker_threads`, `perf_hooks`, `inspector`, `repl`, `readline`, `stream`, `buffer`, `dns`, `url`, `querystring`.
- **Allowed Modules:** `mathjs`, `technicalindicators`, relative paths (`./`, `../`), and `BaseStrategy`.

### Potential Gaps / Limitations
- **Uncertain / Risk:** Static AST analysis via Acorn can occasionally be bypassed by complex obfuscation, dynamic property access (e.g., `global['pro' + 'cess']`), or indirect constructor access if not caught by traversal visitors. While `utils/security.js` blocks direct identifier references and `__proto__` / `constructor` member expressions, rigorous sandboxing ultimately relies on running strategy worker processes under restricted privileges (`workerPool.js` / `strategyWorker.js`).
- **Distinction on Test Failures:** The 3 failing security tests in `test/round7.comprehensive.test.js` (`eval is blocked`, etc.) fail due to a **test fixture syntax bug** (the test helper `wrap()` embeds raw code snippets like `eval('1+1')` without a trailing semicolon before `return null;`, causing Acorn to throw a syntax error during parsing). **Confirmed:** This is strictly a test fixture authoring bug in `test/round7.comprehensive.test.js`, **not** a gap in the security scanner's enforcement logic.

---

## 5. Worker Pool / Scalability Audit (`workerPool.js`)

- **Confirmed:** `StrategyWorkerPool` (`workerPool.js:148`) spawns a **single background child process** via `child_process.fork(workerPath, [], { stdio: ..., env: { ... } })`.
- **Concurrency Model:** Isolation is **process-level** (one child process hosting strategy execution). All active strategies run concurrently within that single background process when worker mode is enabled (`COREX_STRATEGY_WORKER_ENABLED=1` or `NODE_ENV=production`), or directly in the main Node.js process during testing/development.
- **Bottlenecks:**
  - *CPU/Event Loop:* Because multiple strategies share a single child process event loop, a heavy compute-bound loop in one strategy can starve other strategies co-located in that worker.
  - *IPC Overhead:* Serializing market ticks and deserializing signal intents over IPC (`process.send()` / `process.on('message')`) introduces serialization/deserialization and messaging latency compared to in-process execution.
  - *Uncertain (Needs Load Testing):* Exact throughput limits and memory footprint per strategy under multi-strategy load require empirical benchmark testing.

---

## 6. Extensibility Audit — Pluggable Driver Pattern

### BrokerContract / RuntimeBrokerFactory Pattern
- **Confirmed:** Adding a new broker driver requires:
  1. Implementing a concrete driver class extending `BaseBroker` (conforming to `BrokerContract` methods: `submit`, `modify`, `cancel`, `query_status`).
  2. Registering the driver in `RuntimeBrokerFactory.js` (`DRIVER_REGISTRY` mapping and `switch (driverType)` handler).
  3. Instantiating via `RuntimeBrokerFactory.createBroker(mode, opts)`.
- **Confirmed (Universal Risk Enforcement):** Every broker driver (Backtest, Paper, Live/MetaApi) extends `BaseBroker`. All strategy trading signals are forced through **`BaseBroker.handle()`** (`BaseBroker.js:106-137`), which enforces the account risk floor (`_passesRiskFloor()`) and the injected risk validator (`SignalProcessingEngine.validateForCommand()`) as a mandatory, non-bypallable gate before any order is submitted to a driver.

### DataProviderContract / DataProviderFactory Pattern
- **Confirmed:** Adding a new data provider requires:
  1. Implementing a concrete provider class conforming to `DataProviderContract` (`connect`, `subscribe`, `unsubscribe`, `fetchHistory`, `getCapabilities`, `getStatus`, `cleanup`).
  2. Registering the provider in `DataProviderFactory`.
  3. Emitting canonical ticks via the event bus (`EVENTS.MARKET.TICK`) normalized via `SymbolNormalizer`.

---
*Report compiled successfully. No code modified.*
