# Codebase Structure Analysis: Should We Split the Server?

## Current Architecture

```
corex-engine/
├── index.js                     # Entry point
├── package.json                 # Root — aliases: @core, @broker, @data, @events, @config
├── engine/                      # Main server codebase (Express + trading logic)
│   ├── server.js                # Express app, routes, WebSocket upgrade
│   ├── engine.js                # Trading engine entry
│   ├── core/                    # Pipeline, runtime, strategy, lifecycle
│   ├── routes/                  # 9 controllers + routeHelpers
│   ├── middleware/              # authGuard, roleGuard, rateLimit, validateBody
│   ├── services/                # 25 services (authService, pgStore, secretsVault, ...)
│   ├── managers/                # strategyManager
│   ├── workers/                 # jobWorker, strategyWorker
│   └── backtestManager.js
├── broker/                      # Legacy broker code (being replaced by corex-broker-contract)
├── events/                      # Event bus (shared)
├── utils/                       # Utilities (logger, etc.)
├── config/                      # Configuration
├── db/migrations/               # SQL migrations (001-024+)
├── test/                        # Integration tests
├── packages/                    # Extracted packages
│   ├── corex-broker-contract/   # Package 1 — pure logic, no Express/DB
│   └── corex-market-data/       # Package 2 — pure logic, no Express/DB
├── front_end/                   # React UI
└── scripts/                     # CLI scripts (menu, migrate, etc.)
```

## Existing Package Extraction Pattern

### Package 1: corex-broker-contract
- **What was extracted**: BrokerContract interface, BaseBroker, drivers, connectors, RuntimeBrokerFactory, utilities
- **Dependencies**: `@events` (eventemitter3), `@utils/logger`, `@core` (minimal — config only)
- **NO Express.js**, **NO PostgreSQL** — pure trading logic

### Package 2: corex-market-data
- **What was extracted**: DataProviderContract, providers, DataProviderFactory, MarketFeed
- **Dependencies**: `@events` (bus), `@utils/logger`, `@core` (engine.js for warmup cache), `@broker` (SymbolNormalizer)
- **NO Express.js**, **NO PostgreSQL** — pure market data logic

### Key pattern: packages are **pure-logic**, with re-export shims in `engine/`

## Auth Package Analysis (Package 3)

### Pure-logic components (CAN extract to package):
| File | Lines | Dependencies | Extractable? |
|------|-------|-------------|-------------|
| `authService.js` | 97 | None (only Node.js `crypto`) | YES |
| `secretsVault.js` | 413 | None (only Node.js `crypto`) | YES |

### DB-coupled components (STAY in engine):
| File | Lines | DB Coupled? | Extractable? |
|------|-------|-------------|-------------|
| `pgStore.js` | 767 | Yes — postgres queries for users/sessions/api_keys/accounts | NO (needs injected DB) |
| `authGuard.js` | 233 | Yes — requires pgStore + postgres in middleware | NO (Express middleware) |
| `authController.js` | 344 | Yes — Express router + pgStore + authService | NO (Express routes) |
| `roleGuard.js` | 1.2K | Yes — requires req.user from authGuard | NO (Express middleware) |
| `validateBody.js` | 1.9K | No — pure Express validation | MAYBE (but generic, not auth-specific) |
| `connectorSettingsService.js` | 275 | Yes — postgres + secretsVault | NO |

### DB Tables (auth-related migrations):
| Table | Migration | Purpose |
|-------|-----------|---------|
| `users` | 001 | User accounts |
| `corex_sessions` | 020 | Session tracking + revocation |
| `user_api_keys` | 012 | API key storage + TTL |
| `user_connector_settings` | 021 | Per-user encrypted connector credentials |

## Should We Create a Separate Server Package?

### Arguments against (strong):
1. **Auth is tightly coupled to Express + PostgreSQL** — unlike broker-market-data packages which are pure logic
2. **authGuard middleware protects ALL engine routes** (server.js line 64-71) — can't function without server
3. **pgStore.js mixes auth + strategy + backtest + account operations** — splitting auth-only subset requires DI pattern, adding complexity
4. **connectorSettingsService.js** depends on both `postgres` and `secretsVault` — extraction would require injecting both
5. **DB migrations** (012, 020, 021) cross-reference `users`, `backtests`, `orders`, `paper_trades` — domain-specific to engine
6. **Only 2 prior packages extracted** — both pure-logic. Creating a server package would be a fundamentally different scope.

### Arguments for (moderate):
1. `test:auth` script exists in package.json (but test files don't exist yet)
2. Auth is a common concern — could theoretically be reused
3. Pure crypto pieces (authService, secretsVault) have no dependencies

### Recommendation: **DON'T split the server. Follow existing Package pattern.**

Extract only the two pure-logic files to `packages/corex-auth/`:
- `authService.js` → `packages/corex-auth/src/AuthService.js` (JWT + password hashing)
- `secretsVault.js` → `packages/corex-auth/src/SecretsVault.js` (AES-256-GCM)

Everything else stays in `engine/` — it's deeply integrated with Express and PostgreSQL. Create re-export shims:
- `@core/services/authService` → points to package file
- `@core/services/secretsVault` → points to package file

This follows the EXACT same pattern as Packages 1 and 2: pure-logic extraction + re-export shims. No server package needed.

## What About Package 3 (Issue #3)?

Issue #3 says: "Extract session/credential handling (per-user AES-encrypted connector credentials, corex_sessions revocation. Nearly self-contained already."

The "nearly self-contained" refers to:
- **secretsVault.js** (AES encryption) — genuinely self-contained
- **authService.js** (JWT + password hashing) — genuinely self-contained
- **corex_sessions revocation logic** — lives in `authGuard.js`, which requires pgStore + Express

The DB-coupled parts (session revocation, API key management, connector credential storage) can't be cleanly extracted without a significant DI refactor across the entire engine. That's not worth it for Package 3.

### Approach for Package 3:
1. Extract `authService.js` and `secretsVault.js` to `packages/corex-auth/src/`
2. Create re-export shims in `engine/services/`
3. Write unit tests (no DB needed): `test/auth.service.test.js`, `test/secretsVault.test.js`
4. Create `packages/corex-auth/AGENTS.md`
5. Add `@auth` alias in root `package.json`
6. Update `test:auth` script to point to new test files

This keeps the existing pattern: pure-logic in packages, engine-coupled code in `engine/`.
