# CoreX — Known Issues & Accepted Test Baselines

This document records known issues, security limitations, and accepted test baselines. Findings remain open until their owning task is reviewed and closed.

## 1. Security Scanner Test Syntax Error (`test/round7.comprehensive.test.js`)

- **Affected Tests:**
  - `security.js — loop guards › eval is blocked`
  - `security.js — loop guards › require('fs') is blocked`
  - `security.js — loop guards › process access is blocked`
- **Root Cause:** The test helper function `wrap` in `test/round7.comprehensive.test.js` embeds strategy code snippets into a class method body without a trailing semicolon or newline separating expression statements from `return null;` (e.g. `next(bar) { eval('1+1') return null; }`). This causes Acorn to throw a syntax error (`Unexpected token`) during AST parsing in `validateStrategyCode()` before security blocklist assertions can evaluate.
- **Classification:** Category (b) — tests relevant security scanner rules, but broken by a test setup bug. Per project instructions, this is flagged here and left unfixed for now.

## 2. corex-strategy-engine Extraction — Incomplete Tasks

- **`utils/strategy/IncrementalIndicators.js`** — Phase B infrastructure files not yet deleted or moved. `IncrementalIndicators.js`, `StrategySignalUtils.js`, `StrategyDevHelpers.js`, `IndicatorAdapter.js`, `RuleChain.js`, `index.js` remain in `utils/strategy/` and should be moved or deleted now that the IndicatorRegistry and new indicator classes exist in the package.
- **`IndicatorManager.js` still imports `@utils/strategy/IncrementalIndicators`** on line 3. This should be removed as the registry now handles all indicator types.
- **`Strategy.js` not yet updated** with internalized imports (e.g., `require("./StrategyStateStore")` instead of `require("@utils/strategy/StrategyStateStore")`). Phase B internalization (decision 2026-09-12) moved these files into the package but the Strategy.js imports were not updated.
- **Phase D (spatial-culling gate)** and **Phase E (documentation)** described but not implemented — no file modifications made.

## 3. Socket_X Is Not Mounted / Execution Authority Is Fragmented

- `SocketXServer` is implemented and tested in `packages/corex-gateway` but is never instantiated or mounted by `engine/server.js`. Only `/ws` and `/mt5` WebSocket upgrades exist.
- `engine/core/engine.js` wires `RiskGateway.setRiskEngine(SocketXRiskEngine)` and the auth verifier, but never calls `RiskGateway.registerBroker()` for strategy runtimes. If Socket_X were mounted, `RiskGateway` would create a second broker via `RuntimeBrokerFactory`, independent of `RuntimeRegistry`.
- No accountId (`cx_pap_*` / `cx_liv_*`) to strategy `runtimeId` mapping exists.
- Classification: architecture gap requiring a separate, Owen-approved execution-authority task. Do not mount Socket_X without that design.
- Evidence: `plans/architecture/BROKER_OWNERSHIP_AND_SOCKETX_AUDIT.md` §6.

## 4. MT5 Has Two Unverified Transports

- HTTP polling: `broker/CorexReceiver.mq5` → `/api/mt5/next-order` + `/confirm-fill` (`engine/routes/mt5Controller.js`).
- WebSocket: `engine/managers/mt5Receiver.py` → `/mt5` (`packages/corex-broker-contract/src/mt5Bridge.js`) → `engine/services/liveOrderDispatcher.js`.
- Neither path has been verified end-to-end against a real MT5 terminal. `MetaApiConnector` is a skeleton that returns `success: true` without executing a trade; LIVE mode must not be considered verified.
- Classification: REQUIRES DECISION (transport choice) + human verification with Owen's credentials.

## 5. `RuntimeLifecycle.reattemptWarmup()` Reads the Wrong Entry Field

- `reattemptWarmup()` reads `entry.strategyInstance`, but `RuntimeRegistry.set()` stores `entry.instance`. The method always returns `false` and logs "No strategy instance".
- Pre-existing failing test: `test/runtime-lifecycle-provider.test.js` — "recovers warmup when provider becomes available after cold start" (expected `true`, received `false`).
- Classification: confirmed pre-existing bug, outside the P3-04 broker cleanup scope. Fix is likely `const strategyInstance = entry.instance;`, but it changes runtime recovery behavior and should be verified separately.

## 6. Lint Is Not Runnable in This Checkout

- `eslint.config.js` exists but `eslint` is not a dependency and there is no `lint` script in `package.json` or package manifests. `npx eslint` attempts to download ESLint 10.
- `node --check` was used for syntax verification of changed files.

## 7. Duplicate Broker-Cleanup Efforts in Flight

- Three independent efforts remove the same legacy broker paths: this branch (ix/p3-04-broker-ownership), PR #60 (efactor/broker-backtest-public-api, draft: BacktestBroker mirror + broker public API) and PR #26 (efactor(j8): retire the legacy broker/ tree, open).
- All three touch engine/backtestManager.js and roker/modes/BacktestBroker.js, so merging more than one will conflict and may leave two competing "authoritative" import paths.
- Classification: coordination debt. One effort must be designated authoritative (or rebased onto another) before any of them merges.

## 8. Runtime Ownership Is Per-Process

