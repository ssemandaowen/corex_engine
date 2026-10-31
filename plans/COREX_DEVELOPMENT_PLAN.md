# CoreX Development Plan — Authoritative Roadmap

> **Status:** Active — Phase 0 (repository discovery and architecture baseline)
> **Owner / final decision authority:** Owen Ssemanda
> **Repository:** https://github.com/ssemandaowen/corex_engine
> **Last strategy review:** 2026-10-31
> **Audience:** Owen, ChatGPT, Claude, Kilo Code, Jules, Codex and every human or automated contributor.
> **Purpose:** Make the approved development strategy executable and prevent reactive patching from becoming the default development method.

---

## 0. Read this first — authority and operating rules

This is the **single active development roadmap** for CoreX. All agents must read it before proposing or implementing repository work. AGENTS.md points here.

This document controls the order of architectural investigation and implementation, task scope and dependencies, agent progress records, branch/PR review, and legacy retirement.

### 0.1 Authority order

When repository documents disagree, use this order:

1. Owen's latest explicit decision in the current task or an appended entry in plans/decisions.md.
2. This roadmap for active priorities, phases, task status and execution sequence.
3. AGENTS.md and SKILLS.md for repository-wide engineering constraints and working procedure.
4. Current package-level AGENTS.md and approved task specifications.
5. Existing audit documents, old plans, PR descriptions and code comments as **evidence**, not automatic authorization.

Historical plans may contain valid ideas, but they are not automatically current architecture. In particular, plans/target-architecture.md is an earlier proposal. Its package list, event-bus-first communication rule, extraction order and assumptions must be reviewed against the current repository before adoption. Do not blindly continue it.

### 0.2 The anti-patching rule

A discovered defect does not automatically authorize a local fix.

Before implementation, the agent must:
1. Identify the affected user-visible or system behavior.
2. Trace the full flow across frontend, API, application orchestration, domain logic, adapters and persistence where applicable.
3. Identify the actual owner of the behavior.
4. Inspect existing implementations, consumers, tests and migration history.
5. Decide whether the right action is **KEEP, MOVE, REBUILD, REPLACE, CONSOLIDATE or REMOVE**.
6. Connect the work to a task in this roadmap (or propose a new task).
7. Describe scope, dependencies, risks and acceptance evidence.
8. Wait for Owen's approval when work changes architecture, public contracts, database schema, security, broker/execution/risk behavior or crosses task scope.

Do not patch the nearest file merely because it is where the symptom appeared. Do not create a second implementation while leaving the old one active. Do not split a large file into smaller files without first defining responsibility and ownership.

### 0.3 No silent scope expansion

- One task has one declared outcome and bounded scope.
- Agents may discover adjacent work, but must record it as a proposed follow-up rather than silently implementing it.
- Do not rename, relocate or delete unrelated files.
- Do not merge a branch just because it is green or its author says it is complete.
- Do not change package manager, runtime, database strategy or deployment model without an approved decision.
- Do not introduce a package just to make the directory tree look modular.
- Do not make all package communication event-driven by default. Use direct public contracts for request/response operations; use events when asynchronous fan-out or lifecycle notification genuinely requires them.
- Do not make a compatibility shim permanent by neglecting its removal condition.

---

## 1. Product and engineering objective

Build CoreX as a reliable, maintainable, modular-monolith trading application that Owen can operate personally and evolve into a real product. It must not become a collection of disconnected packages or a legacy application hidden behind wrappers.

The architecture must support the actual product flow:

1. A user authenticates and manages their account.
2. The user configures a trading account and its connector.
3. The user selects LIVE, PAPER or BACKTEST where supported.
4. The user selects or configures a strategy and its parameters.
5. CoreX obtains the correct market data and executes or simulates the strategy.
6. CoreX records orders, fills, positions, costs, account state and results.
7. The frontend presents truthful state, progress, errors and reports.
8. Runtime state and important actions are recoverable and auditable.

### Non-negotiable product invariants

