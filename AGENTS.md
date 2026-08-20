# AGENTS.md — corex-engine

Proprietary algorithmic trading engine. Sole developer: Owen (Ssemanda Owen / Apex Trait Ltd). This file is read by every AI agent working on this repo (Kilocode, Claude Code, etc.).

## Self-maintenance rule (read first)
This file is living, not static. When you discover an issue, boundary, or constraint not documented here or in a package's own `AGENTS.md`, add it yourself as part of your commit — in the relevant package's `AGENTS.md` if it's package-specific, or in `/KNOWN_ISSUES.md` if it's cross-cutting or unassigned. Keep entries to one line. Don't ask Owen to record it — record it, then keep working. Don't re-explain things already documented here.

## Stack
Node.js/Express backend, React/TS frontend (`corex-ui/`), PostgreSQL, WebSocket-only real-time. Path aliases: `@root @core(engine) @strategies @utils @broker @events @config`.

## Run / test
- `npm start` / `npm run dev` — backend
- `npm run ui:dev` — frontend
- `npm test` — jest, `**/test/**/*.test.js`
- `npm run db:migrate` — Postgres migrations

## Locked architectural principles — never violate without asking Owen
- Server decides everything; no client-side trading logic
- WebSocket-only real-time — no polling
- Full state recoverability; complete audit logging on every trade action
- Lazy on-demand strategy loading
- `runtimeId` = `userId::strategyName::symbol::mode` — never bypass
- Broker modes: Backtest / Paper / Live only, via `BrokerContract` / `BaseBroker` / `RuntimeBrokerFactory`
- 5000-candle global backtest cap, enforced at three gates

## Scope structure
- Package-level work: read that package's own `AGENTS.md` first (created when the package is extracted). It overrides nothing here — it adds detail scoped to that package only.
- Unassigned or cross-cutting issues: `/KNOWN_ISSUES.md`. Check it before starting work; append to it, don't just fix silently, if what you find is bigger than your current task.
- Full feature scope: `/plans/full-feature-scope.md`.

## Workflow
- One feature branch (or worktree) per package/task — never work directly on `main`.
- Each package's GitHub Issue holds a checklist. Work it in order, check items off as completed — that's the single source of truth for progress.
- Commit small, one commit per checklist item, with a message describing what changed.
- Merge only after the package's own tests pass in isolation.
- Leave a one-line comment on the Issue when a session ends: done / next.
- Public repo — never commit secrets, keys, or credentials.

## Human verification required — flag, don't self-certify
- Market Data (#2) and Jobs/Backtest (#8): need real data files/credentials to verify; mocked data is fine for unit tests only.
- Broker/Execution (#1): Paper/Live modes need Owen's real broker credentials to confirm end-to-end.
- Any other case where you substitute synthetic data for real: say so in the Issue comment, don't mark it fully verified.

## Boundaries — ask before touching
- `runtimeId` scoping scheme
- Broker contract interface
- `db/migrations/`
- Audit logging behavior
- Anything else added here or in `/KNOWN_ISSUES.md` as a boundary