- `RuntimeRegistry` claims (creation reservations and deletion claims) are in-memory, so two engine processes sharing one database can each start the same runtime or delete the same strategy; cross-process ownership would need a DB-backed lease or advisory lock (not implemented: no evidence the deployment runs multiple engine instances). Within one process, claims are exclusive and fenced by token.
- Claims have no expiry by design: a claim is released by its owner (commit, rollback, abort, release) or by process exit, so a slow boot is never mistaken for a dead one. A process crash therefore leaves no in-memory claim to recover, but an interrupted boot that was already persisted as ACTIVE is not reconciled on restart yet (recoverable-state gap, not an ownership gap).
- Rollback cleanup is success/failure: a step that fails keeps its collaborator on the entry/reservation and ownership, so the identity stays STOPPING until `terminate()` completes it. Orphan destruction is limited to boots that never committed: `_destroyOrphaned()` destroys only the objects of a boot that never handed anything to the registry, and never mutates the registry. A committed boot that lost its entry destroys nothing further — destruction belongs to whoever owns/removes the entry, so nothing is destroyed twice (only reachable if claims ever expire or go cross-process).
- `stateController` is still read by the UI status path (`runtimeService.getStatus`/`getAllStatus`) while the registry is authoritative for lifecycle; the two can disagree until that read path is migrated.
- Evidence: `plans/Audit/ENGINE-01_STAGE_2_RUNTIME_OWNERSHIP.md`.

## 9. Strategy Source Shares Engine-Process Intrinsics (SEC-01)

- Strategy source is compiled with Node `vm.compileFunction()` by `engine/services/strategyModuleResolver.js`; the wrapper executes in the engine process's current global context, not an isolated context, worker, or process. `vm.compileFunction()` is not a sandbox.
- The AST scanner in `utils/security.js` blocks several globals but currently accepts assignments such as `Object.getPrototypeOf = ...` and `Object.getOwnPropertyDescriptor = ...`. This was reproduced: `validateStrategyCode()` accepted a source string that reassigns both methods.
- Such code can mutate process-wide built-ins and affect unrelated engine modules. The P1 guard now captures its own inspection intrinsics at module load and rejects Proxy objects, but that only protects the guard's own checks; it does not isolate strategy code or protect the rest of the process. A separate Node v22.20.0 reproducer showed `Object["con" + "structor"]("return process.getBuiltinModule('fs')")()` passes `validateStrategyCode()` and returns a working `fs` module through `loadStrategyModule()`; a strategy class using it also constructs. This accesses Node's process-global API without the injected `require` function.
- Classification: HIGH-IMPORTANCE SECURITY DESIGN / separate workstream. Requires a threat model, import-closure analysis, and reviewed isolation strategy. Do not silently expand P1 or assume `vm` alone is a security boundary. Track as SEC-01 in `plans/ROADMAP.md`; do not mark P1 or B3 as a sandbox.

## 10. Strategy Module-Resolution Bypasses (SEC-02 / B3)

- Before B3, the strategy compiler used `Module._compile()` with `Module._nodeModulePaths(process.cwd())`, exposing Node's normal CommonJS resolver rather than a strategy-owned allow-list. B3 replaces that path with a wrapper and an exact compiler-owned allow-list for the injected CommonJS `require` function.
- Reproduced on Node v22.20.0: the scanner accepts aliased `const load = require; load("fs")`, dynamic `import("node:fs")`, `require.resolve("fs")`, and an arbitrary package name containing the substring `BaseStrategy`.
- Before B3, the compile path successfully loaded `node:fs` through dynamic import, resolved `../../package.json` from the synthetic `db://strategies/...js` filename, and loaded `corex-strategy-engine/src/Strategy` through the root `module-alias` prefix mapping despite the scanner rejecting that literal subpath. B3's injected resolver now blocks these paths through its `require` parameter; SEC-01 still covers process-global execution escapes.
- The current `utils/template.txt` still generates `@utils/BaseStrategy` imports. B3 must preserve only this exact temporary legacy specifier if compatibility requires it; P3 owns moving the template into the strategy package, and P5 owns deletion of the legacy BaseStrategy implementation. Do not retain substring matching.
- Classification: HIGH-IMPORTANCE SECURITY DEFECT / active B3 workstream. Evidence, bounded design and acceptance criteria are in `plans/tasks/B3-sandbox-module-resolution.md`. B3 restricts only the injected CommonJS `require` channel; it is not execution isolation and does not stop process-global APIs from loading modules. SEC-01 remains separate.

## 11. Strategy Worker Bypasses the AST Security Scanner (SEC-03)

- `engine/workers/strategyWorker.js` handles `LOAD_STRATEGY` by calling `compiler.compile(String(code || ""), strategyId)` directly. Unlike the main `engine/strategyLoader.js` paths (`_compileToClass()` and `instantiateFromSource()`), this worker path does not call `validateStrategyCode()` first.
- The path is not merely dead code: `engine/modules/strategyRuntime/workerPool.js` forks this worker, and `isEnabled()` defaults to enabled when `NODE_ENV === "production"` unless `COREX_STRATEGY_WORKER_ENABLED` explicitly overrides it. `engine/modules/strategyRuntime/index.js` sends `LOAD_STRATEGY` requests to the pool; `engine/core/engine.js` imports that runtime module and uses its remote warmup path.
- Impact: strategies loaded through this worker skip the scanner's non-module checks (forbidden globals, dynamic import syntax, loop restrictions, and related AST rules). B3's compiler-owned exact resolver still constrains the injected `require()` function at runtime, but it does not replace those scanner checks, constrain process-global APIs, or provide execution isolation.
- Classification: HIGH-IMPORTANCE SECURITY DEFECT / separate follow-up. Do not silently expand B3 into worker lifecycle or validation-pipeline redesign. Scope the worker's validation ownership, error handling, and tests separately; SEC-01 remains the broader execution-isolation workstream.
