# AGENTS.md â€” corex-engine

Proprietary algorithmic trading engine. Owen (Ssemanda Owen / Apex Trait Ltd) is the sole developer. This file is read by any AI coding agent working on this repo (Kilocode, Claude Code, etc.) â€” it states constraints and boundaries, not implementation steps. Implementation decisions are the agent's; feature scope and architectural rules are not.

## Stack
Node.js/Express backend, React/TS frontend (`corex-ui/`), PostgreSQL, WebSocket-only real-time. Path aliases: `@root @core(engine) @strategies @utils @broker @events @config`.

## Run / test
- `npm start` / `npm run dev` â€” backend
- `npm run ui:dev` â€” frontend (from root, proxies into `corex-ui`)
- `npm test` â€” jest, pattern `**/test/**/*.test.js`
- `npm run db:migrate` â€” Postgres migrations

## Locked architectural principles â€” do not violate without asking Owen first
- Server decides everything; **no client-side trading logic**
- WebSocket-only real-time â€” never reintroduce HTTP polling for live data
- Full state recoverability; complete audit logging on every trade action
- Lazy on-demand strategy loading â€” nothing compiles at startup
- `runtimeId` scoping is `userId::strategyName::symbol::mode` â€” never bypass or shortcut this
- Three broker modes only: Backtest / Paper / Live, via `BrokerContract` / `BaseBroker` / `RuntimeBrokerFactory`
- 5000-candle global backtest cap â€” enforced at three separate gates; don't relax without asking

## Known pending work â€” don't assume done, don't silently redo
- `utils/riskManager.js` is scheduled for deletion, with all risk-check logic consolidated into `SignalProcessingEngine`. **Not done yet.** Do not modify both in parallel.
- Market-data layer is mid-migration off a hard-wired TwelveData dependency toward a multi-provider architecture mirroring the broker Contract/Factory pattern. Check current state before assuming TwelveData is the only provider.
- Backtest job worker has a history of jobs sticking in `queued` state â€” if touching `engine/workers/jobWorker.js` or the job queue, check server logs for `[JOB_SUPERVISOR]` / `[JOB_WORKER]` lines first.

## Boundaries â€” ask before touching
- `runtimeId` scoping scheme
- Broker contract interface (`BrokerContract`)
- Anything in `db/migrations/` â€” schema changes need Owen's sign-off
- Audit logging behavior

## Workflow
- Work happens on a feature branch per package/task, never directly on `main`. Owen typically works in a separate `git worktree` folder per package (e.g. `../corex-broker-contract`), not inside `corex_engine` itself â€” if you're an agent running inside such a folder, you're already isolated from `main`; don't `git checkout main` from there.
- Each package's GitHub Issue holds a task checklist (`- [ ] ...`). Work through it in order, and check items off as they're completed â€” that checklist is the single source of truth for "how far is this package."
- Commit small and often, one commit per checklist item finished, with a message describing what changed â€” not one large commit at the end.
- A package is only merged after it's been built and tested in isolation (`npm test` passing inside that package/worktree).
- When you stop a session (whether finishing or pausing), leave a short comment on the Issue: what's done, what's left. Don't assume the next session (yours or another agent's) has your context â€” write it down.
- This repo is public â€” treat any secrets, API keys, or credentials as things that must never be committed, even temporarily.

## Human verification required â€” do not mark these done unilaterally
Some packages depend on real-world inputs or judgment only Owen can supply. For these, an agent can build and unit-test the code, but must leave the checklist's final item unchecked and flag it for Owen rather than closing the Issue or merging:
- **Market Data (#2) and Job/Backtest (#8)**: require real historical data files and real broker/API credentials to verify correctness â€” synthetic or mocked data is fine for unit tests, but final verification needs Owen to run it against real data.
- **Broker/Execution (#1)**: Paper and Live modes need Owen's actual MT5/broker credentials to confirm order flow end-to-end â€” do not fabricate credentials or assume a mock broker response proves the real integration works.
- For any other package, if you're substituting synthetic data or a stub where real data/credentials would normally be used, say so explicitly in the Issue comment rather than presenting it as fully verified.

