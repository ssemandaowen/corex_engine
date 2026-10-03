# AGENTS.md — CoreX Engine

> **Repository:** https://github.com/ssemandaowen/corex_engine
> **Name**: *CoreX*
> **Project:** Proprietary algorithmic trading engine
> **Owner:** Owen Ssemanda / Apex Trait Ltd.
> **Audience:** All AI coding agents and automated development systems working in this repository.

---

## 1. Purpose

This file defines the engineering rules, architectural constraints, configuration standards, workflow, and operating procedures that every AI agent must follow when working on CoreX Engine.

These rules apply to all agents, including but not limited to:

* Kilo Code
* Claude Code
* Codex
* Other AI coding agents

An agent must read and follow this file before making repository changes.

---

## 2. Mandatory Reading

Before starting development work, the agent must inspect the relevant project guidance.

### Required

1. Read this `AGENTS.md`.
2. Read `SKILLS.md`.
3. Check `/KNOWN_ISSUES.md`.
4. Check `/plans/to_do.md`.
5. Check `/plans/decisions.md`.
6. Check the GitHub Project Board **CoreX Modularization** for current package extraction status.
7. If working inside a package containing its own `AGENTS.md`, read that file before modifying the package.
8. Check the relevant GitHub Issue or task specification before implementing the requested work.
9. Inspect the existing configuration, environment, database, and migration patterns before adding new configurable behavior.

### Important

`SKILLS.md` contains development-specific guidance and should be used throughout implementation, debugging, testing, configuration, database, and architectural work.

Do not ignore project guidance simply because a task appears small.

---

# 3. Project Stack and Architecture

## 3.1 Project Stack

### Backend

* Node.js
* Express
* PostgreSQL
* WebSocket-based real-time communication

### Frontend

* React
* TypeScript
* `corex-ui/`

### Architecture

The project uses path aliases including:

```text
@root
@core
@engine
@utils
@broker
@events
@config
```

Agents must inspect the existing project configuration before assuming an alias, package location, configuration source, or architectural dependency.

## 3.2 Architectural Ownership Model

CoreX is organized by **ownership and responsibility**, not by historical folder location.

The repository must evolve toward the following conceptual structure:

```text
corex/
│
├── packages/
│   ├── corex-strategy-engine/
│   ├── corex-market-data/
│   ├── corex-broker/
│   ├── corex-backtest/
│   ├── corex-execution/
│   ├── corex-risk/
│   └── other domain packages/
│
├── engine/
│   ├── boot/
│   ├── runtime/
│   ├── connections/
│   ├── services/
│   └── workers/
│
├── adapters/
│   ├── brokers/
│   ├── market-data/
│   ├── persistence/
│   └── external-services/
│
├── utils/
│   └── genuinely domain-neutral primitives
│
├── api/
├── config/
└── tests/
```

The exact directory names may evolve, but the ownership principles are mandatory.

---

## 3.3 Package Ownership

A package owns the implementation of the domain for which it exists.

For example:

```text
corex-strategy-engine
    ├── Strategy
    ├── Context
    ├── Params
    ├── Indicators
    ├── Data
    ├── Position
    ├── State
    ├── Plotting
    └── Validation
```

Strategy-specific implementations must not remain in a generic global `utils` directory merely because the legacy repository placed them there.

Examples include:

```text
StrategyDataManager
StrategyStateStore
StrategyPositionManager
IndicatorManager
StrategyValidator
Strategy-specific helpers
```

These should be owned by the strategy package or by an explicitly designated domain package.

The same principle applies to other packages.

**Do not preserve legacy ownership merely to avoid moving files.**

---

## 3.4 Engine Ownership

The `engine/` directory owns **application orchestration**, not domain implementation.

Engine responsibilities include:

```text
boot
initialization
dependency wiring
runtime lifecycle
runtime supervision
application services
connection coordination
worker supervision
system-level orchestration
```

Engine code should answer:

> When and how does the system run?

It should not become the owner of domain concepts that belong to packages.

For example:

```text
engine/runtime/
    RuntimeRegistry
    RuntimeLifecycle
    RuntimeRouter
    RuntimeSupervisor
```

is appropriate.

However, the engine should not contain the implementation of:

```text
Strategy
Indicator
Position
Broker
Market-data provider
Risk model
Backtest algorithm
```

unless that implementation is explicitly an engine-level orchestration concern.

---

## 3.5 Boot and Loader Responsibilities

Application construction and loading responsibilities belong under the engine boot/bootstrap layer.

Examples include:

```text
ConfigurationLoader
DatabaseLoader
StrategyLoader
MarketDataLoader
BrokerLoader
RuntimeLoader
PluginLoader
```

