# CoreX — Phase 0 Closeout and Phase 1 Architecture Review

> Status: ACCEPT FOR OWEN REVIEW — FOLLOW-UP EVIDENCE LIMITS RECORDED — NO CODING AUTHORIZED
> Owner / final decision authority: Owen Ssemanda
> Roadmap authority: plans/COREX_DEVELOPMENT_PLAN.md
> Baseline reviewed: main at 435127546087f9d40486ea272cb337363ce0724e
> Purpose: turn the existing roadmap and verified repository evidence into one executable sequence, stop repeated audit polishing, and reach an approved implementation plan.

## 1. Decision and working rule

Do not create a competing roadmap. This task is an execution specification under the existing CoreX Development Plan.

The project remains in Phase 0 until the required current-state evidence has been reviewed. Phase 1 then approves the target system and migration sequence. No source-code implementation begins until Owen approves the architecture review.

The goal is not to complete every possible audit or make every document perfect. Close only the evidence gaps that could change domain ownership, public contracts, persistence, runtime correctness, security, or migration order. Record other gaps as bounded follow-up work.

Independent review returned REVISE. Findings and required plan corrections are recorded in [P1-00 review — 2026-11-01](../reviews/P1-00-review-2026-11-01.md). Treat that review as source evidence supplied for this planning pass; claims depending on uninspected files remain VERIFY.

## 2. Repository investigation — verified current position

### 2.1 Phase 0 status

| Task | Current evidence | Required action |
|---|---|---|
| P0-01 | Accepted by Owen; PR #53 merged as a97ae6359b0d1b960b19368e2bbff476e16b4405 | Keep DONE |
| P0-02 | Backend ownership map exists on audit/p0-02-backend-ownership; latest reported revision 9d57881b0b5b570b5390f4cf94bdbe3af2ac27f4 | Independent review, resolve only material evidence gaps, then transplant accepted docs onto current main |
| P0-03 | PR #49 contains a frontend overhaul audit/plan, but not the exact FRONTEND_OWNERSHIP_MAP.md deliverable required by P0-03 | Reuse its verified observations; complete a focused view-to-data-source/state-owner map |
| P0-04 | No accepted INTEGRATION_CONTRACT_MAP.md located on main | Trace the critical product flows and their HTTP/WS contracts |
| P0-05 | No accepted PERSISTENCE_AND_RUNTIME_AUDIT.md located on main | Trace table ownership, job lifecycle, runtime state, cancellation and recovery |
| P0-06 | Quality baseline is on followup/p0-06-verification; latest reported revision 31c8c5e34bc7140077f05306aa02d904afdce1a4 | Review the baseline honestly; keep unrun diagnostics as follow-up. Review the package.json test:auth correction separately from the documentation audit |
| P0-07 | No accepted BRANCH_AND_PLAN_RECONCILIATION.md located on main | Review only materially relevant open PRs/branches and classify their disposition |

Related evidence:
- PR #49: https://github.com/ssemandaowen/corex_engine/pull/49
- PR #51: https://github.com/ssemandaowen/corex_engine/pull/51
- PR #53: https://github.com/ssemandaowen/corex_engine/pull/53
- P0-02 review branch: audit/p0-02-backend-ownership
- P0-06 follow-up branch: followup/p0-06-verification

Important: PR #49 is a broad 35-file branch, not a clean substitute for the P0-03 deliverable. PR #51's README is useful code-derived evidence, but its test counts are explicitly Jules-reported and not independently backed by a saved terminal log or passing CI run. Neither PR is automatically accepted by this plan.

### 2.2 Current application structure observed in source

The repository is a transitional modular monolith:
- Application entry and boot: index.js.
- HTTP and WebSocket transport: engine/server.js.
- Main engine composition/orchestration: engine/core/engine.js.
- Strategy discovery/compilation/restore: engine/strategyLoader.js and strategy package modules.
- Runtime registry/lifecycle: engine/core/runtime/RuntimeRegistry.js and RuntimeLifecycle.js.
- Market feed implementation: packages/corex-market-data/src/MarketFeed.js; engine/core/runtime/MarketFeed.js is a re-export shim.
- Broker contract/drivers: packages/corex-broker-contract.
- Socket_X and RiskGateway: packages/corex-gateway.
- Authentication: packages/corex-auth.
- Portfolio services: packages/corex-portfolio.
- PostgreSQL connection/query/transaction boundary: engine/services/postgres.js.
- Legacy persistence façade/state: engine/services/pgStore.js.
- Backtest HTTP/upload/report logic: engine/routes/backtestController.js and engine/backtestManager.js.
- Persistent job queue and worker: engine/services/jobQueue.js, engine/workers/jobWorker.js, engine/workers/jobs/backtestRun.js, engine/services/jobWorkerSupervisor.js.
- WebSocket broadcasting: engine/services/broadcaster.js.
- Frontend state and views: front_end/src.