- The server is authoritative for trading, execution, risk and persisted state.
- The frontend renders real server state; it must not invent performance, positions, telemetry or successful operations.
- Real-time state distribution uses WebSockets. REST remains appropriate for commands, uploads, queries, initial snapshots and other request/response operations. Do not add polling loops for live state synchronization.
- Important state-changing actions must be auditable.
- Runtime lifecycle, ownership and concurrency must be explicit.
- PAPER, LIVE and BACKTEST must have deliberate, tested differences and shared contracts where behavior is genuinely common.
- Secrets must not be committed or exposed to the frontend.
- A restart/recovery design must state which state is persisted, reconstructed or intentionally ephemeral.
- Correctness and data integrity take priority over superficial modularity or premature optimization.

---

## 2. Current-state facts and investigation boundaries

The repository has a Node.js/Express backend, React/TypeScript frontend under front_end/, PostgreSQL migrations and WebSocket infrastructure. Existing top-level areas include engine/, broker/, utils/, config/, events/, packages/, front_end/, db/, test/ and plans/.

Existing packages include:
- corex-accounts
- corex-auth
- corex-broker-contract
- corex-gateway
- corex-market-data
- corex-portfolio
- corex-strategy-engine

This list describes the observed repository, **not a final approved package map**.

Initial inspection has already raised these hypotheses for verification:
- domain logic and orchestration are still mixed in parts of engine/;
- some packages depend on application aliases or legacy directories;
- strategy-related code has duplicate or transitional ownership;
- backtesting responsibilities are spread across manager, service, worker, broker and data modules;
- frontend views contain mock/fallback data and multiple state-polling patterns;
- some open PRs combine unrelated backend, frontend and styling changes.

These are investigation leads, not permission to delete or rewrite anything. Phase 0 must verify them against the current branch and actual consumers.

---

## 3. Target architecture principles

The target is a **modular monolith with explicit domain ownership**, not a microservice conversion and not a package-count exercise.

### 3.1 Ownership

A domain owns its rules, models, validation and behavior. Application code composes domains; adapters translate external systems; the frontend consumes application APIs and events.

Conceptual layers:

~~~text
front_end/
  feature views, UI state, API clients, WebSocket client
                 |
                 v
application boundary
  HTTP routes/controllers, auth middleware, WS gateway,
  job orchestration, composition root, lifecycle
                 |
                 v
domain packages
  strategy | market data | execution | portfolio
  backtest | risk | accounts | settings | auth
                 |
                 v
ports / adapters / infrastructure
  broker connectors | data providers | PostgreSQL
  file storage | queues/workers | external services
~~~

This is a responsibility map, not a mandate to create every named package. Phase 1 will decide whether a responsibility belongs in an existing package, a new package, an application adapter or a shared infrastructure module.

### 3.2 Application / engine

The application layer owns process startup, dependency composition, HTTP and WebSocket transport, authentication middleware integration, job dispatch, runtime supervision, shutdown and cross-domain orchestration.

It should not own the implementation of strategy rules, fill mathematics, market-data normalization, portfolio calculations or backtest simulation.

### 3.3 Domain packages

A package must have:
- a documented responsibility and explicit non-responsibilities;
- a small public API;
- internal modules that are not imported directly by unrelated packages;
- explicit dependencies and no accidental application aliases;
- injected infrastructure dependencies where practical;
- unit tests for domain rules and integration tests at real boundaries;
- a clear owner and migration/removal plan for legacy code it replaces.

A package does not need to be separately published or independently deployed to be useful.

### 3.4 Dependency direction

- Application composition may depend on domain public APIs and adapters.
- Domain code must not reach into application controllers, global runtime singletons or unrelated legacy folders to obtain dependencies.
- Adapters implement ports/contracts and translate external APIs into CoreX types.
- Cross-domain synchronous operations use explicit public contracts.
- Events are used for asynchronous notifications and genuine fan-out, not to hide call graphs or replace every direct function call.
- Avoid circular dependencies and deep imports into another package's internals.
- utils/ is reserved for genuinely domain-neutral primitives; it is not a fallback home for unowned code.

### 3.5 Persistence ownership

Before moving database code, map table ownership, transaction boundaries, migrations, foreign keys, retention, account/user scoping and recovery behavior. Do not create competing repositories or let two domains silently write the same business state. A shared PostgreSQL instance is acceptable; ownership and access contracts must be explicit.

### 3.6 Frontend ownership

