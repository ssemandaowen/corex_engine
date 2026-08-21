# AGENTS.md — corex-auth

Package: `corex-auth` — JWT signing/verification (AuthService), AES-256-GCM encryption (SecretsVault).

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@root`, `@core`, `@utils`, `@events`, `@config`.
- One commit per component change (service, test). Run tests after each commit.

## Architecture
- **Pure-logic package** — no Express.js, no PostgreSQL, no external dependencies.
- AuthService: HMAC-SHA256 JWT + scrypt password hashing (Node.js `crypto` only).
- SecretsVault: AES-256-GCM authenticated encryption with key rotation support (Node.js `crypto` only).
- Re-export shims in `engine/services/` maintain backward compatibility with `@core/services/authService` and `@core/services/secretsVault` requires.

## Boundaries (do not violate without asking Owen)
- `JWT_SECRET` must be set via environment variable — never hardcode or commit.
- `COREX_SECRETS_KEY` must be set via environment variable — never hardcode or commit.
- AuthService and SecretsVault must remain pure-logic — no DB, no Express, no external API calls.
- The 30-day JWT TTL is intentional for "stay logged in" UX — do not reduce without Owen's approval.
- Session revocation via `corex_sessions` table is handled in `engine/middleware/authGuard.js` (DB-coupled code stays in engine).

## Human verification required
- AuthService: test with real `JWT_SECRET` to verify token signing/verification round-trip.
- SecretsVault: test with real `COREX_SECRETS_KEY` to verify encrypt/decrypt round-trip and key rotation.