Observed concentration points at the reviewed GitHub baseline `435127546087f9d40486ea272cb337363ce0724e` include engine/core/engine.js (718 lines), engine/backtestManager.js (913), engine/routes/backtestController.js (993), engine/routes/executionController.js (784), engine/services/broadcaster.js (787), and engine/services/pgStore.js (648). These counts were checked against the source text at that revision using content-line counting that does not treat a trailing newline as an extra line; they are investigation targets, not instructions to split files mechanically. Kilo's follow-up review reports local `Get-Content` counts of 1,026 / 803 / 777 / 784 for backtestManager / broadcaster / pgStore / executionController, respectively. The executionController count agrees; the other three do not match the GitHub source snapshot at the reviewed baseline or PR #54 head. This indicates a source-revision or working-tree difference, not a reason to overwrite baseline evidence. Reconcile the exact local commit and working-tree state behind the three differing counts before adopting them. Until then, this plan's counts are explicitly baseline-scoped.

### 2.3 Current boot and application flow

~~~text
index.js
  -> register aliases / load environment
  -> validate production secrets
  -> run database migrations
  -> initialize and load config
  -> refresh connector integration config
  -> engine.start()
  -> server.start()
       -> Express routes
       -> WebSocket broadcaster upgrade
       -> MT5 bridge upgrade
  -> start data culler
  -> start live order dispatcher
  -> start job worker supervisor when DB is configured

Shutdown:
  -> engine.stop
  -> server.stop
  -> strategy runtime stop
  -> data culler stop
  -> live order dispatcher stop
  -> job worker supervisor stop
  -> PostgreSQL close
~~~

This is the observed startup sequence in index.js. P0-04/P0-05 must verify error paths, partial-start cleanup, ordering constraints and recovery semantics before this becomes a final target contract.

### 2.4 Current PAPER/LIVE flow observed in MarketFeed

~~~text
TwelveData / selected provider
  -> normalized market tick
  -> EVENTS.MARKET.TICK
  -> MarketFeed listener
  -> RuntimeRegistry.forSymbol(symbol)
  -> select PAPER/LIVE runtime entries
  -> broker.onTick(tick)
  -> instance.onMarketData(packet, context)
  -> strategy returns signal/intent
  -> broker.handle(signal)
  -> synchronize position snapshot
  -> emit strategy signal executed event
  -> broadcaster / persistence consumers
~~~

Source evidence: packages/corex-market-data/src/MarketFeed.js and engine/core/engine.js. MarketFeed calls broker.handle. The engine wires BaseBroker.setRiskValidator to SignalProcessingEngine.validateForCommand, and BaseBroker.handle invokes it and fails closed if missing/rejected. Thus this PAPER/LIVE strategy path does have a risk validator; it does not call RiskGateway directly. RiskGateway, if active, pre-checks through SocketXRiskEngine and then broker.handle repeats the same SignalProcessingEngine validation. However, SignalProcessingEngine currently checks only drawdown, flat exit and same-side/scaling; maxDailyLossLimit is declared but unused. P1-03 must consolidate the duplicated checks into one authoritative risk-policy boundary and define complete limits. SocketXServer is imported and its auth verifier configured, but no instance was found in engine/core/engine.js or engine/server.js; verify whether another entry point activates it.

### 2.5 Current BACKTEST flow observed in source

~~~text
Frontend command / REST request
  -> engine/routes/backtestController.js
  -> validate user, settings, upload/dataset and limits
  -> persist job through engine/services/jobQueue.js
  -> PostgreSQL corex_jobs
  -> jobWorkerSupervisor uses child_process.fork() to launch a separate Node.js worker process
  -> engine/workers/jobWorker.js claims job inside that child process
  -> engine/workers/jobs/backtestRun.js executes the backtest job inside the same worker process
  -> load strategy source and instantiate strategy
  -> engine/backtestManager.js
  -> historical data + BacktestDriver / fill simulation
  -> save report/results
  -> persist job result/status
  -> progress/status events to broadcaster
  -> frontend report and progress view