Keep React and TypeScript unless evidence justifies a change. Organize the UI around product features and shared primitives. Keep API transport and WebSocket subscription/state handling centralized enough to prevent duplicated connection logic. UI components must distinguish loading, empty, stale, unauthorized, failed, running and completed states. Never use synthetic data as a fallback that looks real.

---

## 4. Roadmap phases and executable task board

**Status vocabulary**
- [ ] TODO — not started.
- [~] IN PROGRESS — active work with an owner and branch/task reference.
- [x] DONE — acceptance criteria met and evidence linked.
- [!] BLOCKED — blocked with reason and required decision.
- [-] DROPPED — intentionally cancelled with reason.

An unchecked task is not permission to start it. The task must be selected, assigned and approved according to Section 6.

### PHASE 0 — Establish the truth (CURRENT PHASE)

**Outcome:** A verified map of the current application, its dependencies, behavior and active work. No broad implementation or mass movement in this phase.

- [~] **P0-01 — Repository baseline**
  - Record default branch, latest commit, package manager, scripts, runtime versions, workspace configuration and test commands.
  - Inventory top-level and nested directories, package manifests and package-specific agent instructions.
  - Output: plans/architecture/REPOSITORY_BASELINE.md.
  - Acceptance: commands and paths verified against the checked-out branch; timestamp and commit SHA recorded.
  - Status: IN PROGRESS — remote repository inventory drafted; local workstation evidence remains outstanding.
  - Owner: ChatGPT (remote inventory), Owen/Jules (local runtime and working-tree verification).
  - Branch: docs/p0-01-repository-baseline.
  - Started: 2026-10-31.

- [ ] **P0-02 — Backend ownership and dependency map**
  - Trace routes/controllers → application services/workers → domain logic → adapters/repositories.
  - Inventory large files, singleton state, alias imports, direct deep imports, circular dependencies and duplicate implementations.
  - For each important file/directory record responsibility, consumers, dependencies, tests and proposed disposition: KEEP / MOVE / REBUILD / REPLACE / CONSOLIDATE / REMOVE.
  - Output: plans/architecture/BACKEND_OWNERSHIP_MAP.md.
  - Acceptance: findings cite real paths and symbols; no speculative mass file moves.

- [ ] **P0-03 — Frontend architecture and behavior map**
  - Map front_end/src views, feature components, API clients, stores, hooks, WebSocket handlers, forms and shared components.
  - Trace key user journeys to their backend endpoints/events.
  - Inventory mock data, silent fallbacks, polling, duplicated state, unhandled server events and missing loading/error/empty states.
  - Output: plans/architecture/FRONTEND_OWNERSHIP_MAP.md.
  - Acceptance: each major view has a documented data source and state owner; distinguish polling for live synchronization from legitimate local timers or one-shot requests.

- [ ] **P0-04 — Cross-layer contract map**
  - Map API routes, request/response schemas, error codes, WebSocket event schemas, subscriptions, frontend consumers and persistence effects.
  - Identify duplicated or undocumented contracts and mismatched field names.
  - Output: plans/architecture/INTEGRATION_CONTRACT_MAP.md.
  - Acceptance: trace the important flows end-to-end, including backtest run/cancel/report and strategy lifecycle.

- [ ] **P0-05 — Persistence, jobs and runtime-state audit**
  - Map database tables/migrations to domain owners and writers.
  - Map runtime state transitions, job lifecycle, cancellation, restart/recovery, idempotency and transaction boundaries.
  - Output: plans/architecture/PERSISTENCE_AND_RUNTIME_AUDIT.md.
  - Acceptance: identify authoritative state, ephemeral state and recovery gaps; no schema changes in this task.

- [ ] **P0-06 — Test and known-issues baseline**
  - Run the existing relevant test commands where the environment permits.
  - Record pass/fail/skipped counts, known pre-existing failures, coverage gaps and tests that assert legacy implementation details rather than behavior.
  - Output: plans/architecture/QUALITY_BASELINE.md, with links to logs or CI runs.
  - Acceptance: separate verified failures from environment limitations and unverified claims.

- [ ] **P0-07 — Existing plans and PR/branch reconciliation inventory**
  - Compare plans/target-architecture.md, plans/to_do.md, audit documents, open PRs and active branches with the verified repository.
  - Classify each relevant PR/branch: ADOPT, EXTRACT, REWORK, HOLD, CLOSE or NEEDS OWNER DECISION.
  - Review frontend enhancement PRs as first-class product work, not secondary cleanup.
  - Output: plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md.
  - Acceptance: every reviewed branch/PR has a reason, affected files, conflicts, tests and recommended disposition. Do not merge or close PRs as part of the inventory.