A loader is responsible for:

```text
discover
validate
construct
wire
initialize
start
```

A loader must not duplicate or absorb the implementation of the component it loads.

For example:

```text
StrategyLoader
        │
        └── loads/configures
                    │
                    ▼
          corex-strategy-engine
```

rather than placing strategy implementation inside `StrategyLoader`.

---

## 3.6 Connections and External Adapters

Application-level connection management may live under:

```text
engine/connections/
```

Examples:

```text
database connections
WebSocket connections
application-level external connections
connection lifecycle management
```

External technology integrations should normally live under adapters or their owning packages.

For example:

```text
adapters/brokers/metaapi/
adapters/market-data/twelve-data/
```

rather than making external providers part of the CoreX engine itself.

External providers must be translated into CoreX interfaces/contracts at the appropriate boundary.

---

## 3.7 Utils Ownership Rule

`utils/` is intentionally restricted.

A utility belongs in `utils/` only when it is:

1. domain-neutral,
2. reusable across multiple independent packages,
3. not responsible for application orchestration,
4. not specific to a strategy, broker, market-data provider, runtime, backtest, or other domain,
5. small enough that its ownership is obvious.

Appropriate examples may include:

```text
time utilities
ID generation
generic mathematical primitives
serialization helpers
generic collection helpers
pure validation primitives
```

Do not use `utils/` as a general repository for code that has no obvious home.

The following are generally inappropriate:

```text
utils/strategy/
utils/broker/
utils/runtime/
utils/backtest/
utils/market-data/
utils/position/
utils/execution/
```

unless the code is genuinely domain-neutral and the ownership decision is documented.

### Important

**Shared does not automatically mean `utils`.**

If multiple packages need a shared domain concept, identify the package that owns that concept or create an explicit shared domain package.

Do not move code into `utils/` merely to break an import cycle.

---

## 3.8 Dependency Direction

CoreX dependencies should form a deliberate graph rather than an uncontrolled web of imports.

Prefer:

```text
Application / Engine
        │
        ├──────────────┐
        ▼              ▼
    Domain          Adapters
    Packages       / External
        │
        ▼
   Domain-neutral
     Primitives
```

Avoid:

```text
strategy → utils → engine → broker → strategy
```

and avoid packages reaching through unrelated packages to obtain internal implementation details.

A package should depend on:

1. its own internal modules,
2. stable public contracts,
3. explicitly approved shared primitives,
4. external adapters through defined interfaces where necessary.

A package must not depend on the internal implementation of another package merely because that implementation happens to be accessible.

---

## 3.9 Public Package API

Each package must distinguish between:

```text
public API
internal implementation
```

Internal files must not become public merely because another package imports them directly.

Prefer:

```text
package
   │
   └── public API
          │
          └── internal modules
```

rather than:

```text
package A
   ├── imports random file from package B
   ├── imports random file from package B
   └── imports another internal file from package B
```

When cross-package functionality is required, expose a deliberate contract.

---

## 3.10 Legacy Code, Shims, and Migration

Legacy repository code must be treated as migration material rather than permanent architecture.

Temporary shims are allowed when they reduce migration risk.

A shim should follow:

```text
legacy path
     │
     ▼
temporary shim
     │
     ▼
new owning package
```

A shim must not become a new permanent dependency.

When a legacy module is replaced:

1. identify all consumers,
2. establish the new owner,
3. move or reimplement the functionality,
4. update imports,
5. add or update tests,
6. verify integration,
7. remove the old dependency,
8. remove the shim when no longer required.

Do not create a new implementation while leaving the old implementation silently active.

If a shim must remain temporarily, document:

```text
purpose
current consumers
target replacement
removal condition
```

Legacy `utils` modules should therefore be progressively classified as:

```text
KEEP
MOVE
REPLACE
REMOVE
SHIM TEMPORARILY
```

Do not perform a blind bulk migration.

---

## 3.11 Package Extraction Rule

When extracting functionality from the legacy repository:

```text
old global location
        │
        ▼
identify ownership
        │
        ▼
move implementation
        │
        ▼
define package API
        │
        ▼
update consumers
        │
        ▼
test
        │
        ▼
remove legacy path/shim
```

The goal is not simply to create more directories.

The goal is to create **clear ownership and predictable dependency boundaries**.

---

## 3.12 Architecture Review Before Adding Dependencies

Before adding a dependency between packages, an agent must answer:

