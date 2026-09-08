# Package 3: corex-auth — Discussion Notes for AI Collaboration

## Overview
Issue #3: "Extract session/credential handling (per-user AES-encrypted connector credentials, corex_sessions revocation. Nearly self-contained already.)"

**Status**: Project board → Todo (not yet started)
**Branch**: `feature/corex-auth` (not yet created)

## Current State

### Existing Auth Files (all in `engine/`)
| File | Lines | Role |
|------|-------|------|
| `engine/services/authService.js` | 97 | JWT sign/verify, password hash/verify (scrypt) |
| `engine/services/secretsVault.js` | 413 | AES-256-GCM encryption, key rotation, object secret helpers |
| `engine/services/pgStore.js` | 767 | User CRUD, API key management, session management, account CRUD |
| `engine/routes/authController.js` | 344 | Signin, signout, register, bootstrap, me, API key CRUD |
| `engine/middleware/authGuard.js` | 233 | Dual-path: JWT Bearer + API key auth, session revocation check |
| `engine/middleware/roleGuard.js` | 1.2K | Role-based access control |

### Database Tables (migrations)
| Table | Migration | Purpose |
|-------|-----------|---------|
| `users` | 001 | User accounts (email, name, role, password_hash) |
| `corex_sessions` | 020 | Session tracking for revocation (session_id, user_id, revoked_at) |
| `user_api_keys` | 012 | API keys (key_hash, status, expires_at, last_used_at) |
| `user_connector_settings` | 021 | Per-user encrypted connector credentials (config_json + encrypted_secrets) |
| `user_system_settings` | 012 | Per-user engine settings override |
| `user_broker_settings` | 012 | Per-user broker configuration (mode-specific cash, config) |

### Package.json
- `test:auth` script exists but **test files don't exist**:
  - `jest --runInBand test/auth.service.test.js test/auth.integration.test.js`

## Extraction Scope (What goes in `packages/corex-auth/`)

**Core auth logic to extract:**
1. `authService.js` → JWT + password hashing (straightforward, pure crypto)
2. `secretsVault.js` → AES encryption/decryption (straightforward, pure crypto)
3. `pgStore.js` (auth subset) → Session management, API key CRUD, user CRUD
4. `authGuard.js` → Middleware (needs DB dependency — how to inject?)
5. `roleGuard.js` → Role checking middleware
6. `authController.js` → Express routes (needs DB + authService + secretsVault)

**NOT clear what to extract:**
- `connectorSettingsService.js` (9KB) — handles connector config. Related to `user_connector_settings` table. Is this auth or a separate package?
- `validateBody.js` middleware — was deleted from main, exists only in WIP branch. Auth-related?
- `hashVerifier.js` service — 3.5KB. Password/session verification? Auth-related?

## Questions for Discussion

### Q1: Auth package database dependency
**Problem**: `authGuard.js` and `authController.js` directly `require("@core/services/postgres")` and `@core/services/pgStore`. If we extract these into `packages/corex-auth/`, how should the DB dependency be provided?

**Options:**
- A) Pass a `db` instance via constructor/factory (DI pattern — like `RuntimeBrokerFactory`)
- B) Keep `pgStore.js` in `packages/corex-auth/` with a `pgStoreFactory(db)` that accepts an injected DB connection
- C) Keep auth routes/middleware in engine, only extract pure crypto logic (JWT, scrypt, AES)

**Discussion needed**: What precedent exists? Package 1 (broker contract) used static `BaseBroker.getModeConfig()` without DB. Package 2 used no DB at all.

### Q2: API key caching strategy
**Problem**: `authGuard.js` maintains an in-memory `Map` cache (`keyCache`) with TTL 60s and max 5000 entries. If auth is extracted as a package, should this cache:
- A) Stay as a module-level singleton (current approach)
- B) Be injected per-instance (needed for multi-process / cluster)
- C) Use Redis/external cache

**Current concern**: The cache check at line 182 (`getCachedApiKeyUser`) skips DB lookup but then `verifyApiKeyStillActive(keyId)` does a DB call anyway. The cache only saves the `pgStore.resolveUserByApiKey` lookup. Is this the intended pattern?

