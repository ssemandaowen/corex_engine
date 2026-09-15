# CoreX — Strategy Engine Gap Analysis & Package Architecture

> **Status:** Review Only (No code changes in this task)  
> **Document:** `plans/Audit/corex-strategy-engine-gap-analysis.md`  
> **Target Package:** `packages/corex-strategy-engine`  
> **Author:** Kilo Agent / CoreX Engineering  

---

## 1. Hot-Path Performance Bug in `utils/DeclarativeStrategy.js`

### 1.1 The Finding
In the proof-of-concept `utils/DeclarativeStrategy.js`, the internal context-assembly method `_buildCtx(packet, isBar)` executes on **every single tick and bar**. Inspection of lines 203–265 reveals a major hot-path allocation regression:

```javascript
// utils/DeclarativeStrategy.js:203-210
let currI = this.constructor;
let StaticIndicators = {};
while (currI && currI !== BaseStrategy && currI !== Object) {
    if (currI.indicators) {
        StaticIndicators = { ...currI.indicators, ...StaticIndicators };
    }
    currI = Object.getPrototypeOf(currI);
}
```

### 1.2 Exact Allocation Cost per Tick
For every tick processed by `_buildCtx()`:
1. **Prototype Chain Walking:**
   - Calls `Object.getPrototypeOf(currI)` across 2–3 inheritance levels (`ChildStrategy` → `DeclarativeStrategy` → `BaseStrategy`) on every tick.
2. **Object Spread & Dynamic Objects:**
   - Allocates `StaticIndicators = {}` on every tick.
   - Allocates a new spread object `{ ...currI.indicators, ...StaticIndicators }` at each inheritance level.
3. **`Object.entries` Iteration:**
   - Calls `Object.entries(this._incrementalIndicators)` twice per tick:
     - 1st call (lines 212–222): Allocates 1 outer array + $K$ 2-element tuple arrays (where $K$ is the number of declared indicators).
     - 2nd call (lines 225–227): Allocates another outer array + $K$ 2-element tuple arrays.
   - For a strategy with 3 indicators (e.g. EMA, RSI, ATR), this allocates **8 ephemeral arrays per tick**.
4. **Proxy & Context Allocation:**
   - Allocates `const indicatorsProxy = {}` (1 object).
   - Allocates `const ctx = { ... }` (1 root object).
   - Allocates nested `position: { ... }` (1 object).
   - Allocates nested `engine: { ... }` (1 object).
   - Allocates nested `go: { ... }` (1 object).
   - Allocates 4 closure functions inside `go` (`long`, `short`, `scale`, `protect`), each binding `self`, `close`, and `symbol`.
   - Allocates 1 closure function `flat()`, binding `self` and `symbol`.
5. **Double Execution on Startup:**
   - On the first tick/bar during initialization (`!this._initialized`), `_processData` calls `_buildCtx` on line 272 for `onStart(ctxInit)` and calls `_buildCtx` **again** on line 300 for `onTick`/`onBar`, doubling the overhead.

### 1.3 Cumulative Cost Summary
| Metric | Cost per Single Tick (3 Indicators) | Cost per 100,000 Ticks (Backtest / Session) |
|---|---|---|
| **Objects & Tuples Allocated** | ~16 objects / arrays | **1,600,000 heap allocations** |
| **Closures Allocated** | 5 functions (`go.*`, `flat`) | **500,000 function allocations** |
| **Prototype Walks** | 2 `Object.getPrototypeOf()` calls | **200,000 prototype lookups** |

This allocation overhead directly contradicts CoreX's Phase 1 zero-allocation milestones (`SoACandleStore` typed array storage and `IncrementalIndicators` O(1) state updates).

### 1.4 Solution for `packages/corex-strategy-engine`
In the real package:
- `StaticIndicators` and `StaticParams` must be extracted and cached **once** at class loading / initialization time (`_ensureInitialized()`).
- `ctx` should be constructed with **reusable object structures** or initialized once on the instance, updating scalar fields (`position`, `price`, `barTime`) in-place.
- Command methods (`ctx.go.long`, `ctx.flat`, etc.) must be created **once** on the prototype or during initialization, not instantiated as ephemeral closures on every tick.

---

## 2. Comprehensive Audit of `utils/strategy/*` vs `DeclarativeStrategy`