**Phase 0 exit gate:** P0-01 through P0-07 reviewed by Owen. No domain rebuild begins until the current-state map is sufficiently complete to make ownership and migration decisions.

### PHASE 1 — Approve the target system

**Outcome:** A concrete architecture and migration design derived from Phase 0 evidence.

- [ ] **P1-01 — Domain boundaries and package ownership**
  - Decide which existing packages remain, which responsibilities move, and whether any new package is justified.
  - Define domain responsibilities, non-responsibilities, public APIs, dependencies and owners.
  - Output: plans/architecture/TARGET_DOMAIN_MAP.md.

- [ ] **P1-02 — Application composition and adapter design**
  - Define startup/composition, dependency injection, worker lifecycle, HTTP/WS boundaries and adapter placement.
  - Decide where database repositories and transactions live.
  - Output: plans/architecture/APPLICATION_AND_ADAPTER_DESIGN.md.

- [ ] **P1-03 — Runtime and execution contracts**
  - Define strategy input/output, signal normalization, order lifecycle, fill behavior, position state, risk checks and mode differences.
  - Define lifecycle state machines and concurrency/isolation rules.
  - Output: plans/architecture/EXECUTION_CONTRACTS.md.

- [ ] **P1-04 — Data and persistence contracts**
  - Define market-data contracts, historical dataset representation, time/index rules, storage ownership, retention and recovery.
  - Output: plans/architecture/DATA_AND_PERSISTENCE_DESIGN.md.

- [ ] **P1-05 — Frontend and API contract strategy**
  - Define feature ownership, API versioning/schema approach, typed error model, WebSocket event/subscription contract, client state ownership and empty/error states.
  - Output: plans/architecture/FRONTEND_AND_API_DESIGN.md.

- [ ] **P1-06 — Migration sequence and decision record**
  - Define dependency-aware migration order, coexistence rules, rollback points, shim expiry and removal gates.
  - Append approved decisions to plans/decisions.md; do not silently rewrite historical decisions.
  - Output: plans/architecture/MIGRATION_SEQUENCE.md.

**Phase 1 exit gate:** Owen approves the target domain map, dependency rules, contracts and migration order. No implementation agent may substitute its own architecture.

### PHASE 2 — Reconcile and prepare existing work

**Outcome:** Useful existing work is preserved without importing incompatible architecture.

- [ ] **P2-01 — Review architecture/backend PRs and branches**
  - Inspect complete diffs, commit ancestry, target branch, conflicts, tests and runtime impact.
  - Extract useful commits where a PR mixes unrelated changes.
  - Prioritize dependency-boundary work, duplicate retirement, singleton/runtime work and broker/data adapter ownership.
  - Output: reviewed decisions in plans/architecture/BRANCH_AND_PLAN_RECONCILIATION.md.

- [ ] **P2-02 — Review frontend enhancement PRs**
  - Evaluate accessibility, usability, layout consistency, feature behavior and maintainability.
  - Separate presentational changes from settings/API/state behavior.
  - Preserve valuable UI work while aligning it with approved frontend architecture.
  - Output: frontend PR disposition and a UI implementation backlog.

- [ ] **P2-03 — Consolidate overlapping security fixes**
  - Review overlapping dynamic-import/security changes and other duplicate fixes.
  - Produce one tested implementation with regression coverage.
  - Acceptance: security behavior verified; no duplicate competing patches remain.

- [ ] **P2-04 — Establish migration safety**
  - Identify backup/restore expectations, feature flags or controlled cutover options, database migration safeguards and test fixtures.
  - Acceptance: every high-risk migration has a rollback or recovery procedure.

**Phase 2 exit gate:** Each selected change has an approved destination and a bounded task. No bulk merge of agent branches.

### PHASE 3 — Rebuild domain ownership

**Outcome:** Domain implementations become authoritative; legacy application code delegates only during an explicit migration window.

The exact order is confirmed by Phase 0/1 dependency evidence. Initial candidates:

