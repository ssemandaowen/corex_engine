# AGENTS.md — corex-portfolio

Package: `corex-portfolio` — Trade history analytics, equity curves, drawdown/returns.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@root`, `@core`, `@utils`, `@events`, `@config`.

## Architecture
- **DB-coupled package** — owns `orders`/`order_fills` analytics queries.
- Trade history keyed by `account_id` when provided, with legacy fallback to `user_id` + `environment`.
- Analytics helpers (`buildClosedTrades`, `buildEquityAnalytics`, `buildPerformance`) are pure functions — no DB access.

## Boundaries
- Do not add order creation, modification, or cancellation logic here. Those belong to execution/strategy-engine.
- Do not add broker persistence, connector credentials, or risk checks.
- `account_id` is treated as an opaque foreign key. This package does not import `corex-gateway` or validate account structure.
- Do not backfill historical `account_id` values. Old rows with `NULL` account_id are queried via the legacy `user_id` path.

## Human verification required
- Multi-account history isolation: Two accounts (same user, same type) must return non-overlapping trade histories when queried by `accountId`.
- Legacy fallback: A caller providing only `userId` + `environment` must receive the same combined result as before the `account_id` migration.