1. Who owns this functionality?
2. Why can't the consuming package use its own implementation?
3. Is the dependency through a public contract?
4. Does this introduce a circular dependency?
5. Does this create a new global utility?
6. Could the dependency be inverted through an interface?
7. Does this dependency belong in an adapter?
8. Does the dependency make the package less portable?
9. Does it affect the hot path?
10. Is the dependency permanent or transitional?

If the answer is unclear, document the issue before proceeding.

---

## 4. Primary Entry Point

The primary operational entry point for CoreX is:

```bash
npm run menu
```

This command provides the main menu and operational entry points for the system.

Before introducing, removing, or changing project commands:

1. Inspect `package.json`.
2. Inspect the existing command implementation.
3. Check the current project workflow.
4. Preserve compatibility unless the task explicitly requires a breaking change.
5. Determine whether command behavior should be controlled by environment configuration or database-backed settings rather than hardcoded values.

The command structure is expected to evolve. Agents must therefore remain **flexible without making assumptions** about future commands.

---

## 5. Development Commands

Common commands include:

```bash
npm start
npm run dev
npm run ui:dev
npm test
npm run db:migrate
npm run menu
```

### Testing

```bash
npm test
```

Tests use Jest and follow the project's existing test discovery configuration, including:

```text
**/test/**/*.test.js
```

Do not assume that the test configuration is unchanged. Inspect the current configuration when necessary.

### Database

Database migrations are executed through:

```bash
npm run db:migrate
```

The database migration system is a protected architectural area. See the boundaries section before modifying it.

---

# 6. Configuration and Database-Backed Flexibility

CoreX must minimize hardcoded values and use appropriate configuration or database-backed settings to improve flexibility, scalability, maintainability, and operational efficiency.

## 6.1 General Configuration Rule

Do not hardcode values that are expected to vary between:

* environments
* users
* accounts
* strategies
* symbols
* broker modes
* deployments
* tenants
* runtime instances
* operational periods
* feature configurations

Examples include:

* URLs
* ports
* timeouts
* retry counts
* rate limits
* candle limits
* position limits
* risk parameters
* broker settings
* strategy parameters
* feature flags
* scheduling intervals
* pagination sizes
* cache durations
* WebSocket settings
* data retention periods
* supported symbols
* execution thresholds
* environment-specific behavior

Values that are genuinely immutable architectural constants may remain in code, but they must be clearly identified and documented.

---

## 6.2 Configuration Source Selection

Agents must select the configuration source based on the scope and lifecycle of the value.

### Use environment variables or deployment configuration for:

* secrets
* credentials
* connection strings
* hostnames
* ports
* environment identity
* infrastructure-specific settings
* deployment-specific overrides
* values that must be supplied before application startup

Never store secrets in source code or ordinary database seed data.

### Use database-backed configuration for:

* user-specific settings
* account-specific settings
* strategy parameters
* symbol-specific settings
* broker-mode settings
* runtime behavior that must change without redeploying
* operational limits that may be managed by authorized users
* feature configuration that must persist across restarts
* settings requiring audit history
* settings shared across multiple application instances
* values that must be centrally managed in a scalable deployment

### Use code constants only for:

* protocol identifiers
* immutable enum-like values
* schema-level invariants
* security-critical fixed rules
* values required to bootstrap configuration access
* architectural constraints that must not be changed at runtime

When a value is kept in code, the agent should document why it is intentionally immutable.

---

## 6.3 Database-First Rule for Runtime Behavior

If a package, module, or feature requires runtime behavior that may reasonably change over time, prefer a database-backed configuration model over hardcoded values.

This applies especially to:

* strategies
* jobs
* backtests
* brokers
* execution rules
* risk controls
* market-data settings
* user preferences
* account settings
* feature flags
* scheduling
* operational limits

The database-backed configuration must be:

* scoped correctly
* validated
* persisted
* recoverable after restart
* available to all relevant application instances
* auditable when it affects trading or financial behavior
* cached only when appropriate
* invalidated or refreshed through an explicit mechanism

Do not introduce a database lookup for every operation if a safe caching strategy is more efficient. Use a repository or configuration service with clear cache behavior instead.

---

## 6.4 Configuration Layering

Configuration should follow a predictable precedence model:

1. Immutable code-level invariants.
2. Environment or deployment configuration.
3. Database-backed configuration.
4. Request, user, strategy, or runtime-specific overrides where explicitly supported.

A lower-level configuration source must not silently override a higher-priority source.

Any override behavior must be:

* explicit
* validated
* documented
* tested
* auditable when it affects trading, execution, risk, or financial state

---

## 6.5 Centralized Configuration Access

Do not read environment variables or database configuration directly throughout unrelated modules.

