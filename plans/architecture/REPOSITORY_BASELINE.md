# Repository Baseline Audit — CoreX (P0-01)

## 1. Audit metadata

- **Date:** 2026-10-31
- **Investigator:** Kilo Code
- **Branch:** `audit/p0-01-repository-baseline` (worktree at `C:\Users\SBUM\Desktop\corex-p0-01-audit`)
- **Audited base commit (origin/main, PR #52 merge):** `3aab1d71bd0c2554b519b2a099f8af6caccddf79`
- **Initial P0-01 audit commit:** `fdcdd9f84babe4da3f6c2016f70feca4261d7956`
- **Correction commit (this pass):** `c565d0492cbcbbd9e21c3d0a2eb0513445aee5df` (current branch HEAD at time of this correction)
- **Latest reviewed revision before this pass:** `85533094243e1332bd8293fb0a21db68c0f4f856`
- **PR #52 merge ancestry:** Verified — `3aab1d7` is an ancestor of HEAD; `git merge-base --is-ancestor 3aab1d7 HEAD` succeeds.
- **Working-tree status:** Clean (no modified/untracked files; node_modules is a local junction to the original repo's node_modules and is gitignored).
- **Scope:** Read-only audit of repository structure, dependencies, commands, tests, configuration, and documentation. No application code modified.

## 2. Executive summary

CoreX is a Node.js/Express + React/TypeScript algorithmic trading engine backed by PostgreSQL with WebSocket real-time transport. This audit is based on `origin/main` at merge commit `3aab1d7` (PR #52 shared task system). The repo is mid-modularization: 7 extracted packages under `packages/`, with legacy surface in top-level `engine/`, `broker/`, `utils/`, `events/`, `config/`. Tests pass: 51 suites, 572 tests (64.09s), with one worker-teardown warning. Node 22.20.0 installed; manifest requires `>=18.0.0`. Task-management system is present (`plans/COREX_DEVELOPMENT_PLAN.md`, `plans/AGENT_WORKFLOW.md`, `plans/STATUS.md`, 7 P0 task files).

## 3. Repository structure and ownership inventory

| Path | Responsibility (observed) | Status |
|------|--------------------------|--------|
| `index.js` | Application entry point | Observed (existence) |
| `packages/` | 7 extracted packages: corex-accounts, corex-auth, corex-broker-contract, corex-gateway, corex-market-data, corex-portfolio, corex-strategy-engine | Observed (existence) |
| `broker/` | Legacy broker implementations | Observed (existence; legacy) |
| `utils/` | Mixed utilities; contains domain-specific code per AGENTS.md concern | Observed (existence; ownership/usage not traced) |
| `events/` | Event bus / event definitions | Observed (existence; ownership/usage not traced) |
| `config/` | Configuration modules | Observed (existence; ownership/usage not traced) |
| `data/` | Runtime data | Observed (existence; ownership/usage not traced) |
| `scripts/` | Operational scripts (menu, maintenance, bench) | Observed (existence; ownership/usage not traced) |
| `plans/` | Roadmap, STATUS, tasks, audits, decisions, to_do (historical), KNOWN_ISSUES.md | Observed (existence) |
| `test/` | 12 top-level test files + nested (backtest) | Observed (existence) |
| `.kilo/` | Kilo skills/rules | Observed (existence) |
| `.jules/` | Jules artifacts | Observed (existence) |

## 4. Technology stack and dependency inventory

- **Node:** manifest `>=18.0.0`; installed `v22.20.0` (verified).
- **Package manager:** npm 10.9.3; `package-lock.json` present (verified).
- **Backend:** Express 5.2.1, pg 8.16.3, ws 8.18.3, dotenv, cors, multer, axios, winston, node-cron, uuid, eventemitter3, module-alias.
- **Strategy/indicators:** mathjs 15.1.0, technicalindicators 3.1.0, acorn/acorn-walk, data-forge, grademark.
- **Broker/market data:** @oanda/v20, yahoo-finance2.
- **Frontend:** React/TypeScript under `front_end/` (separate manifest; not inspected).
- **Testing:** Jest 29.7.0 (devDep), nodemon 3.1.11.
- **Linting:** Root `package.json` declares no lint or typecheck scripts (verified). `eslint.config.js` exists at root but `eslint` is not declared in dependencies or devDependencies (verified), so ESLint cannot run from the inspected manifests. Frontend (`front_end/package.json`) declares `"lint": "tsc --noEmit"`, which is TypeScript type-checking, not ESLint. Do not imply that no lint command exists anywhere: a frontend type-check command exists, but it is not ESLint and no root lint command exists.

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
| lint / typecheck | package.json (root) / front_end/package.json | **No root scripts declared**; frontend declares `"lint": "tsc --noEmit"` (TypeScript type-check, not ESLint). ESLint not declared in inspected manifests. |

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

## 9.5 Verified configuration inconsistencies (independent review)

- **Jest/module alias to missing `strategies/` directory (verified target missing):** `package.json` jest.moduleNameMapper contains `"^@strategies/(.*)$": "<rootDir>/strategies/$1"` and `_moduleAliases` contains `"@strategies": "./strategies"`, but no root `strategies/` directory exists (verified via `Test-Path`). The alias target is dangling. Consumer/runtime impact has not been established (no imports or execution paths traced in this audit). Status: configuration inconsistency / dangling alias target. Do not infer that the entire strategy system is broken.
- **ESLint not declared as dependency (verified):** `eslint.config.js` exists at root with rules, but `eslint` is not in `dependencies` or `devDependencies` (devDeps: globals, jest, nodemon). Frontend lint command is `tsc --noEmit` (package.json `front_end`: `"lint": "tsc --noEmit"`), which is TypeScript type-checking, not ESLint. Status: verified inconsistency.
- **KNOWN_ISSUES.md location (verified):** File exists at `plans/KNOWN_ISSUES.md`, not repository root. Root `AGENTS.md` references `/KNOWN_ISSUES.md`. Status: verified path discrepancy.
- **Hardcoded Windows path in DB scripts (verified):** `package.json` scripts `db:start`, `db:stop`, `db:status` reference `D:/scoop/persist/postgresql/data`. Status: verified environment-specific hardcoded path.
- **Root `schema.sql` (verified):** `schema.sql` (94,868 bytes) exists at repository root alongside `db/migrations/`. Status: observed; relationship to migrations not traced (unknown).

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

1. P0-02: Backend ownership and dependency map.
2. P0-03: Frontend architecture and behavior map.
3. P0-04: Cross-layer contract map.
4. P0-05: Persistence, jobs and runtime-state audit.
5. P0-06: Test and known-issues baseline.
6. P0-07: Plans and PR/branch reconciliation.

## 13. Evidence index

- `package.json` (scripts, deps, jest config, _moduleAliases)
- `.env.example`
- `git status`, `git log`, `git branch`, `git merge-base`
- `npm test` output (51 suites / 572 tests)
- Directory listings: root, `packages/`, `engine/`, `test/`, `plans/`
- Node v22.20.0, npm 10.9.3
- `plans/tasks/P0-01-repository-baseline.md`, `plans/AGENT_WORKFLOW.md`
