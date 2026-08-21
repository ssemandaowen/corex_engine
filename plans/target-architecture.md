# CoreX Target Architecture — Modular Monolith Roadmap

> **Date:** 2026-08-22
> **Author:** Kilo (AI assistant) + Owen Ssemanda
> **Purpose:** Define target architecture before further extraction. Preserve reasoning for audit.

---

## 1. Architectural Goal

Build a **modular monolith** where:

- Each business capability lives in its own package
- New features = write ONE package, touch ZERO existing code
- Packages communicate via events (loose coupling)
- The `engine/` directory becomes a thin composition root (I/O only)
- System is **dynamic, flexible, efficient, scalable, fast**

---

## 2. Target Package Map

### Extracted (Done)

| Package | Location | Owns |
|---------|----------|------|
| `corex-broker-contract` | `packages/corex-broker-contract/` | BrokerContract interface, drivers (Backtest/Paper/Live/REST), BaseBroker, RuntimeBrokerFactory, SymbolNormalizer, SharedFillSim, DataPaginationLayer |
| `corex-market-data` | `packages/corex-market-data/` | DataProviderContract, providers (TwelveData/Yahoo/File), DataProviderFactory, MarketFeed, backtestDataResolver |
| `corex-auth` | `packages/corex-auth/` | AuthService (JWT + scrypt), SecretsVault (AES-256-GCM) |

### To Extract (Planned)

| Package | Location | Owns | Priority |
|---------|----------|------|----------|
| `corex-strategy-engine` | `packages/corex-strategy-engine/` | Strategy loading, compilation, signal generation, SignalExecutionEngine, SignalGenerationEngine, SignalProcessingEngine | HIGH |
| `corex-execution` | `packages/corex-execution/` | Order management, fill tracking, execution controller logic, liveOrderDispatcher | HIGH |
| `corex-portfolio` | `packages/corex-portfolio/` | Position tracking, P&L calculation, equity curves, trade history, brokerPersistence | HIGH |
| `corex-jobs` | `packages/corex-jobs/` | Job queue, job worker, backtest runner, backtestManager | MEDIUM |
| `corex-risk` | `packages/corex-risk/` | Risk checks, position limits, drawdown limits, broker settings validation | MEDIUM |
| `corex-notifications` | `packages/corex-notifications/` | Alerts, reporting, system health broadcasts | LOW |
| `corex-settings` | `packages/corex-settings/` | Per-user settings, broker settings, system settings, configService, userEngineSettingsService | LOW |

---

## 3. Engine Role (After Extraction)

The `engine/` directory becomes a **thin composition root**:

```
engine/
├── server.js        ← Express app setup, route mounting, WebSocket upgrade
├── wiring.js        ← Wires packages together (DI container)
├── lifecycle.js     ← Boot sequence, shutdown, health checks
└── routes/          ← Thin controllers that delegate to packages
    ├── authController.js     → delegates to corex-auth
    ├── strategyController.js → delegates to corex-strategy-engine
    ├── executionController.js → delegates to corex-execution
    ├── backtestController.js → delegates to corex-jobs
    └── ...
```

**Engine must NOT contain:**
- Business logic (signal generation, order decisions, risk calculations)
- Direct broker communication (goes through corex-broker-contract)
- Direct market data fetching (goes through corex-market-data)
- DB queries for business entities (each package has its own repositories)

---

## 4. Communication Pattern

### Event-Driven (Loose Coupling)

Packages communicate via the shared event bus (`@events/bus`):

```
┌─────────────────────────────────────────────────────────────────┐
│                        EVENT BUS (@events/bus)                   │
├─────────────────────────────────────────────────────────────────┤
│  strategy:generated     → execution listens                      │
│  order:submitted        → broker-contract listens                │
│  order:filled           → portfolio listens                      │
│  order:filled           → risk listens                           │
│  broker:state_changed   → portfolio listens                      │
│  data:tick              → strategy-engine listens                │
│  job:completed          → notifications listens                  │
│  risk:breach            → execution listens (blocks order)       │
│  system:health          → notifications listens                  │
└─────────────────────────────────────────────────────────────────┘
```

### Direct Calls (When Necessary)

For synchronous operations where event-driven is impractical:

```js
// execution calls broker-contract directly
const broker = RuntimeBrokerFactory.createBroker("live", { symbol, runtimeId });
await broker.submit(order);
```

### Rule of Thumb

| Use Events When | Use Direct Calls When |
|-----------------|----------------------|
| Multiple packages care about the same thing | Only one caller, one callee |
| Timing can be async | Response needed immediately |
| Decoupling is valuable | Operation is a single logical step |

---

## 5. Package Dependencies