### Q3: Connector credentials encryption key source
**Problem**: `secretsVault.js` uses `COREX_SECRETS_KEY` from env. But the issue says "per-user AES-encrypted connector credentials." The current secretsVault uses a **global** key, not per-user.

**Key question**: Should each user's connector credentials be encrypted with a **user-derived key** (from password/scrypt) so that even a DB dump + secrets key compromise can't reveal credentials? Or is the global key sufficient (credentials encrypted at rest, but server can decrypt all)?

**Current state**: `user_connector_settings.encrypted_secrets` is encrypted with the global `COREX_SECRETS_KEY`. The `secretsVault.DEFAULT_SECRET_PATHS` shows hardcoded paths for `twelveDataApiKey`, `metaApi.token`, `mt5Bridge.*` — these are integration configs, not user-specific per-user keys.

**Need clarification**: Is per-user key derivation a requirement, or is global-key AES acceptable for Package 3?

### Q4: Session revocation semantics
**Problem**: The issue mentions "corex_sessions revocation." Currently:
- `signout` sets `revoked_at = NOW()` on the session (line 216-220 of authController.js)
- `authGuard` checks `revoked_at IS NOT NULL` (line 82-84)
- If session not found in DB → treated as revoked (line 76-80)
- If DB unavailable → degrades to JWT-only auth (line 93-100)

**Question**: Is the "session not found → revoked" behavior intentional? A JWT with a valid signature but missing session record is rejected. This means:
- Sessions must always be created in DB on signin (can't rely on JWT alone)
- DB must remain available for any JWT validation (otherwise, degraded mode accepts expired-but-not-revoked tokens)

### Q5: API key rotation / re-keying
**Problem**: `pgStore.resolveUserByApiKey` hashes the key with a pepper (`API_KEY_PEPPER`) and compares. I don't see:
- Key rotation (re-issuing a key with a new hash)
- Last-used tracking update (`touchApiKeyUsage` exists but when is it called?)
- Rate limiting on API key validation (timing attack protection?)

### Q6: roleGuard.js vs authGuard.js boundary
**Problem**: `roleGuard.js` is 1.2KB. Is it:
- A) A wrapper around authGuard (checks auth first, then role)
- B) An independent middleware (assumes auth already done, just checks role)

Looking at the name, it seems like it should run AFTER authGuard. But is it in `middleware/` because it's a separate step, or should it be bundled with authGuard in the auth package?

### Q7: validateBody.js (deleted from main)
This file was committed in Package 2 but `git status` shows it as a stray uncommitted file. It seems to be a request body validation middleware. Is this auth-package territory (validating auth request bodies) or a shared utility?

## Logic Gaps / Things That Need Work

### Gap 1: No API key TTL enforcement on creation
- `authController.js` line 173: `authKeyTtlDays` from body, but the DB schema has `expires_at TIMESTAMPTZ`
- Need to verify the TTL is actually applied to the `expires_at` column, not just stored somewhere else