- [ ] **P3-01 — Strategy-engine ownership closure**
  - Finalize strategy public API and runtime contract.
  - Remove duplicate strategy implementations and legacy alias dependencies.
  - Confirm parameter schema, context API, indicators, state and validation ownership.
  - Acceptance: application and consumers use the package public API; legacy shims have named consumers and removal criteria.

- [ ] **P3-02 — Market-data boundary closure**
  - Make provider contracts, historical retrieval, streaming, normalization and subscription lifecycle explicit.
  - Remove application-specific imports from domain internals or inject them through ports.
  - Acceptance: provider behavior testable with injected dependencies; no hidden global application dependency.

- [ ] **P3-03 — Backtesting domain rebuild**
  - Define dataset, validation, normalization, signal timing, fill model, commission, slippage, spread, protections, accounting, cancellation, report and persistence contracts before implementation.
  - Separate deterministic simulation from I/O, job orchestration and storage adapters.
  - Preserve hand-computed acceptance fixtures (including hand20) and document every independently derived expected value.
  - Include gap-through-stop behavior, invalid-bar diagnostics, abort/cancel, resource budgets and reproducible reports.
  - Candidate package name: corex-backtest; confirm against Phase 1 package ownership.
  - Acceptance: deterministic tests pass; service/worker/API use the new contract; old manager is removed only after all consumers are migrated and integration evidence passes.

- [ ] **P3-04 — Execution and broker adapter ownership**
  - Reconcile broker contract, execution orchestration, paper/live drivers and external connectors.
  - Ensure broker-independent order lifecycle and fill semantics have one owner.
  - Acceptance: no competing broker trees or duplicated fill implementations; mode-specific behavior tested.

- [ ] **P3-05 — Portfolio and risk ownership**
  - Define authoritative ownership for positions, trades, P&L, equity, account state and risk decisions.
  - Ensure transaction and event ordering is explicit.
  - Acceptance: consistent account/user scoping, restart recovery and auditable state transitions.

- [ ] **P3-06 — Accounts, auth and settings boundaries**
  - Confirm which responsibilities are pure domain logic, application middleware, database adapters and user-facing configuration.
  - Acceptance: settings validation and persistence are consistent; secret handling and access control are verified.

- [ ] **P3-07 — Retire obsolete legacy paths**
  - Remove old files, duplicate implementations, dead exports, temporary aliases and shims only after consumer search, replacement tests and integration verification.
  - Acceptance: no active consumer points to retired paths; deletion evidence is recorded.

**Phase 3 rule:** Do not implement all candidate packages at once. Select one bounded domain migration, complete its acceptance gate, then proceed according to the dependency map.

### PHASE 4 — Frontend and product integration

**Outcome:** The UI reflects the rebuilt system's actual capabilities and contracts.

- [ ] **P4-01 — Frontend feature and shared-state structure**
  - Organize feature modules, API clients, shared components, forms, stores and hooks according to the approved frontend map.
  - Avoid broad rewrites that do not improve ownership or product behavior.

- [ ] **P4-02 — Real data and truthful UI states**
  - Remove mock metrics, synthetic report records, fake telemetry and silent fallback success states.
  - Add explicit loading, empty, stale, unauthorized, error and unavailable states.
  - Acceptance: every displayed trading/performance value has a real backend source.

- [ ] **P4-03 — WebSocket lifecycle and subscriptions**
  - Centralize connection lifecycle, event validation, subscription/unsubscription, reconnect and snapshot recovery.
  - Replace live-state polling with push events where the server owns the state.
  - Retain REST for commands, uploads, queries and initial data where appropriate.
  - Acceptance: no duplicate subscriptions or leaked handlers; reconnect restores a coherent view.

- [ ] **P4-04 — Backtest UI/API integration**
  - Align request parameters and reports with the approved backtest contract, including cost settings, fill mode, warnings, invalid datasets, progress and actual cancellation.
  - Acceptance: UI and API agree on schemas and errors; cancellation is verified end-to-end.

- [ ] **P4-05 — Settings and account experience**
  - Align settings schema, persistence, validation, versioning, WebSocket deltas and frontend controls.
  - Acceptance: refresh/reconnect returns authoritative values; failed saves do not show success.