Use centralized configuration services, repositories, or adapters such as:

```text
ConfigService
ConfigRepository
SettingsRepository
FeatureFlagService
```

The exact names must follow the existing project architecture.

Configuration access should provide:

* typed values
* validation
* defaults where appropriate
* clear error messages
* scope-aware lookup
* safe caching
* consistent fallback behavior
* testability

Avoid duplicating configuration parsing, validation, or fallback logic across packages.

---

## 6.6 Configuration Validation

All externally supplied or database-backed configuration must be validated before use.

Validation must cover:

* required values
* data types
* allowed ranges
* allowed enum values
* incompatible combinations
* security-sensitive constraints
* broker-mode restrictions
* strategy-specific requirements
* user or account scope
* safe defaults

Invalid configuration must fail clearly and safely.

Do not silently coerce invalid values into potentially dangerous behavior.

For trading, execution, risk, and broker configuration, fail closed where appropriate.

---

## 6.7 Defaults

Defaults are allowed only when they are safe, intentional, and documented.

Agents must not hide missing configuration by silently applying arbitrary values.

Every default should have:

* a clear reason
* an appropriate scope
* validation
* test coverage
* documentation when operationally significant

Defaults for trading, risk, execution, broker, or financial behavior require particular caution and should be recorded in `/plans/decisions.md` when introduced or changed.

---

## 6.8 Database Schema and Migrations

When introducing database-backed configuration:

1. Inspect existing schema and migration conventions.
2. Reuse existing configuration or settings tables where appropriate.
3. Avoid creating duplicate configuration stores.
4. Add migrations through the established migration system.
5. Add indexes for common lookup paths.
6. Define ownership and scope explicitly.
7. Add constraints for valid values where appropriate.
8. Add audit fields when configuration affects trading or execution.
9. Provide a safe migration and rollback strategy where supported.
10. Update relevant documentation and plans.

Do not modify `db/migrations/` casually. Database changes are protected and must preserve data integrity.

---

## 6.9 Configuration Scope

Every database-backed setting must have an explicit scope.

Possible scopes include:

* global
* environment
* tenant
* user
* account
* strategy
* symbol
* broker
* runtime
* feature

Do not use a global setting when behavior must vary by user, account, strategy, symbol, or runtime.

The configuration lookup must align with the canonical runtime identity:

```text
userId::strategyName::symbol::mode
```

Configuration must not accidentally leak across users, strategies, symbols, broker modes, or runtime instances.

---

## 6.10 Configuration Caching

Caching configuration is allowed when it improves performance without compromising correctness.

A configuration cache must define:

* cache key
* scope
* expiration or invalidation strategy
* behavior after updates
* behavior after process restart
* behavior across multiple application instances
* fallback behavior when the database is unavailable

Do not cache mutable trading, risk, or execution settings indefinitely.

When a setting affects active trading behavior, determine whether updates should apply:

* immediately
* on the next runtime
* on the next strategy execution
* after explicit reload
* only after restart

Document the chosen behavior.

---

## 6.11 Configuration Updates and Auditability

Configuration changes that affect trading, execution, risk, broker behavior, or financial state must be auditable.

Audit records should identify, where applicable:

* who changed the setting
* what changed
* previous value
* new value
* scope
* timestamp
* reason
* affected runtime, strategy, account, or symbol

Do not allow configuration changes to bypass existing audit requirements.

---

## 6.12 Hardcoded Value Review

Before completing a feature, agents must review the implementation for newly introduced hardcoded values.

Ask:

1. Is this value expected to vary?
2. Is its scope global, environment-specific, user-specific, strategy-specific, or runtime-specific?
3. Should it be stored in environment configuration?
4. Should it be stored in the database?
5. Is it an immutable architectural invariant?
6. Is the value duplicated elsewhere?
7. Can it be changed safely without redeploying?
8. Does it require validation, auditing, or migration?

If a value should not be hardcoded, refactor it into the appropriate configuration source.

---

## 6.13 Package and Feature Requirements

Packages and features must not create isolated hardcoded configuration systems.

Before adding configuration to a package or feature:

1. Search for existing configuration services and repositories.
2. Check package-level `AGENTS.md` files.
3. Check `/KNOWN_ISSUES.md`.
4. Check `/plans/decisions.md`.
5. Reuse existing configuration patterns.
6. Define the setting's scope and lifecycle.
7. Determine whether the setting belongs in the database.
8. Add validation and tests.
9. Document operational behavior.

If a package requires a new configuration abstraction, prefer a reusable shared service over a package-local duplicate.

---

## 6.14 Configuration Availability and Resilience