### Gap 2: No session cleanup / expiry
- `corex_sessions` has `revoked_at` but no automatic expiry
- Old sessions accumulate — is there a cleanup job? (Migration 020 doesn't add one)

### Gap 3: secretsVault key format validation incomplete
- `_normalizeKey` accepts hex (64 chars) and base64 (44 chars), but the error messages don't indicate what format is expected
- No unit tests for secretsVault.js exist

### Gap 4: Password strength check is minimal
- `authController.js` line 64: only checks `password.length < 8`
- No complexity requirements, no breach check, no common-password blacklist

### Gap 5: No CSRF protection
- JWT Bearer token in `Authorization` header (stateless) — CSRF not applicable
- But API key via `x-auth-key` header or `Authorization: ApiKey ...` — also header-based, so CSRF not applicable
- However, if cookies are used anywhere (for web UI), CSRF protection needs to be in place

## Desired Logic / Design Goals

### DI Goal: Testable auth without PostgreSQL
```
packages/corex-auth/
  src/
    AuthService.js          — JWT sign/verify, password hash/verify (no DB)
    SecretsVault.js         — AES-256-GCM encrypt/decrypt (no DB)
    pgStore.js              — DB operations, accepts injected `db` instance
    authGuard.js            — middleware factory: createAuthGuard({ db, pgStore, authService })
    authRoutes.js           — Express router factory: createAuthRouter({ db, pgStore, authService, secretsVault })
  test/
    authService.test.js      — unit tests (no DB needed)
    secretsVault.test.js     — unit tests (no DB needed)
    pgStore.test.js          — mocked DB tests
    authGuard.test.js        — mocked middleware tests
  AGENTS.md                  — package-level guide
```

### Re-export shims needed in engine/
- `@core/services/authService` → `packages/corex-auth/src/AuthService.js`
- `@core/services/secretsVault` → `packages/corex-auth/src/SecretsVault.js`
- `@core/services/pgStore` → `packages/corex-auth/src/pgStore.js`
- `@core/middleware/authGuard` → `packages/corex-auth/src/authGuard.js`

### Migration considerations
- DB migrations (001, 012, 020, 021) already exist and are applied — no schema changes needed
- BUT: `012_user_auth_isolation.sql` is the only migration that touches auth tables beyond creation
- Need to check if `012` has been applied or has issues (it does cross-table updates with `::` strategy names — relates to Package 1's `runtimeId` scoping)

## Package 2 Parallel: How Package 2 did it
- Package 2 created `packages/corex-market-data/` with `package.json` (private, no deps for TwelveData; `yahoo-finance2` added per-package)
- Package-level `AGENTS.md` created
- Tests run in isolation: `jest packages/corex-market-data/test/`
- Integration via `@data` alias + re-export shims in `engine/core/data/`
- Package 2 did NOT touch `db/migrations/` (no schema changes)

**Same pattern expected for Package 3** — extract code, create shims, no migration changes needed.

## Checklist Draft (for GitHub Issue #3)

1. [ ] Create `packages/corex-auth/` with `src/` + `test/` + `package.json`
2. [ ] Extract `authService.js` → `AuthService.js` (pure crypto, no DB)
3. [ ] Extract `secretsVault.js` → `SecretsVault.js` (pure crypto, no DB)
4. [ ] Extract `pgStore.js` auth subset → accept injected `db` instance
5. [ ] Extract `authGuard.js` → factory pattern with DI
6. [ ] Extract `authController.js` → factory pattern with DI
7. [ ] Create re-export shims in `engine/services/` and `engine/middleware/`
8. [ ] Wire `@auth` alias in `packages/corex-auth/package.json` + root `package.json`
9. [ ] Write `packages/corex-auth/AGENTS.md`
10. [ ] Write unit tests for AuthService (JWT, password hashing)
11. [ ] Write unit tests for SecretsVault (encrypt/decrypt, rotation)
12. [ ] Write unit tests for pgStore auth methods (mocked DB)
13. [ ] Write integration tests for authGuard (mocked middleware)
14. [ ] Update `test/auth.service.test.js` and `test/auth.integration.test.js` (create these files)
15. [ ] Run `npm test` — all tests pass
16. [ ] Append to `/plans/decisions.md`

## Open Decisions (flagged for Owen)

1. **Per-user encryption keys**: Global key vs user-derived key for connector credentials
2. **Auth DB dependency injection**: Factory pattern (A) vs injected db instance (B) vs keep in engine (C)
3. **Session expiry**: Need a cleanup cron job for old sessions?
4. **validateBody.js**: Belongs in auth package or shared utils?
5. **API key rotation**: Need a re-keying endpoint?

## References
- Issue #3: https://github.com/ssemandaowen/corex_engine/issues/3
- Migration 020: `db/migrations/020_sessions.sql`
- Migration 021: `db/migrations/021_user_connector_settings.sql`
- SecretsVault: `engine/services/secretsVault.js` (413 lines)
- AuthService: `engine/services/authService.js` (97 lines, simple)
- pgStore: `engine/services/pgStore.js` (767 lines, mixed user/strategy/backtest/account storage)