| File | Responsibility | Category | Evaluation & Migration Action |
|---|---|---|---|
| **`StrategyPluginRegistry.js`** (30 lines) | Global in-memory registry for strategy plugin modules (`register`, `unregister`, `get`, `list`). Called by legacy `BaseStrategy.use()` and `applyPlugins()`. | **Intentionally Left Behind** | No active, example, or database strategy uses this mechanism (0 matches in DB). Porting this to the new engine would introduce dead code. |
| **`StrategyValidator.js`** (535 lines) | Pre-flight validation rules inspecting class structure, required entrypoints (`next`, `onMarketData`), parameter schemas, TechnicalIndicators naming, anti-patterns (unguarded throws, console.log), and lookback limits. | **Genuine Gap (Needs Integration)** | Currently hardcoded to enforce legacy conventions (requires `next()` or `defineSchema()`). Must be extended to recognize `static params`, `static indicators`, and `onStart`/`onBar`/`onTick`/`onFill`/`onStop` lifecycle hooks so valid declarative strategies pass validation without false warnings. |
| **`StrategyManifest.js`** (396 lines) | Manifest metadata generator powering Monaco editor autocomplete, hover tooltips, and method documentation in the frontend UI. | **Genuine Gap (Needs Integration)** | Documents legacy methods (`this.entryLong()`, `this.series()`, `this.indicators.EMA.calculate()`). It has zero awareness of `ctx.ta.*`, `ctx.util.*`, `ctx.go.*`, `ctx.indicators.*`, or declarative lifecycle hooks. Needs updating so Monaco provides accurate intelligence for declarative strategies. |
| **`StrategyIntrospection.js`** (24 lines) | Utility (`getStrategyApi`) walking prototype chains to extract public callable strategy methods; populates `instance.__corexApi` for runtime introspection. | **Already Covered** | `StrategyContract.adapt()` automatically invokes `getStrategyApi(instance)`. Operates generically on any class prototype and works seamlessly with `DeclarativeStrategy`. |
| **`RuleChain.js`** (150 lines) | Fluent conditional rule DSL (`this.rule().when().and().then().else().enterLong()`) with bar-time pinning and lazy condition evaluation. | **Intentionally Superseded** | The declarative authoring model replaces chain DSL syntax with idiomatic JS (`if (ctx.ta.crossover(ctx.indicators.fast, ctx.indicators.slow)) return ctx.go.long()`). Kept in legacy `BaseStrategy` for backwards compatibility, but not needed in the declarative core. |
| **`StrategyParamUtils.js`** (321 lines) | Parameter coercion, schema serialization (`serializeSchema`), patch application (`applyParamPatch`), and parameter diffing (`diffParams`). Converts parameter schemas to UI input fields. | **Genuine Gap (Needs Integration)** | `DeclarativeStrategy` only implemented basic default extraction and shallow `updateParams`. The frontend UI configuration panes depend on `serializeSchema()` and `applyParamPatch()` to render inputs and validate range bounds (`min`, `max`, `step`, `enum`). Static parameters must integrate with these schema utilities. |
| **`StrategyPositionManager.js`** (246 lines) | Tracks local position state, open lots, FIFO position reduction, realized PnL, and flip execution (`open`, `close`, `applyDelta`). | **Already Covered** | Inherited by `DeclarativeStrategy` from `BaseStrategy`. `ctx.position` exposes current position telemetry directly from this manager. |
| **`StrategyRuntimeUtils.js`** (149 lines) | Low-level order normalization: `_getTFMs()`, `_createSignal()`, `_resolveProtectionLevels()`, `_normalizeQuantity()`, `_resolveCurrentPrice()`, `sizePosition()`. | **Already Covered** | Inherited by `DeclarativeStrategy`. `ctx.go.long()` / `ctx.flat()` delegate through `this.buy()` / `this.sell()`, which utilize these utilities to format standard execution signals. |
| **`StrategySignalUtils.js`** (107 lines) | Array-based cross detection (`crossover`, `crossunder`, `above`, `below`, `rising`, `falling`, `pctChange`) with bar-time deduplication via `this._signalState`. | **Partially Covered / Needs Integration** | `DeclarativeStrategy` created a clean stateless `ta` helper for scalar values, but dropped the multi-call bar-gate deduplication (`autoKey` tracking in `this._signalState`). If a strategy evaluates a crossover multiple times within the same bar, signal deduplication logic must remain robust. |
| **`IndicatorAdapter.js`** (72 lines) | Single-tick caching proxy wrapper for batch calculations via the external `technicalindicators` npm package (`this.indicators.RSI.calculate()`). | **Intentionally Superseded** | Replaced by Phase 1 incremental indicators (`IncrementalEMA`, `IncrementalRSI`, `IncrementalATR`) and declarative `static indicators`. Batch calculations recomputing entire arrays on every tick are obsolete for primary declarative indicators. |
| **`Position.js`** (146 lines) | Individual position tracking object with weighted average entry price, lot array, and FIFO lot reduction math. | **Already Covered** | Sub-dependency of `StrategyPositionManager`. Carries forward unchanged. |

---

## 3. Deep-Dive: `StrategyPluginRegistry` Capability & Gap Assessment