The application must remain predictable when configuration is unavailable.

Agents must define behavior for:

* database connection failure
* missing environment variables
* invalid database values
* stale cache entries
* partial configuration
* migration not yet applied
* configuration service timeout
* process restart
* multi-instance deployment

For critical trading or execution settings, do not silently continue with unsafe or unknown values.

---

# 7. Locked Architectural Principles

These principles are mandatory.

Do not violate, bypass, weaken, or redesign them without explicit approval from Owen.

## 7.1 Server Authority

The server is authoritative.

* The client must not contain trading decision logic.
* The client must not independently execute strategies.
* The client must not determine authoritative trading state.

UI components may display, request, or configure actions, but the server remains responsible for determining the resulting state.

---

## 7.2 Real-Time Communication

CoreX uses WebSocket-based real-time communication.

Do not introduce polling as a replacement for WebSocket communication.

If a new feature appears to require polling, investigate the existing WebSocket architecture first.

---

## 7.3 State Recoverability

System state must remain recoverable.

Important runtime state must be reconstructable after:

* process restarts
* connection loss
* crashes
* temporary service failures

Do not introduce state that exists only in an unrecoverable in-memory location unless explicitly justified and approved.

Runtime configuration that affects behavior must be persisted or reconstructable where appropriate.

---

## 7.4 Auditability

Every trading action that requires auditing must produce complete audit information.

Do not remove, bypass, weaken, or silently alter existing audit logging behavior.

Auditability takes priority over convenience.

Configuration changes that affect trading or financial behavior are also subject to audit requirements.

---

## 7.5 Strategy Loading

Strategies are loaded lazily and on demand.

Do not convert the strategy system into eager global loading without explicit approval.

Strategy parameters should be loaded through the established configuration or persistence layer rather than being hardcoded inside strategy modules.

---

## 7.6 Runtime Identity

The canonical runtime identifier is:

```text
userId::strategyName::symbol::mode
```

This is represented as:

```text
runtimeId = userId::strategyName::symbol::mode
```

Never bypass, replace, or reinterpret this scoping model without approval.

Runtime-specific configuration must use this identity consistently where applicable.

---

## 7.7 Broker Modes

CoreX supports exactly these broker modes:

```text
Backtest
Paper
Live
```

Broker behavior must flow through the established abstractions:

```text
BrokerContract
BaseBroker
RuntimeBrokerFactory
```

Do not create alternative broker execution paths that bypass these abstractions.

Broker configuration must be scoped, validated, persisted, and loaded through the established configuration architecture.

---

## 7.8 Backtest Candle Limit

The global backtest limit is:

```text
5000 candles
```

The limit is enforced at three separate gates.

Do not remove, weaken, or bypass any of these enforcement points.

If the limit must change, identify and update all three gates consistently.

If this limit becomes configurable in the future, it must be managed through a validated configuration source and all three enforcement gates must resolve the same effective value.


## 7.9 Domain Ownership

CoreX code must live with the package or layer that owns its responsibility.

Do not place domain-specific code into global utility directories merely because it is reused.

Ownership must be determined before extracting shared code.

---

## 7.10 Package Independence

A package should be as self-contained as reasonably practical.

In particular, domain packages must not depend on unrelated repository-level implementation folders when an explicit package API or contract should exist.

Package portability should be evaluated by inspecting:

```text
imports
aliases
runtime dependencies
configuration dependencies
database dependencies
filesystem dependencies
environment dependencies
```

A package is not considered architecturally independent merely because it has its own `package.json`.

---

## 7.11 Hot-Path Isolation

Runtime-sensitive paths must remain explicit and minimal.

Agents must distinguish between:

```text
hot path
cold path
initialization path
persistence path
administrative path
```

Examples of likely hot-path operations include:

```text
market-data reception
tick routing
strategy execution
indicator updates
signal generation
position updates
```

Do not place unnecessary:

```text
database operations
parameter reconciliation
configuration loading
filesystem operations
serialization
large allocations
worker IPC
```

inside a hot path without measurement and justification.

---

## 7.12 No False Performance Claims

Agents must not describe an implementation as:

```text
zero-allocation
O(1)
incremental
lock-free
real-time safe
high-performance
```

unless the relevant implementation and execution path support the claim.

Where necessary, benchmark representative workloads.

Distinguish:

```text
data structure allocation behavior
indicator update complexity
context allocation behavior
strategy allocation behavior
IPC cost
database cost
end-to-end tick latency
```

---

## 7.13 Security Boundary

Static validation or source inspection must not be treated as a complete sandbox for untrusted strategy code.