~~~

Source evidence: backtestController.js, jobQueue.js, jobWorker.js, jobs/backtestRun.js, backtestManager.js, jobWorkerSupervisor.js and packages/corex-broker-contract/src/drivers/BacktestDriver.js. `engine/services/jobWorkerSupervisor.js` calls `fork(workerPath, ...)` in `_spawn()`, so the job handler and backtest manager execute in a separate child process rather than the HTTP/application process. BacktestDriver.execute is a direct synchronous fill method and bypasses BaseBroker.handle and its installed risk validator. The independent review also traced cancellation, retry, cost propagation, fill timing, callback, dataset validation, accounting and report-persistence defects. Record those findings in the P1-00 review artifact; Kilo/Jules should verify only explicitly uninspected boundaries and add missing evidence rather than repeat the whole audit.

### 2.6 Risk and SocketX source verification

The normal engine wiring sets a BaseBroker-level risk validator:
- engine/core/engine.js calls BaseBroker.setRiskValidator(...SignalProcessingEngine.validateForCommand...).
- BaseBroker.handle invokes that validator and fails closed when it is missing or rejects.
- MarketFeed calls broker.handle for strategy-driven PAPER/LIVE intents, so this route does pass through the BaseBroker validator.
- RiskGateway, if invoked, pre-checks through SocketXRiskEngine (which delegates to SignalProcessingEngine) and then calls broker.handle, causing the same validator to run again.
- BacktestDriver.execute bypasses BaseBroker.handle and the validator. This is the concrete mode-parity gap.

SocketXServer supports account ownership checks only when an accountResolver is supplied. The inspected engine configures its static token verifier but does not instantiate SocketXServer; engine/server.js wires /ws to the broadcaster and /mt5 to the MT5 bridge. Verify whether another entry point activates SocketXServer before treating that command path as production behavior.

### 2.8 Strategy validation evidence limit

The round7 security cases (`eval`, `require('fs')` and `process` access) are not re-verified by this architecture review. The P0-06 quality review identified the prior KNOWN_ISSUES classification as stale/inconsistent with an earlier full-suite result, but that does not establish the current behavior of `@utils/security/validateStrategyCode`. No fresh targeted test run or source-level rejection proof is recorded here. Treat the three cases as UNVERIFIED until the current helper and its tests are inspected and the exact tests are rerun with saved output; do not claim that static validation rejects them or that the strategy execution environment is sandboxed.

### 2.7 Strategy worker and restart source verification

- engine/modules/strategyRuntime/workerPool.js lazily forks a child on the first request; the child inherits the complete parent environment and uses normal Node module resolution. This is process separation, not a security sandbox or least-privilege boundary.
- engine/workers/strategyWorker.js stores multiple active strategies in one process-wide map and compiles them with StrategyCompiler.
- The inspected engine/strategyLoader.js path compiles strategies directly through StrategyCompiler and does not call strategyRuntime.loadStrategy/execTick/execBar. Trace actual production callers before claiming the worker pool isolates normal PAPER/LIVE strategy execution.
- index.js imports strategyRuntime and stops it during shutdown but does not start it in bootstrap. Since workerPool starts lazily on request, this is not itself a defect; actual worker-pool use remains to be traced.
- index.js Ctrl+R calls engine.restart(). engine.restart() only stops and starts the engine component; it does not restart the HTTP server, job worker supervisor, strategy worker pool, data culler or live order dispatcher. Do not describe it as a full application restart.

### 2.6 Existing package facts and architecture constraints

Seven package directories exist: corex-accounts, corex-auth, corex-broker-contract, corex-gateway, corex-market-data, corex-portfolio and corex-strategy-engine. A dedicated corex-backtest package is not established as the current owner.

Use the active roadmap's rules:
- Modular monolith; do not turn this into microservices.
- A directory/package exists only when it has a justified owner and public contract.
- Application composition may call domain public APIs and adapters.
- Domain code must not import application controllers, global runtime singletons or unrelated legacy internals.
- Use direct contracts for synchronous request/response; events for genuine asynchronous notification/fan-out.
- PostgreSQL may remain shared, but table ownership, writers and transaction boundaries must be explicit.
- The frontend communicates through application HTTP/WebSocket contracts, never imports backend packages.
- Shims are temporary and require named consumers and removal criteria.
- No mechanical file splitting, mass package extraction, schema changes or protected execution/risk changes during architecture review.

