# corex-auth Extraction — Discovery Notes

> **Date:** 2026-08-30
> **Task:** Extract corex-auth — pure-crypto pieces only (authService.js + secretsVault.js)
> **Reference:** 2026-08-21 decision in plans/decisions.md (Server package split analysis)

---

## Discovery: extraction already executed

The extraction described by this task has **already been completed** in commit `cc86c34` (2026-08-22) "Package 3: Extract corex-auth package". No code changes were required for this task — only verification and documentation.

### What was found at the expected locations

| Expected location | Status |
|---|---|
| `packages/corex-auth/package.json` | Present, version 2026.1.21 |
| `packages/corex-auth/index.js` | Present — re-exports AuthService + SecretsVault + named exports |
| `packages/corex-auth/src/AuthService.js` | Present — 97 lines, pure `crypto` only |
| `packages/corex-auth/src/SecretsVault.js` | Present — 413 lines, pure `crypto` only |
| `packages/corex-auth/test/AuthService.test.js` | Present — 82 lines |
| `packages/corex-auth/test/SecretsVault.test.js` | Present — 144 lines |
| `packages/corex-auth/AGENTS.md` | Present — documents architecture, consumers, boundaries |
| `engine/services/authService.js` | Present — re-export shim → `packages/corex-auth/src/AuthService` |
| `engine/services/secretsVault.js` | Present — re-export shim → `packages/corex-auth/src/SecretsVault` |
| `@auth` alias in root `package.json` | Present — maps to `packages/corex-auth/` |

### Files confirmed NOT touched (zero diff vs commit cc86c34)

- `engine/services/pgStore.js`
- `engine/middleware/authGuard.js`
- `engine/routes/authController.js`
- `engine/middleware/roleGuard.js`

### Files confirmed NOT moved (still engine-coupled, per the 2026-08-21 decision)

- `pgStore.js` (767 lines) — stays in engine/
- `authGuard.js` (233 lines) — stays in engine/
- `authController.js` (344 lines) — stays in engine/
- `roleGuard.js` — stays in engine/

### Verification performed

1. **Auth unit tests:** `npx jest packages/corex-auth/` → 23/23 pass
2. **Shim round-trip (auth):** `signToken` → `verifyToken` through `@core/services/authService` → PASS
3. **Shim round-trip (hash):** `hashPassword` → `verifyPassword` through shim → PASS
4. **Shim round-trip (vault):** `encryptString` → `decryptString` through `@core/services/secretsVault` → PASS
5. **Full suite:** 414 pass, 11 fail — only the 2 previously-confirmed pre-existing failures (liveBroker.events, round7.comprehensive)

### Coupling check (the stop-condition from the task)

Per task instructions: "If either file imports anything from engine/ that isn't pure crypto... STOP and report it."

- `packages/corex-auth/src/AuthService.js` — imports only `node:crypto`. **Pure.**
- `packages/corex-auth/src/SecretsVault.js` — imports only `node:crypto`. **Pure.**

Neither file imports from `engine/`, `pgStore`, or any Express/DB-coupled module. No cross-package reference back into engine/ is needed. No discrepancy found.

### Discrepancies / surprises

**None found.** The actual code matches what decisions.md describes exists. The extraction was executed faithfully:
- Exactly the two pure-logic files moved (authService, secretsVault)
- Re-export shims preserve backward compatibility
- No separate server/auth-http package created
- DB/Express-coupled code stayed in engine/

### Callers confirmed working through shim

| Caller | Import path | Status |
|---|---|---|
| `engine/server.js:10` | `@core/services/authService` | Works (verified) |
| `engine/routes/authController.js:19` | `@core/services/authService` | Works (existing tests pass) |
| `engine/middleware/authGuard.js:15` | `@core/services/authService` | Works (existing tests pass) |
| `engine/routes/systemController.js:22` | `@core/services/secretsVault` | Works (existing tests pass) |
| `db/migrate.js:11` | `@core/services/authService` | Works (migration runner functional) |
| `packages/corex-accounts/src/connectionsService.js:4` | `@core/services/secretsVault` | Works (tests pass) |
| `engine/services/configService.js:7` | `@core/services/secretsVault` | Works |

---

**Conclusion:** The extraction is complete and verified. No code changes were needed. This file exists because the task requires it, even though the outcome is "already done, nothing to fix."