### 3.1 What Capability Does It Provide Today?
`StrategyPluginRegistry.js` provides a registry pattern for dynamic strategy extensions:
- `StrategyPluginRegistry.register(name, plugin)` stores a `{ name, apply(strategy) }` object.
- In `BaseStrategy.js`:
  ```javascript
  use(plugin) {
      if (!plugin || typeof plugin !== "object") return;
      if (typeof plugin.apply === "function") plugin.apply(this);
      this._plugins.set(name, plugin);
  }
  ```
- Strategies can declare `definePlugins() { return ["pluginName", { ... }]; }` in their constructor to attach custom methods onto the strategy instance.

### 3.2 Real-World Usage in Database & Codebase
A comprehensive database and codebase audit confirmed:
- **Zero Database Strategies Use Plugins:** An inspection of all active and stored strategy scripts in the PostgreSQL `strategies` table confirmed `definePlugins` is present in **0 out of 7 strategies**.
- **Zero Registered Plugins:** No plugin has ever been registered into `StrategyPluginRegistry` in production or engine bootstrap code.
- **Unused Legacy Residue:** The plugin mechanism was an experimental feature that was never adopted.

### 3.3 Declarative Model Equivalent & Design Decision
In the new declarative architecture, custom helper logic is naturally provided via:
1. Pure utility modules imported directly by the strategy.
2. Extensions to `ctx.util` or custom indicator definitions in `static indicators`.
3. Strategy class inheritance (e.g. extending an intermediate user-defined base class).

**Design Decision:** `StrategyPluginRegistry` is dead code and should **NOT** be ported into `packages/corex-strategy-engine`. Retiring it cleans up the architecture without any breaking changes to real user strategies.

---

## 4. File-Split Plan for `packages/corex-strategy-engine`

Adhering to CoreX's one-concept-per-file convention, `packages/corex-strategy-engine` should be structured as follows:

```
packages/corex-strategy-engine/
├── package.json
├── index.js                     # Public API exports (Strategy, ta, util, ParamSchema)
├── src/
│   ├── Strategy.js              # Declarative Strategy base class (inherits BaseStrategy)
│   ├── ContextBuilder.js        # Reusable, zero-allocation-per-tick context builder
│   ├── ta.js                    # TradingView-style technical analysis helpers (crossover, crossunder, etc.)
│   ├── util.js                  # Quantitative & risk utilities (round, positionSize, etc.)
│   ├── ParamSchema.js           # Static schema parser, type coercion, and UI serialization
│   ├── IndicatorManager.js      # Manages incremental indicator instances & dynamic re-seeding
│   └── validation/
│       ├── StrategyValidator.js # Extended validator supporting declarative syntax
│       └── StrategyManifest.js  # Monaco editor manifest generator updated for ctx.*
└── test/
    ├── ContextBuilder.test.js   # Benchmarks verifying zero-allocation hot path
    ├── Indicators.test.js       # Calculation correctness unit tests across all 41 indicators
    ├── ParamSchema.test.js      # Parameter validation and schema serialization tests
    ├── PluggableRegistry.test.js # Pluggable indicator registry & zero core-file edit tests
    ├── Position.test.js         # O(1) incremental lot aggregation correctness tests
    ├── Strategy.test.js         # Integration tests through execution pipeline
    ├── ta.test.js               # Unit tests for TA math and crossover detection
    └── util.test.js             # Unit tests for position sizing and rounding
```

### Module Responsibilities
1. **`src/Strategy.js`**:
   - Houses the core `Strategy` (or `DeclarativeStrategy`) class.
   - Manages lifecycle hooks (`onStart`, `onBar`, `onTick`, `onFill`, `onStop`).
   - Handles startup configuration and broker integration via `BaseStrategy`.
2. **`src/ContextBuilder.js`**:
   - Replaces the ad-hoc `_buildCtx` method.
   - Pre-allocates and caches `ctx` sub-objects (`position`, `engine`, `go`, `flat`).
   - Updates scalar properties in-place per tick to guarantee near-zero GC allocations on hot paths.
3. **`src/ta.js`**:
   - Contains pure, thoroughly tested TA helpers (`crossover`, `crossunder`, `highest`, `lowest`, `rising`, `falling`, `change`).
4. **`src/util.js`**:
   - Contains starter utility functions (`round`, `positionSize`).
5. **`src/ParamSchema.js`**:
   - Integrates the validation and serialization capabilities from `StrategyParamUtils.js` for declarative static params.
   - Exposes `serializeSchema()` so the frontend UI can render parameter controls.
6. **`src/IndicatorManager.js`**:
   - Manages the lifecycle and re-seeding of `IncrementalEMA`, `IncrementalRSI`, and `IncrementalATR` instances when parameters update dynamically.

---

## 5. Compile-to-Instantiate Path & Packaging Constraints

### 5.1 Step-by-Step Path Trace
Tracing how strategy code moves from the PostgreSQL database to live execution:

```
[PostgreSQL DB: strategies.script_body]
               │
               ▼
1. strategyLoader._compileAndRegisterMeta(id, code, dbRow)
   ├── A. Security Scan: utils/security.validateStrategyCode(code)
   │      - Parses Acorn AST.
   │      - Blocks require('fs', 'child_process', 'worker_threads', etc.).
   │      - Verifies loop bounds and prototype pollution protection.
   │
   ├── B. Module Compilation: strategyCompiler._loadModuleFromString(code, id)
   │      - Uses Node.js `new Module(filename, module)._compile(code, filename)`.
   │      - Evaluates module export.
   │
   ├── C. Contract Adaptation: StrategyContract.adapt(tmpInstance)
   │      - Checks symbols array.
   │      - Injects generateSignal / onMarketData fallback shims.
   │      - Runs StrategyContract.validate(tmpInstance).
   │
   └── D. Schema Persistence:
          - Extracts parameter schema.
          - Updates `strategies.schema` JSONB column in PostgreSQL.
               │
               ▼
2. strategyLoader.startStrategy(id, options)
   ├── A. Class Instantiation:
   │      - `const instance = new meta.StrategyClass();`
   │      - Re-scopes symbol: `instance.symbols = [selectedSymbol];`
   │      - Merges default params, saved DB params, and runtime override params into `instance.params`.
   │      - Restores persistent state from `strategies.runtime_state_data` into `instance.state`.
   │
   └── B. Lifecycle Handover:
          - Spawns `RuntimeLifecycle.boot({ runtimeId, strategyInstance: instance, profile })`.
               │
               ▼
3. RuntimeLifecycle.boot()
   ├── A. Exclusivity Verification:
   │      - Validates (accountId, symbol, mode) uniqueness in `RuntimeRegistry`.
   │
   ├── B. Broker Allocation:
   │      - `RuntimeBrokerFactory.createBroker(mode, { ... })`.
   │      - Calls `strategyInstance._attachRuntime({ broker, mode, runtimeId, symbol })`.
   │
   ├── C. Warmup & Market Feed:
   │      - Pre-loads historical lookback candles into `strategyInstance.dataManager`.
   │      - Attaches `MarketFeed.subscribe(runtimeId, symbol)`.
               │
               ▼
4. MarketFeed Event Loop Dispatch
   - Inbound ticks / bars invoke `strategyInstance.onMarketData(packet, { source: "tick"|"bar" })`.
   - Returns signal object to `SignalProcessingEngine` → `SignalExecutionEngine` → `broker.handle()`.
```

### 5.2 Specific Packaging Constraints
1. **Export Shape Constraint:**
   - Strategy code is compiled via Node's internal `Module._compile` under CommonJS semantics.
   - The strategy script **must** export the class via `module.exports = StrategyClass;`. Named exports or non-class default exports will fail `strategyCompiler.validateAndExtractClass` (`typeof StrategyClass !== "function"`).
2. **Path Alias / Import Constraint:**
   - Existing DB strategies import `@utils/BaseStrategy`.
   - To ensure zero breakage of existing DB strategies during package transition:
     - The package must be mapped in `package.json` under `_moduleAliases` and Jest's `moduleNameMapper` (e.g. `@core/strategy-engine` or `@strategies/core`).
     - A backwards-compatible shim must remain at `utils/BaseStrategy.js` and `utils/DeclarativeStrategy.js` re-exporting from the new package.
3. **Static Schema Compatibility Constraint:**
   - `strategyLoader` and `strategyCompiler` expect to read parameter definitions during compile time to store them in `strategies.schema` for UI rendering.
   - The new package must expose static parameter declarations in a shape that can be converted by `ParamSchema.serializeSchema()` so the frontend settings pane continues to render parameter controls without requiring a schema migration.
4. **Contract Method Compatibility:**
   - `MarketFeed.js` explicitly invokes `instance.onMarketData(packet, context)` on every incoming tick/bar.
   - `Strategy.prototype.onMarketData` must remain the canonical entrypoint that routes incoming packets to `onBar` or `onTick`.

---

## 6. Summary of Actionable Decisions Before Implementation

1. **Retire `StrategyPluginRegistry`:** Confirm that `StrategyPluginRegistry` is formally deprecated and will not be carried into `corex-strategy-engine`.
2. **ContextBuilder In-Place Mutation:** Implement `ContextBuilder` with persistent `ctx` references and scalar in-place updates to fix the 16-object-per-tick allocation bug.
3. **Static Schema Serialization:** Ensure `static params` declarations compile to the `serializeSchema()` structure required by PostgreSQL and the frontend UI.
4. **Shim Architecture:** Retain `utils/BaseStrategy.js` and `utils/DeclarativeStrategy.js` as lightweight re-export shims pointing to `packages/corex-strategy-engine` to guarantee 100% backward compatibility for existing database strategies.