Historical `plans/target-architecture.md` (dated 2026-08-22) is not authoritative; its contents explain why it is superseded rather than merely asserting that status. It sets the goal that each new feature should be a new package with zero existing-code changes, says packages communicate via events, makes `engine/` a thin I/O/composition root, and proposes future `corex-execution`, `corex-jobs`, `corex-risk`, `corex-notifications` and `corex-settings` packages. It also specifies event-bus-first package rules and a leaf-first extraction sequence. Those rules and package proposals are not adopted by the current roadmap, which instead requires justified ownership/contracts, direct calls for synchronous request/response, events for genuine asynchronous fan-out, and no mechanical extraction. The current roadmap supersedes the historical proposal; retain it as historical rationale, not an active target.

## 3. Proposed target interaction flow — for review, not yet approved

~~~text
USER / FRONTEND
  |-- HTTP: authenticate, configure account, commands, queries, uploads
  |-- WebSocket: snapshots, lifecycle, progress, telemetry, order/position events
  v
APPLICATION BOUNDARY
  |-- auth / authorization / user-account scope
  |-- HTTP controllers and request validation
  |-- WebSocket gateway and subscriptions
  |-- composition root, dependency wiring, worker supervision
  |-- runtime and job orchestration
  |
  +----------------------+-----------------------+
  |                      |                       |
  v                      v                       v
STRATEGY DOMAIN      MARKET-DATA DOMAIN      ACCOUNT / SETTINGS
  |                      |                       |
  | strategy intent      | normalized bars/ticks | account/config contracts
  +----------+-----------+-----------------------+
             |
             v
       TRADING RUNTIME
       | runtime identity and lifecycle
       | warmup / subscriptions / isolation
       | mode selection
       |
       +------------------------------+
       |                              |
       v                              v
  PAPER / LIVE EXECUTION          BACKTEST
       |                              |
       v                              v
  RISK + BROKER PORTS           DETERMINISTIC SIMULATION
       |                              |
       v                              v
  BROKER ADAPTERS               FILL / COST / ACCOUNTING
       |                              |
       +---------------+--------------+
                       |
                       v
              PORTFOLIO / RESULTS
                       |
                       v
          PERSISTENCE ADAPTERS / POSTGRES
                       |
                       v
          DOMAIN EVENTS / WS PUSH
                       |
                       v
                    FRONTEND
~~~

This is a candidate responsibility flow, not a package tree. Phase 1 must decide which responsibilities stay in existing packages, move into application modules, or justify a new package. In particular, do not assume corex-gateway should own domain risk policy merely because RiskGateway currently lives there.

## 4. Minimal remaining Phase 0 work — do not restart completed audits

Execute in this order:

1. **P0-02 review and disposition (Kilo evidence, independent review).**
   - Check exact latest branch revision against current main.
   - Keep provisional classifications provisional.
   - Resolve only contradictions that change ownership or migration order.
   - If accepted, transplant only the audit/task/status documentation onto a clean branch based on current main. Do not merge the stale audit branch directly.

2. **P0-03 focused frontend ownership map (Jules).**
   - Reuse PR #49's findings; do not repeat its styling audit.
   - Produce the exact roadmap deliverable: major view -> state owner -> REST request -> WebSocket events -> backend producer -> loading/error/empty/stale behavior.
   - Separate real polling from local timers and one-shot requests.
   - No frontend source changes.

3. **P0-04 cross-layer contract map (Kilo, after P0-02/P0-03 evidence).**
   - Trace four journeys only: authentication/account setup; strategy create/configure/start/stop; PAPER/LIVE tick-to-order-to-position; BACKTEST upload/run/cancel/report.
   - For each: producer, consumer, payload/schema, auth/user scope, persistence side effect, errors, WS event, tests.
   - Identify which of the two apparent strategy/execution paths is actually used. Do not invent a new contract.

4. **P0-05 persistence/runtime map (Jules, in parallel with P0-03).**
   - Map tables and migrations to real writers/readers; include orders, fills, positions/trades, strategy/runtime state, settings/accounts, uploads/reports and corex_jobs.
   - Trace job claim, heartbeat, retry, cancellation, terminal state and restart recovery.
   - Trace PAPER/LIVE runtime start, warmup, active, stop, crash/recovery and persisted state.
   - Read-only; no DB writes, migration or runtime changes.