When strategy code is considered untrusted, evaluate the actual runtime boundary against:

```text
filesystem access
environment access
process creation
module loading
network access
memory exhaustion
CPU exhaustion
infinite execution
process crashes
sandbox escape
```

The appropriate isolation mechanism must be selected according to the actual threat model.

Do not weaken runtime isolation merely to simplify implementation.

---

# 8. Repository Structure and Scope

## 8.1 Package-Level Work

If a package contains its own:

```text
AGENTS.md
```

that file must be read before modifying the package.

Package-level `AGENTS.md` files:

* add rules specific to that package
* may provide implementation details
* may define package-specific workflows
* may define package-specific configuration requirements
* must not override this root `AGENTS.md`

The root `AGENTS.md` remains authoritative.

---

## 8.2 Cross-Cutting Issues

Cross-cutting or currently unassigned issues belong in:

```text
/KNOWN_ISSUES.md
```

Agents must check this file before beginning substantial work.

If a discovered issue is broader than the current task, do not silently fix it and move on.

Document it according to the self-maintenance rules.

---

## 8.3 Feature Planning

The complete feature scope is maintained in:

```text
/plans/full-feature-scope.md
```

Feature-specific implementation plans should be stored in:

```text
/plans/
```

Use plans when implementing:

* new features
* significant architectural changes
* upgrades
* multi-step refactors
* complex bug fixes
* database-backed configuration
* configuration migrations
* changes to operational limits
* changes affecting multiple packages

Plans should make future maintenance and implementation easier for other agents.

---

## 8.4 Decision Log

Architectural and implementation decisions must be recorded in:

```text
/plans/decisions.md
```

Each significant entry must include:

* timestamp
* feature or component
* decision
* reasoning
* relevant implementation consequence

Configuration-related decisions should also record:

* why the value is hardcoded, environment-based, or database-backed
* configuration scope
* precedence
* validation rules
* caching or refresh behavior
* migration implications
* audit requirements

Example structure:

```text
[YYYY-MM-DD HH:MM] Feature: <feature name>
Decision: <decision>
Reason: <reason>
```

The purpose of this file is to preserve the reasoning behind implementation choices and make future auditing possible.

---

## 8.5 Active Task Tracking

The current implementation state must be maintained in:

```text
/plans/to_do.md
```

This file should allow a new agent to quickly determine:

* what is currently being implemented
* what is completed
* what remains
* what is blocked
* what has not yet been started
* which configuration or migration work remains

Keep it current as work progresses.

---

# 9. Development Workflow

## 9.1 Branching

Never work directly on `main`.

Use:

* one feature branch per task, or
* one worktree per package/task when appropriate.

---

## 9.2 Issue-Driven Development

Each package or feature task should have a corresponding GitHub Issue containing its implementation checklist.

The checklist is the primary source of progress for that task.

Work through checklist items in order unless there is a clear dependency requiring another order.

Configuration and database work should be explicitly represented in the checklist when applicable.

---

## 9.3 Commits

Prefer small, focused commits.

Where the Issue contains individual checklist items, use approximately:

```text
one commit = one completed checklist item
```

Commit messages must describe the actual change.

Avoid large unrelated commits.

---

## 9.4 Testing Before Completion

Before marking work complete:

1. Run the relevant tests.
2. Verify the affected package.
3. Verify integration points where applicable.
4. Verify configuration validation and fallback behavior.
5. Verify database-backed settings and migrations where applicable.
6. Confirm that architectural constraints remain intact.
7. Check for unintended changes.
8. Review the diff for newly introduced hardcoded values.

Do not claim a feature is fully verified when only a partial test was performed.

---

## 9.5 Session Completion

When ending a development session, update the relevant GitHub Issue with a concise status:

```text
done: <what was completed>
next: <what should happen next>
```

Also update `/plans/to_do.md` and `/plans/decisions.md` where applicable.


## 9.6 Multi-Agent Development

CoreX may be developed and reviewed using multiple AI systems.

Examples include:

```text
Claude / Kilo Code
Codex / ChatGPT
Gemini Jules
other approved coding agents
```

No AI agent is automatically considered the architectural authority.

An implementation produced by one agent must be evaluated against:

```text
AGENTS.md
package-level guidance
architecture
public contracts
tests
performance requirements
security boundaries
existing decisions
```

Another agent may independently review the implementation.

### Implementation vs Review

Agents should distinguish:

```text
implementation
review
verification
```

An agent may implement a change without that change being considered architecturally approved.

When reviewing another agent's work:

1. inspect the actual diff,
2. identify the stated problem,
3. determine whether the change solves that problem,
4. inspect adjacent behavior,
5. check for duplicated implementations,
6. check package ownership,
7. check dependency direction,
8. check hot-path impact,
9. run relevant tests,
10. identify regressions or unresolved issues.

Do not approve an implementation merely because:

```text
tests pass
the implementing agent claims it is fixed
the code looks cleaner
another AI recommended it
```

Passing tests establish evidence for the tested behavior, not automatic architectural correctness.

---

## 9.7 Jules / External Coding Agents

Gemini Jules and other external coding agents may be used for small implementation tasks.

Before accepting their changes into the architecture:

```text
inspect → understand → test → review → accept or modify
```

Small implementation tasks must not silently introduce:

* new architectural layers,
* duplicate abstractions,
* new global utilities,
* alternative execution paths,
* bypasses around protected contracts,
* package boundary violations,
* unapproved configuration systems.

The repository remains the source of truth.

---

# 10. Human Verification Requirements

AI agents must distinguish between:

```text
implemented
tested
verified
```

These are not interchangeable.

## Market Data — Issue #2

Real data files and/or credentials may be required for complete verification.

Mocked data is acceptable for unit tests but does not constitute full real-world verification.

Market-data endpoints, symbols, intervals, retention, and provider settings should not be hardcoded when they are expected to vary by environment, account, or deployment.

---

## Jobs / Backtest — Issue #8

Realistic data is required for complete end-to-end verification.

Synthetic or mocked data may be used for unit and isolated tests.

Backtest limits, job settings, data ranges, and execution parameters must use the appropriate validated configuration source rather than duplicated hardcoded values.

---

## Broker / Execution — Issue #1

Paper and Live execution require Owen's real broker credentials for complete end-to-end verification.

Agents must not claim Live or Paper execution is fully verified when credentials or real broker connectivity were not available.

Broker credentials must be supplied through secure environment or secret-management mechanisms. Non-secret broker behavior and operational settings should use validated configuration or database-backed settings where appropriate.

---

## Synthetic Data Rule

Whenever synthetic, mocked, simulated, or placeholder data is used in place of real data:

* clearly state that fact
* do not describe the feature as fully verified
* record the limitation in the relevant Issue when appropriate

---

# 11. Protected Boundaries

The following areas require explicit approval before architectural modification.

### Protected

* `runtimeId` scoping scheme
* `BrokerContract`
* broker execution architecture
* `BaseBroker`
* `RuntimeBrokerFactory`
* `db/migrations/`
* audit logging behavior
* WebSocket-only real-time architecture
* server-authoritative trading logic
* three-gate 5000-candle backtest limit
* configuration precedence for security-sensitive or trading-critical values
* secret-management mechanisms
* any other boundary explicitly documented in this file
* any boundary explicitly documented in `/KNOWN_ISSUES.md`
* any package-level boundary documented in that package's `AGENTS.md`

If a task appears to require changing one of these boundaries:

**Stop and ask Owen before proceeding.**

Adding ordinary database-backed configuration is encouraged when it follows the rules in this document, but changing protected architecture, configuration precedence, or security behavior requires approval.

---

# 12. Self-Maintenance Rule

This repository's documentation is living infrastructure.

When an agent discovers a new:

* issue
* architectural constraint
* limitation
* recurring failure
* workflow requirement
* implementation boundary
* hardcoded value that should be configurable
* configuration inconsistency
* missing validation rule
* missing migration
* unsafe fallback
* configuration scope problem

that is not already documented, the agent must document it.

Use the appropriate location:

| Situation                   | Location                       |
| --------------------------- | ------------------------------ |
| Repository-wide rule        | `AGENTS.md`                    |
| Package-specific rule       | Package `AGENTS.md`            |
| Cross-cutting issue         | `/KNOWN_ISSUES.md`             |
| Feature scope               | `/plans/full-feature-scope.md` |
| Feature implementation plan | `/plans/`                      |
| Architectural decision      | `/plans/decisions.md`          |
| Active work                 | `/plans/to_do.md`              |
| Architecture / settings / system audit | `/plans/Audit/` |

Keep issue entries concise, preferably one line.

Do not ask Owen to document something that the agent has already discovered and is capable of recording itself.

Document it and continue working.

Do not duplicate information that is already documented elsewhere.

---

# 13. Secrets and Security

Never commit:

* API keys
* broker credentials
* database passwords
* private keys
* authentication tokens
* session secrets
* personal credentials
* production secrets

Use the project's established secret-management mechanism.

Before committing changes, inspect the diff for accidentally exposed credentials or sensitive configuration.

