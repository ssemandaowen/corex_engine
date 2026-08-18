# AGENTS.md — corex-engine

Proprietary algorithmic trading engine. Owen (Ssemanda Owen / Apex Trait Ltd) is the sole developer. This file is read by any AI coding agent working on this repo (Kilocode, Claude Code, etc.) — it states constraints and boundaries, not implementation steps. Implementation decisions are the agent's; feature scope and architectural rules are not.

## Stack
Node.js/Express backend, React/TS frontend (`corex-ui/`), PostgreSQL, WebSocket-only real-time. Path aliases: `@root @core(engine) @strategies @utils @broker @events @config`.

## Run / test
- `npm start` / `npm run dev` — backend
- `npm run ui:dev` — frontend (from root, proxies into `corex-ui`)
- `npm test` — jest, pattern `**/test/**/*.test.js`
- `npm run db:migrate` — Postgres migrations

## Locked architectural principles — do not violate without asking Owen first
- Server decides everything; **no client-side trading logic**
- WebSocket-only real-time — never reintroduce HTTP polling for live data
- Full state recoverability; complete audit logging on every trade action
- Lazy on-demand strategy loading — nothing compiles at startup
- `runtimeId` scoping is `userId::strategyName::symbol::mode` — never bypass or shortcut this
- Three broker modes only: Backtest / Paper / Live, via `BrokerContract` / `BaseBroker` / `RuntimeBrokerFactory`
- 5000-candle global backtest cap — enforced at three separate gates; don't relax without asking

## Known pending work — don't assume done, don't silently redo
- `utils/riskManager.js` is scheduled for deletion, with all risk-check logic consolidated into `SignalProcessingEngine`. **Not done yet.** Do not modify both in parallel.
- Market-data layer is mid-migration off a hard-wired TwelveData dependency toward a multi-provider architecture mirroring the broker Contract/Factory pattern. Check current state before assuming TwelveData is the only provider.
- Backtest job worker has a history of jobs sticking in `queued` state — if touching `engine/workers/jobWorker.js` or the job queue, check server logs for `[JOB_SUPERVISOR]` / `[JOB_WORKER]` lines first.

## Boundaries — ask before touching
- `runtimeId` scoping scheme
- Broker contract interface (`BrokerContract`)
- Anything in `db/migrations/` — schema changes need Owen's sign-off
- Audit logging behavior

## Workflow
- Work happens on a feature branch per package/task, never directly on `main`.
- A package is only merged after it's been built and tested in isolation.
- This repo is public — treat any secrets, API keys, or credentials as things that must never be committed, even temporarily.