5. **P0-06 review (Kilo report, independent review).**
   - Accept an honest quality snapshot if evidence and limitations are clear.
   - Keep --detectOpenHandles, frontend build/typecheck and fresh test logs as a separate verification follow-up; these do not require endless prose corrections.
   - Review the package.json test:auth script correction as a distinct small test-infrastructure change; it is not proof the command passes.

6. **P0-07 bounded branch/plan reconciliation (Jules).**
   - Review only relevant open work: PR #49 frontend audit/UI work, PR #51 README evidence, security PRs #33/#41, strategy-engine PRs #15/#27, broker/legacy PRs #23/#24/#26, and any currently active branches that overlap the target architecture.
   - Classify ADOPT / EXTRACT / REWORK / HOLD / CLOSE / NEEDS OWNER DECISION.
   - Do not merge or close anything.

7. **Owen Phase 0 exit review.**
   - Review the seven outputs once.
   - Accept verified evidence and explicitly retain unknowns as follow-ups.
   - Do not demand perfect certainty where the missing evidence does not change the architecture.

## 5. Phase 1 design sequence — consolidated deliverables

Keep the existing roadmap task IDs for traceability, but do not produce six separate design documents. Combine work that belongs together:

| Decision artifact | Roadmap tasks | What it must settle |
|---|---|---|
| Target domain and application composition | P1-01 + P1-02 | Domain ownership/non-ownership, public APIs, dependencies, composition root, boot/shutdown, workers, HTTP/WS boundary, adapter/repository placement |
| Runtime, strategy, execution, risk and portfolio contracts | P1-03 | Strategy isolation and callback contract; runtime identity/lifecycle/queues/fault domains; single order-intent path; risk policy; orders/fills/positions/equity/accounting; PAPER/LIVE/BACKTEST parity and deliberate divergences |
| Data, persistence, tenancy, jobs, artifacts and frontend/API contracts | P1-04 + P1-05 | Market-data and dataset/time rules; explicit tenant model; table writers/transactions; job state/retry/cancel/recovery; artifact storage/IDs/retention; REST/WS schemas and frontend state ownership |
| Migration sequence and decision record | P1-06 | Dependency order, coexistence/cutover, rollback, compatibility window, import-boundary enforcement, shim expiry and deletion gates |

The existing roadmap task IDs remain, but their outputs are consolidated into these four artifacts:
- plans/architecture/TARGET_DOMAIN_MAP.md (includes application composition)
- plans/architecture/EXECUTION_CONTRACTS.md
- plans/architecture/DATA_AND_PERSISTENCE_DESIGN.md (includes frontend/API contracts)
- plans/architecture/MIGRATION_SEQUENCE.md

Do not create APPLICATION_AND_ADAPTER_DESIGN.md or FRONTEND_AND_API_DESIGN.md as separate documents unless a concrete uncovered decision requires separation and Owen approves it.

Security and tenancy are a parallel release gate, not a late implementation phase. Multi-user LIVE remains disabled until strategy isolation, tenant authorization, broker/account scoping and cross-tenant tests pass.

## 6. Proposed implementation sequence after architecture approval

This is the recommended dependency order; P1-06 may adjust it based on evidence:

1. Security and tenancy foundation (parallel release gate) — explicit tenant IDs and authorization, strategy isolation, least-privilege workers, secret/account scoping and cross-tenant tests. No multi-user LIVE before this gate.
2. Strategy/runtime contract — one strategy entry/callback contract across modes; enforceable execution limits; per-runtime ordering, backpressure, cancellation and fault isolation.
3. Market-data boundary — provider contract, normalized tick/bar representation, history/warmup and per-runtime subscription handoff.
4. Execution, risk and portfolio accounting foundation — one order-intent entry point, one risk-policy owner, authoritative order/fill/position/equity accounting and documented mode parity.
5. Backtest correctness rebuild — reuse the approved execution/accounting contracts; deterministic causal simulation, explicit fill timing/costs/gap behavior, cancellation, bounded resources and reproducible reports.
6. Persistence/jobs/artifacts — atomic job state transitions, leases/fencing, retry classification, durable tenant-scoped artifact storage and recovery.
7. Legacy retirement — remove old paths only after zero-consumer evidence and replacement tests.

Implement one domain migration at a time. Each task must state current behavior, intended behavior, public contract, files in/out of scope, migration steps, tests, rollback/recovery, and acceptance criteria. No broad refactor or mass extraction.

## 7. Independent review before any coding

The plan is published for review only. Assign reviewers as follows:

- **Kilo Code — architecture/implementation feasibility review:** check repository paths, ownership, current flow accuracy, dependency order, migration risks and whether the tasks are executable. Do not implement.
- **Gemini — adversarial architecture review:** independently challenge the proposed boundaries, synchronous vs event communication, persistence ownership, runtime concurrency/isolation, failure/recovery behavior and unnecessary abstractions. Do not rewrite or code.
- **Gemini Jules — product/frontend flow review:** check whether the user journeys, frontend state ownership, API/WS boundaries, backtest UX and failure states are represented. Do not implement UI or backend code.
- **ChatGPT — consolidate evidence and reviewer disagreements; Owen makes final decisions.**

Each reviewer must return:
1. BLOCKER / MAJOR / MINOR findings with exact path/symbol evidence.
2. Missing flows or incorrect assumptions.
3. Dependency/order changes required.
4. Decisions that only Owen can make.
5. A clear verdict: ACCEPT FOR OWEN REVIEW or REVISE.
6. No code changes, no PR merges and no new packages.

After reviews, Kilo may make one bounded documentation correction pass. Owen approves the architecture and implementation order. Only then are coding tasks assigned.

## 8. Review acceptance criteria

- [ ] The current application flows are traced to real source files and symbols.
- [ ] Current behavior is separated from proposed target behavior.
- [ ] Every proposed domain has explicit responsibility and non-responsibility.
- [ ] Direct calls vs events are justified per interaction.
- [ ] Runtime identity, per-runtime ordering, backpressure, cancellation, fault isolation and state transitions are explicit.
- [ ] Strategy code has an explicit trust/isolation model and cannot access ambient secrets, DB or other tenants' broker sessions.
- [ ] Tenant ownership is enforced across HTTP, WebSocket, workers, repositories, broker routing and artifacts.
- [ ] One authoritative order-intent entry point and risk-policy owner exist; risk failure behavior is fail-closed.
- [ ] PAPER/LIVE/BACKTEST risk, fill, cost and accounting parity/divergences are explicit and tested.
- [ ] Job transitions, cancellation, retries, worker leases, shutdown and recovery have one terminal-state authority.
- [ ] Artifact publication is durable and tenant-scoped; a job cannot succeed if its report is not retrievable.
- [ ] Backtests inject clock/RNG, validate datasets strictly and enforce server-side resource limits.
- [ ] Import-boundary lint/tests enforce package public APIs and prevent deep imports.
- [ ] Broker, risk, fill, portfolio and persistence ownership do not overlap ambiguously.
- [ ] Backtest timing, data causality, fill/cost model, cancellation and report persistence are specified.
- [ ] Database ownership, transactions, idempotency and recovery are addressed.
- [ ] REST and WebSocket responsibilities and frontend state ownership are explicit.
- [ ] Existing packages are reused where appropriate; no package is created only for visual organization.
- [ ] Migration is incremental, with compatibility, rollback and shim-removal gates.
- [ ] Kilo, Gemini and Jules have reviewed the plan independently.
- [ ] Owen has approved the final architecture and first bounded implementation task.

## 9. Explicit non-goals

- No application source edits.
- No package creation or extraction.
- No folder/file moves or mass deletion.
- No database schema/migration changes.
- No broker, execution, risk, security or public API changes.
- No frontend redesign.
- No merging existing PRs as a shortcut.
- No repeated documentation-only correction cycles once the evidence is sufficient.

## 10. Follow-up review disposition — 2026-11-01

Kilo Code returned **ACCEPT FOR OWEN REVIEW**, subject to a bounded documentation correction pass. The pass corrected the MarketFeed callback name, made the forked job-worker process boundary explicit, documented the historical target-architecture proposal that is being superseded, and recorded the unverified round7 validation cases. The reported alternate line counts could not be reproduced from the GitHub source snapshot at the reviewed baseline or PR #54 head; the plan now scopes its counts to baseline `435127546087f9d40486ea272cb337363ce0724e` and records the discrepancy rather than presenting unverified numbers as fact.

This is not final architecture approval. The original independent review findings remain recorded in `plans/reviews/P1-00-review-2026-11-01.md`; the targeted Kilo verdict does not replace Jules/Gemini review or Owen's decisions. No application coding is authorized.

**Next action:** Jules verifies frontend job/report and tenant flows using PR #49; Gemini reviews the revised security/execution decisions. Kilo may verify any remaining backend unknowns only where evidence is still missing. Return findings only. Do not code until Owen decides the policy questions and approves the consolidated architecture.