Secrets must not be moved into ordinary database-backed configuration unless the project has an approved encrypted secret-management design.

---

# 14. Change Discipline

Before modifying existing architecture, agents should determine:

1. Where the current behavior is implemented.
2. Which modules depend on it.
3. Which tests cover it.
4. Whether the behavior is documented as a protected boundary.
5. Whether the change affects runtime identity, state, persistence, execution, or auditing.
6. Whether the value is hardcoded and should be configurable.
7. Whether the configuration belongs in environment variables, deployment configuration, or the database.
8. What scope the configuration requires.
9. How configuration will be validated, cached, refreshed, and audited.
10. Whether a migration, plan, or decision entry is required.

Do not rewrite working architecture merely because another implementation appears cleaner.

Prefer:

```text
understand → classify configuration → isolate → change → validate → test → verify → document
```

over:

```text
rewrite → hope → debug
```

---

# 15. Agent Operating Principles

Agents working on CoreX should:

* inspect before modifying
* follow existing architecture
* reuse established abstractions
* minimize hardcoded values
* use environment configuration for deployment-specific values
* use secure secret management for secrets
* use database-backed configuration for persistent, scoped, runtime-manageable behavior
* centralize configuration access
* validate all external and database-backed configuration
* define configuration scope explicitly
* keep changes focused
* preserve backward compatibility where possible
* test affected behavior
* document newly discovered constraints
* maintain project planning files
* respect protected boundaries
* distinguish implementation from verification
* leave the repository in a state another agent can continue from
* classify code by ownership before moving it
* prefer package ownership over legacy location
* keep `utils/` small and domain-neutral
* treat shims as temporary migration mechanisms
* expose package functionality through deliberate public APIs
* inspect dependency direction before adding imports
* distinguish engine orchestration from domain implementation
* distinguish adapters from domain packages
* distinguish hot-path and cold-path operations
* independently review AI-generated implementations
* verify changes against the actual repository rather than an agent's description
* remove obsolete implementations after migration
* avoid creating duplicate sources of truth

Agents should not:

* invent undocumented architecture
* bypass existing abstractions
* silently change protected behavior
* remove safeguards to make tests pass
* introduce duplicate configuration systems
* scatter environment-variable reads throughout business logic
* hardcode values that should be configurable
* store secrets in source code or ordinary database tables
* use global configuration for user-, account-, strategy-, symbol-, or runtime-specific behavior
* silently apply unsafe defaults
* mark unverified functionality as verified
* silently ignore known issues
* work directly on `main`
* use `utils/` as a dumping ground
* copy strategy-specific logic into global utilities
* import another package's internal files without an explicit reason
* create circular package dependencies
* preserve legacy architecture solely because it is already present
* assume an AI-generated patch is architecturally correct
* introduce a second implementation without identifying which implementation is authoritative
* call a package modular merely because it has a separate directory
* introduce infrastructure merely to hide an unresolved ownership problem

---

# 16. Final Pre-Completion Checklist

Before declaring a task complete, confirm:

* [ ] Relevant `AGENTS.md` files were read.
* [ ] `SKILLS.md` was followed.
* [ ] `/KNOWN_ISSUES.md` was checked.
* [ ] `/plans/to_do.md` was updated where necessary.
* [ ] `/plans/decisions.md` was updated where necessary.
* [ ] Relevant tests were executed.
* [ ] Configuration values were reviewed for unnecessary hardcoding.
* [ ] Configuration sources were selected according to scope and lifecycle.
* [ ] Database-backed settings include appropriate validation, indexes, constraints, and migrations.
* [ ] Configuration precedence is explicit and tested where applicable.
* [ ] Configuration caching and refresh behavior are defined where applicable.
* [ ] Trading, execution, risk, and financial configuration changes are auditable where required.
* [ ] No protected architectural boundary was violated.
* [ ] No secrets were introduced.
* [ ] Documentation was updated if a new constraint or issue was discovered.
* [ ] The GitHub Issue checklist reflects the actual implementation state.
* [ ] Any remaining human verification requirements are clearly stated.
* [ ] The working tree contains no unrelated changes.

---

# 17. Core Principle

> **Understand the existing system before changing it. Organize CoreX by ownership rather than historical folder location. Keep domain logic inside the package that owns it, keep the engine responsible for orchestration, keep adapters responsible for external systems, keep `utils` genuinely domain-neutral, treat shims as temporary migration mechanisms, use explicit package APIs and dependency boundaries, minimize hardcoded values, preserve architectural guarantees, independently review AI-generated changes, verify what can be verified, document what cannot, and leave the repository easier for the next agent to understand than you found it.**