- [ ] **P4-06 — UI enhancement backlog**
  - Review Jules UI branches and approved design improvements by feature.
  - Preserve accessibility and responsive behavior.
  - Acceptance: visual changes do not silently change backend behavior or remove useful interaction states.

### PHASE 5 — Production readiness and operational integrity

**Outcome:** The integrated application is verifiable, recoverable, secure and maintainable.

- [ ] **P5-01 — End-to-end product journeys**
  - Test sign-in, account configuration, strategy loading, PAPER execution, LIVE connector readiness, BACKTEST, cancellation, report retrieval and failure recovery.

- [ ] **P5-02 — Data integrity and recovery**
  - Verify database constraints, transaction boundaries, restart reconstruction, duplicate command handling, job idempotency and account isolation.

- [ ] **P5-03 — Security review**
  - Verify auth/session handling, strategy sandbox boundaries, dynamic imports, file access, secrets, authorization and WebSocket permissions.

- [ ] **P5-04 — Performance and resource controls**
  - Verify bounded queues/buffers, backpressure, worker limits, memory behavior, timeouts, cancellation and cleanup.

- [ ] **P5-05 — Deployment and operations**
  - Verify environment configuration, migrations, logs, health checks, backups, restore procedure and deployment instructions.

- [ ] **P5-06 — Final legacy and architecture audit**
  - Re-run dependency, alias, duplicate implementation, dead-code and frontend mock/polling audits.
  - Acceptance: remaining exceptions are explicitly documented and approved.

---

## 5. Cross-cutting work registers

These registers are not permission to implement everything immediately. Add a task only when it is traced to a phase and approved.

### 5.1 Architectural risk register

| ID | Risk / question | Required evidence | Status |
|---|---|---|---|
| AR-01 | Packages still depend on legacy aliases/application folders | Import graph and package boundary report | OPEN |
| AR-02 | Domain behavior duplicated between packages and legacy directories | Symbol/consumer map and parity tests | OPEN |
| AR-03 | Backtest responsibilities and state are scattered | End-to-end backtest flow map | OPEN |
| AR-04 | Runtime singleton/shared mutable state creates coupling | Singleton inventory and lifecycle tests | OPEN |
| AR-05 | Frontend mock data may look like real account/performance data | View-by-view data-source map | OPEN |
| AR-06 | Frontend polling and WS ownership may be duplicated | Timer/subscription inventory | OPEN |
| AR-07 | API/event contracts may drift between backend and frontend | Contract map and schema tests | OPEN |
| AR-08 | Database ownership/recovery may be unclear across domains | Table writer and recovery map | OPEN |
| AR-09 | Existing PRs may combine unrelated architecture and UI changes | PR diff and branch reconciliation | OPEN |

### 5.2 Existing evidence to inspect

The following are useful starting points, not automatically approved designs:
- plans/Audit/ — prior package, runtime, settings, risk and architecture audits.
- plans/target-architecture.md — earlier modular-monolith proposal; reconcile before reuse.
- plans/to_do.md — earlier task history; this roadmap is now the active tracker.
- plans/decisions.md — append-only architectural decision history.
- plans/KNOWN_ISSUES.md — known defects and historical failures.
- AGENTS.md, SKILLS.md and package-level agent instructions — engineering rules.

---

## 6. Agent execution protocol

### 6.1 Before starting a task

Every agent must:
1. Read AGENTS.md, SKILLS.md, this roadmap and relevant package instructions.
2. Read the selected task and its dependencies.
3. Check the current branch, working tree, latest commit and relevant PRs.
4. Read the relevant source and tests; do not rely only on an old summary.
5. Post or write a short implementation proposal containing:
   - task ID and intended outcome;
   - files/modules likely to change;
   - current behavior and ownership evidence;
   - proposed design and dependency direction;
   - tests and acceptance criteria;
   - risks, migration/rollback and out-of-scope items.
6. Wait for Owen's approval when required by Section 0.2 and SKILLS.md.

### 6.2 While working

- Work only on the approved task and branch.
- Update the task to [~] IN PROGRESS with agent, branch and start date.
- Keep implementation changes cohesive; avoid unrelated formatting or generated-file churn.
- Add tests at the layer that owns the behavior.
- Update contracts and documentation when behavior changes.
- Record discoveries as follow-up tasks rather than expanding scope.
- Never claim a test passed unless it was actually run; include command and result.
- Never overwrite another agent's uncommitted work or force-reset shared branches.