```
                    ┌──────────────────────┐
                    │   corex-broker-contract │
                    └──────────▲─────────────┘
                               │ implements
                    ┌──────────┴─────────────┐
                    │      corex-execution     │
                    └──────────▲─────────────┘
                               │ updates
                    ┌──────────┴─────────────┐
                    │      corex-portfolio      │
                    └──────────▲─────────────┘
                               │ reads
┌──────────────────┐  ┌────────┴───────────┐  ┌──────────────────┐
│ corex-market-data │  │ corex-strategy-engine│  │ corex-risk       │
└──────────────────┘  └────────────────────┘  └──────────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │ emits events
                    ┌───────────┴───────────┐
                    │     @events/bus        │
                    └───────────────────────┘
```

### Allowed Dependencies

| Package | Can Depend On |
|---------|---------------|
| `corex-broker-contract` | `@events/bus`, `@utils/logger`, `@config/constants` |
| `corex-market-data` | `@events/bus`, `@utils/logger`, `@config/constants`, `corex-broker-contract` (SymbolNormalizer, DataPaginationLayer) |
| `corex-auth` | `@utils/logger` (no DB, no Express) |
| `corex-strategy-engine` | `@events/bus`, `@utils/logger`, `@config/constants`, `corex-auth` (for strategy ownership) |
| `corex-execution` | `@events/bus`, `@utils/logger`, `corex-broker-contract`, `corex-risk` |
| `corex-portfolio` | `@events/bus`, `@utils/logger`, `@config/constants` |
| `corex-jobs` | `@events/bus`, `@utils/logger`, `corex-strategy-engine`, `corex-execution` |
| `corex-risk` | `@events/bus`, `@utils/logger`, `@config/constants` |

### Forbidden Dependencies

| Package | Must NOT Depend On |
|---------|-------------------|
| `corex-auth` | Express, PostgreSQL, any other package |
| `corex-broker-contract` | `corex-execution`, `corex-portfolio` (lower layers must not depend on higher layers) |
| `corex-market-data` | `corex-strategy-engine`, `corex-execution` |

---

## 6. Migration Strategy

### Phase 1: Foundation (Done)
- [x] Extract `corex-broker-contract`
- [x] Extract `corex-market-data`
- [x] Extract `corex-auth`
- [x] Simplify auth (30-day JWT, remove API keys)

### Phase 2: Core Trading (Next)
- [ ] Extract `corex-strategy-engine` (signal generation + execution)
- [ ] Extract `corex-portfolio` (positions, P&L, trade history)
- [ ] Extract `corex-execution` (order management)
- [ ] Wire via events

### Phase 3: Operations
- [ ] Extract `corex-jobs` (backtest runner, job queue)
- [ ] Extract `corex-risk` (risk checks, limits)
- [ ] Extract `corex-settings` (per-user config)

### Phase 4: Polish
- [ ] Extract `corex-notifications` (alerts, reporting)
- [ ] Thin out `engine/` (remove business logic, keep only I/O)
- [ ] Delete obsolete tests, write integration tests
- [ ] Document final architecture

---

## 7. Package Convention

Each package follows this structure:

```
packages/corex-{name}/
├── AGENTS.md            ← package-specific rules + boundaries
├── package.json         ← private, lists deps, jest config
├── index.js             ← public API (re-exports)
├── src/
│   ├── {Module}.js      ← implementation
│   └── ...
├── test/
│   ├── {Module}.test.js ← unit tests (no DB, no Express)
│   └── ...
└── legacy/              ← (optional) copied code being replaced
```

### Package Rules

1. **Pure logic first** — if it can be tested without DB/Express, it goes in a package
2. **Re-export shims** — `engine/services/{name}.js` re-exports from package for backward compat
3. **@module-alias** — each package gets its own aliases in `package.json`
4. **No circular deps** — lower layers never import from higher layers
5. **Events for cross-package** — packages don't import each other directly (use @events/bus)

---

## 8. Audit Trail

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-08-22 | Define target architecture BEFORE further extraction | Avoid "organized piles" — need clear target to rebuild professionally |
| 2026-08-22 | Engine becomes thin composition root | Separation of concerns: I/O vs business logic |
| 2026-08-22 | Event-driven communication | Loose coupling, easy to add new features without touching existing code |
| 2026-08-22 | Leaf-first extraction order | Extract packages with no dependents first, work up the dependency tree |

---

## 9. Open Decisions (Flagged for Owen)

1. **Event bus granularity** — One global bus or per-domain buses?
2. **Database access** — Each package owns its tables, or shared DB layer?
3. **Frontend coupling** — Should `front_end/` import packages directly, or go through engine API only?
4. **Migration approach** — Big-bang rewrite or incremental strangler fig?
5. **Testing strategy** — How much integration testing vs unit testing?

---

## 10. Core Principle

> **Understand the target before moving. Extract toward a clear architecture, not away from a messy monolith. Each package should own a complete, testable, replaceable business capability.**
