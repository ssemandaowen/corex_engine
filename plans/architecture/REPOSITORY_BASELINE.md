# Repository Baseline Audit — CoreX (P0-01)

## 1. Audit metadata

- **Date:** 2026-10-31
- **Investigator:** Kilo Code
- **Branch:** `audit/p0-01-repository-baseline` (worktree at `C:\Users\SBUM\Desktop\corex-p0-01-audit`)
- **Commit SHA (HEAD):** `3aab1d71bd0c2554b519b2a099f8af6caccddf79`
- **PR #52 merge ancestry:** Verified — `3aab1d7` is the merge commit; `git merge-base --is-ancestor 3aab1d7 HEAD` succeeds.
- **Working-tree status:** Clean (no modified/untracked files; node_modules is a local junction to the original repo's node_modules and is gitignored).
- **Scope:** Read-only audit of repository structure, dependencies, commands, tests, configuration, and documentation. No application code modified.

## 2. Executive summary

CoreX is a Node.js/Express + React/TypeScript algorithmic trading engine backed by PostgreSQL with WebSocket real-time transport. This audit is based on `origin/main` at merge commit `3aab1d7` (PR #52 shared task system). The repo is mid-modularization: 7 extracted packages under `packages/`, with legacy surface in top-level `engine/`, `broker/`, `utils/`, `events/`, `config/`. Tests pass: 51 suites, 572 tests (64.09s), with one worker-teardown warning. Node 22.20.0 installed; manifest requires `>=18.0.0`. Task-management system is present (`plans/COREX_DEVELOPMENT_PLAN.md`, `plans/AGENT_WORKFLOW.md`, `plans/STATUS.md`, 7 P0 task files).

## 3. Repository structure and ownership inventory

| Path | Responsibility (observed) | Status |
|------|--------------------------|--------|
| `index.js` | Application entry point | Verified |
| `engine/` | Orchestration: server.js, engine.js, routes, services, workers, backtest manager, middleware | Verified |
| `engine/core/`, `engine/data/`, `engine/managers/`, `engine/middleware/`, `engine/modules/`, `engine/routes/`, `engine/services/`, `engine/test/`, `engine/workers/` | Sub-domains of engine | Verified |
| `packages/` | 7 extracted packages: corex-accounts, corex-auth, corex-broker-contract, corex-gateway, corex-market-data, corex-portfolio, corex-strategy-engine | Verified |
| `broker/` | Legacy broker implementations | Verified (legacy) |
| `utils/` | Mixed utilities; contains domain-specific code per AGENTS.md concern | Verified |
| `events/` | Event bus / event definitions | Verified |
| `config/` | Configuration modules | Verified |
| `front_end/` | React/TypeScript UI | Verified |
| `db/` | Migrations and DB scripts (migrate.js) | Verified |
| `scripts/` | Operational scripts (menu, maintenance, bench) | Verified |
| `data/` | Runtime data | Verified |
| `plans/` | Roadmap, STATUS, tasks, audits, decisions, to_do (historical) | Verified |
| `test/` | 12 top-level test files + nested (backtest) | Verified |
| `.kilo/` | Kilo skills/rules | Verified |
| `.jules/` | Jules artifacts | Verified |

## 4. Technology stack and dependency inventory

- **Node:** manifest `>=18.0.0`; installed `v22.20.0` (verified).
- **Package manager:** npm 10.9.3; `package-lock.json` present (verified).
- **Backend:** Express 5.2.1, pg 8.16.3, ws 8.18.3, dotenv, cors, multer, axios, winston, node-cron, uuid, eventemitter3, module-alias.
- **Strategy/indicators:** mathjs 15.1.0, technicalindicators 3.1.0, acorn/acorn-walk, data-forge, grademark.
- **Broker/market data:** @oanda/v20, yahoo-finance2.
- **Frontend:** React/TypeScript under `front_end/` (separate manifest; not inspected).
- **Testing:** Jest 29.7.0 (devDep), nodemon 3.1.11.
- **No lint/typecheck scripts** declared at root (suspected gap). eslint.config.js present.

## 5. Application entry points and execution flow

- Root `main`: `index.js`.
- `npm start` → `node index.js`.
- `npm run dev` → `nodemon index.js`.
- `npm run menu` → `node scripts/menu.js` (primary operational entry per AGENTS.md).
- `npm run ui:dev` → Vite dev server in `front_end/`.

## 6. Available commands and verification results

| Command | Source | Verified? |
|---------|--------|-----------|
| `npm start` | package.json | Not executed (server/DB dependent) |
| `npm run dev` | package.json | Not executed |
| `npm run menu` | package.json | Not executed |
| `npm test` | package.json | **Verified** — 51 suites, 572 tests passed (64.09s); worker teardown warning |
| `npm run db:migrate` | package.json | Not executed (DB dependent) |
| `npm run ui:dev` | package.json | Not executed |
| `npm run ui:build` | package.json | Not executed |
| `npm run worker:jobs` | package.json | Not executed |
| `npm run status` | package.json | Not executed |
| `npm run bench:engine` | package.json | Not executed |
| lint / typecheck | — | **No scripts declared** (unknown if configured) |

## 7. Testing and quality infrastructure

- Framework: Jest 29.7.0; discovery `**/test/**/*.test.js` (root + packages).
- 51 test suites, 572 tests, all passing.
- Packages carry their own tests under `packages/*/test/`.
- One worker-process teardown warning (leaked handles/timers) — suspected, not blocking.
- No E2E or integration harness beyond unit/integration tests present (suspected gap).

## 8. Configuration and environment inventory

- `.env` (gitignored) and `.env.example` present. `.env.example` documents PORT, PG*, JWT/ADMIN secrets, broker keys (TwelveData, Yahoo, MT5), job worker intervals, WS tuning, data cull settings.
- No secrets reproduced in this report.
- DB: PostgreSQL via `pg`; migrations via `npm run db:migrate` (`db/migrate.js`).
- WS tuning via `COREX_WS_*` env vars.
- Broker config: env keys + DB-backed settings (suspected; not deeply verified).

## 9. Documentation and agent-instruction consistency

- Root `AGENTS.md` present (updated with shared multi-agent protocol).
- `SKILLS.md` present.
- `KNOWN_ISSUES.md` present.
- `plans/COREX_DEVELOPMENT_PLAN.md` present (authoritative roadmap).
- `plans/AGENT_WORKFLOW.md` present (active workflow).
- `plans/STATUS.md` present (active task board).
- `plans/tasks/P0-01..P0-07` present.
- `plans/to_do.md` exists (historical per AGENTS.md).
- `plans/decisions.md` exists.

## 10. Potential architectural risks and inconsistencies

- Legacy `broker/`, `utils/`, `engine/` coexist with extracted `packages/` — duplication risk (suspected).
- `utils/` likely contains domain-specific code (per AGENTS.md rules) — suspected.
- No root lint/typecheck scripts — quality gate gap (suspected).
- Worker teardown warning — possible test isolation issue (suspected).

## 11. Unknowns and areas requiring deeper investigation

- Whether `npm start` boots successfully (not run; DB required).
- Frontend build/test status (not run).
- Broker/market-data DB-backed config depth.
- Unused/outdated dependencies (not verified — only declared).
- Whether origin/main PR #52 task-management changes are merged (verified: yes, merge commit 3aab1d7).

## 12. Recommended investigation priorities for subsequent P0 tasks

1. P0-02: Verify boot path (`npm start`) and DB connectivity.
2. P0-03: Lint/typecheck baseline and test isolation (teardown warning).
3. P0-04: Dependency usage audit (unused/outdated).
4. P0-05: Legacy vs package ownership map completion.

## 13. Evidence index

- `package.json` (scripts, deps, jest config, _moduleAliases)
- `.env.example`
- `git status`, `git log`, `git branch`, `git merge-base`
- `npm test` output (51 suites / 572 tests)
- Directory listings: root, `packages/`, `engine/`, `test/`, `plans/`
- Node v22.20.0, npm 10.9.3
- `plans/tasks/P0-01-repository-baseline.md`, `plans/AGENT_WORKFLOW.md`