### 6.3 Completing a task

A task may be marked [x] DONE only when:
- its acceptance criteria are met;
- relevant tests were run and results recorded;
- integration/contract impact is checked;
- documentation and migration notes are updated;
- old consumers/shims are accounted for where applicable;
- the PR or commit is linked;
- known limitations are stated.

Use this update format in the task:

~~~text
Status: [x] DONE
Owner: <agent/person>
Branch / PR: <branch or URL>
Commit: <SHA>
Evidence:
- Tests: <command and pass/fail result>
- Integration: <what was verified>
- Boundaries: <what was checked>
Follow-ups: <task IDs or None>
Completed: YYYY-MM-DD
~~~

If blocked, use [!] BLOCKED and state the exact missing decision, dependency or evidence. Do not mark a task complete because code was written.

### 6.4 Adding a task

New tasks must include:
- stable ID (next available ID in the relevant phase);
- problem and user/system outcome;
- evidence and affected ownership boundary;
- scope and explicit non-goals;
- dependencies;
- acceptance criteria;
- risk level and required approver.

Do not add a task that merely says "fix X" without identifying the owning behavior and expected result.

### 6.5 Agent collaboration

- **Owen:** product owner and final authority for architecture, scope and high-risk decisions.
- **ChatGPT:** roadmap steward, cross-layer analysis, task definition and independent acceptance review.
- **Claude:** independent design challenge, logic review and risk analysis.
- **Kilo Code:** repository investigation and controlled implementation of approved tasks.
- **Jules:** bounded implementation tasks, including frontend enhancements, against approved contracts.
- Any agent may identify a problem; no agent may silently redefine the target architecture.

The same task must not be implemented independently by multiple agents. Assign one implementation owner and use other agents for review.

---

## 7. Definition of done — engineering quality gates

A task is not done solely because it compiles.

### Code and architecture
- Responsibility is in the correct owner.
- Public contracts are explicit; internal implementation is not imported across boundaries.
- No new circular dependency or unexplained legacy alias was introduced.
- Dependencies are justified and injected where appropriate.
- No duplicate active implementation was created.

### Behavior and data
- Normal, boundary and failure cases are tested.
- State transitions, concurrency, cancellation and retries are addressed where relevant.
- Data is not fabricated or silently discarded.
- Errors are typed and actionable.
- Persistence and account/user isolation are verified where relevant.

### Frontend and integration
- API and WebSocket contracts match.
- Loading, empty, error, stale and unauthorized states are truthful.
- Event subscriptions are cleaned up.
- UI does not claim success before server confirmation.
- No mock fallback is presented as real data.

### Delivery
- Tests and commands are recorded.
- Relevant docs and decision records are updated.
- PR/commit and evidence are linked.
- Follow-up tasks are created for out-of-scope findings.
- Owen's required review/approval is obtained.

---

## 8. Progress dashboard

Update this section when a phase changes. Do not estimate completion percentages without task evidence.

| Phase | Status | Exit condition |
|---|---|---|
| Phase 0 — Current-state truth | IN PROGRESS | P0-01 through P0-07 reviewed by Owen |
| Phase 1 — Target architecture | NOT STARTED | Target contracts and migration sequence approved |
| Phase 2 — Branch reconciliation | NOT STARTED | Relevant PRs classified and selected changes approved |
| Phase 3 — Domain rebuild | NOT STARTED | Domain migrations pass their acceptance gates |
| Phase 4 — Frontend integration | NOT STARTED | UI/API/WS flows match approved contracts |
| Phase 5 — Production readiness | NOT STARTED | End-to-end, recovery, security and operational gates pass |

**Current active task:** P0-01 — Repository baseline.

**Current implementation authorization:** No broad rebuild is authorized by this roadmap alone. First complete Phase 0, then obtain approval for Phase 1 decisions and bounded implementation tasks.

---

## 9. Change history

| Date | Change | Author |
|---|---|---|
| 2026-10-31 | Established authoritative development roadmap, phase gates, task protocol and anti-patching rules | Owen / ChatGPT draft |

Append future changes. Do not erase historical reasoning. For architectural decisions, also append to plans/decisions.md.
