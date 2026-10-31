# Repository Baseline

> **Task:** P0-01 — Repository baseline  
> **Snapshot date:** 2026-10-31  
> **Source branch:** `main`  
> **Source commit:** `d61e7652221cff7ab7f8cde187dcea4418fd3ed9` (`docs: mark legacy task list as historical`)  
> **Repository default branch:** `main`  
> **Task branch:** `docs/p0-01-repository-baseline`  
> **Evidence source:** GitHub repository tree, manifests, lockfiles, and current source files.  
> **Important limitation:** This is a remote repository snapshot. The GitHub connector cannot inspect Owen's local working tree or execute commands on the Dell workstation. Local Git status and installed runtime versions remain unverified.

## 1. Repository snapshot

- Repository: `ssemandaowen/corex_engine`
- Visibility: Public
- Default branch: `main`
- Latest `main` commit at snapshot: `d61e7652221cff7ab7f8cde187dcea4418fd3ed9`
- Latest commit timestamp: `2026-10-31T09:17:43Z`
- Recursive Git tree: 600 entries; GitHub returned `truncated=false`.
- Open documentation PR #50 targets `main` from `docs/current-application-readme`; it is not merged. Therefore, the README visible on `main` at this snapshot is still the pre-PR version. The review branch is separate from this baseline.

The snapshot is anchored to the exact commit above. Re-run the inventory if `main` advances before this task is accepted.

## 2. Top-level repository layout

Observed top-level entries:

```text
.env.example
.gitignore
.idea/
.jules/
.kilo/
AGENTS.md
README.md
SKILLS.md
broker/
config/
data/
db/
engine/
eslint.config.js
events/
front_end/
index.js
kilo.jsonc
package-lock.json
package.json
packages/
plans/
schema.sql
scripts/
test/
utils/
```

Important nested areas:

- `engine/`: `core/`, `data/`, `managers/`, `middleware/`, `modules/`, `routes/`, `services/`, `test/`, `workers/`; also contains `backtestManager.js`, `engine.js`, `server.js`, `signalAdapter.js`, and `strategyLoader.js`.
- `packages/`: seven domain package directories listed below.
- `front_end/`: `public/`, `src/`, Vite/TypeScript configuration, and a separate npm lockfile.
- `db/`: migration runner, strategy migration script, and `migrations/`.
- `plans/`: `Audit/`, the active development roadmap, decisions log, historical TODO, known issues, and older architecture proposals.
- `scripts/`: benchmark, library, maintenance, CLI, and validation scripts.
- `broker/`: legacy broker/data adapters and older broker directories.
- `utils/`: shared utilities and strategy-related modules.
- `events/`: event bus, emit helpers, and event schema.
- `test/`: root Jest test files.

### Confirmed directory/alias mismatch

The root package defines `@strategies -> ./strategies` and a matching Jest mapper, but the recursive `main` tree contains no top-level `strategies/` directory. Treat this as a verified alias-target mismatch; do not create the directory as a speculative fix. P0-02 should trace actual consumers and classify the alias as KEEP, MOVE, REPLACE, or REMOVE.

## 3. Runtime, package manager, and workspace configuration

### Node.js and npm

- Root package: `corex-engine@2026.1.20`.
- Root `engines.node`: `>=18.0.0`.
- All seven domain package manifests also declare Node.js `>=18.0.0`.
- The frontend manifest does not declare a Node.js engine range.
- Package manager: npm is indicated by the root and frontend `package-lock.json` files. No explicit `packageManager` field is set.
- Root lockfile: `package-lock.json`, lockfileVersion 3, 517 lockfile package entries.
- Frontend lockfile: `front_end/package-lock.json`, lockfileVersion 3, 267 lockfile package entries.
- No package-specific lockfiles were found.
- No `pnpm-lock.yaml`, `yarn.lock`, or Bun lockfile was found.
- Root `package.json` has no `workspaces` field. The seven packages have manifests, but they are not declared as npm workspaces by the root manifest.

### Runtime pinning limitations

No `.nvmrc`, `.node-version`, `.python-version`, `requirements.txt`, `pyproject.toml`, or `Pipfile` was found in the repository tree.

The repository therefore states a minimum Node.js version but does not pin an exact Node.js or npm version. The optional MT5 receiver is Python, but its Python version and dependency set are not pinned in a Python project manifest.

**Not verified remotely:** the actual `node --version`, `npm --version`, `python --version`, installed dependency state, and local working-tree status on Owen's Dell. Do not substitute an old reported workstation version for a fresh command result.

## 4. Package manifests

Nine package manifests were found: root, frontend, and seven domain packages.

| Location | Package | Version | Node engine | Scripts |
|---|---|---:|---|---|
| `package.json` | `corex-engine` | `2026.1.20` | `>=18.0.0` | 24 root scripts |
| `front_end/package.json` | `corex-ui` | `0.0.0` | Not declared | `dev`, `build`, `preview`, `lint` |
| `packages/corex-accounts/package.json` | `corex-accounts` | `2026.1.27` | `>=18.0.0` | `test` |
| `packages/corex-auth/package.json` | `corex-auth` | `2026.1.21` | `>=18.0.0` | `test` |
| `packages/corex-broker-contract/package.json` | `corex-broker-contract` | `2026.1.20` | `>=18.0.0` | `test` |
| `packages/corex-gateway/package.json` | `corex-gateway` | `2026.1.22` | `>=18.0.0` | `test` |
| `packages/corex-market-data/package.json` | `corex-market-data` | `2026.1.21` | `>=18.0.0` | `test` |
| `packages/corex-portfolio/package.json` | `corex-portfolio` | `2026.1.27` | `>=18.0.0` | `test` |
| `packages/corex-strategy-engine/package.json` | `corex-strategy-engine` | `2026.1.20` | `>=18.0.0` | `test` |

Each of the seven domain packages has a package-level `AGENTS.md`. The frontend is explicitly `private: true`; the seven domain manifests do not declare a `private` field.

### Frontend stack recorded in its manifest

- React / React DOM: `^19.0.1`
- Vite: `^6.2.3`
- TypeScript: `~5.8.2`
- Package type: ESM (`"type": "module"`)
- Frontend scripts: Vite dev/build/preview; `lint` runs `tsc --noEmit`.
- No frontend test script or frontend `.test.*` files were found in the recursive tree snapshot.

## 5. Root path aliases

The root `_moduleAliases` currently maps:

| Alias | Target |
|---|---|
| `@root` | `.` |
| `@core` | `./engine` |
| `@strategies` | `./strategies` — target directory absent in this snapshot |
| `@utils` | `./utils` |
| `@broker` | `./broker` |
| `@broker/corex-broker-contract` | `./packages/corex-broker-contract` |
| `@broker/corex-gateway` | `./packages/corex-gateway` |
| `@broker/RuntimeBrokerFactory` | `./packages/corex-broker-contract/src/RuntimeBrokerFactory` |
| `@data` | `./packages/corex-market-data` |
| `@auth` | `./packages/corex-auth` |
| `@events` | `./events` |
| `@config` | `./config` |
| `corex-accounts` | `./packages/corex-accounts` |
| `corex-broker-contract` | `./packages/corex-broker-contract` |
| `corex-market-data` | `./packages/corex-market-data` |
| `corex-auth` | `./packages/corex-auth` |
| `corex-gateway` | `./packages/corex-gateway` |
| `corex-portfolio` | `./packages/corex-portfolio` |
| `corex-strategy-engine` | `./packages/corex-strategy-engine` |

Jest also has a `moduleNameMapper` in the root package manifest. The exact runtime and test alias resolution should be verified separately in P0-02; this baseline records configuration, not whether every alias has active consumers.

## 6. Root scripts and verification commands

### Root `package.json` scripts

| Script | Command |
|---|---|
| `start` | `node index.js` |
| `menu` | `node scripts/menu.js` |
| `dev` | `nodemon index.js` |
| `test` | `jest --passWithNoTests` |
| `test:auth` | `jest --runInBand test/auth.service.test.js test/auth.integration.test.js` |
| `status:set` | `node scripts/gh-project-status.js` |
| `account:reset` | `node scripts/reset-paper-account.js` |
| `ui:dev` | `npm --prefix front_end run dev` |
| `ui:build` | `npm --prefix front_end run build` |
| `ui:preview` | `npm --prefix front_end run preview` |
| `db:migrate` | `node db/migrate.js` |
| `strategies:migrate` | `node db/migrate_strategies_to_db.js` |
| `core:clean` | Node one-liner removing `./data/backtests/` |
| `status` | `node ./utils/system-check.js` |
| `mt5:receiver` | `python engine/managers/mt5Receiver.py` |
| `mt5:receiver:env` | Windows `set DOTENV_CONFIG_PATH=.env.receiver && python engine/managers/mt5Receiver.py` |
| `db:start` | `pg_ctl start -D "D:/scoop/persist/postgresql/data" -w` |
| `db:stop` | `pg_ctl stop -D "D:/scoop/persist/postgresql/data" -m fast` |
| `db:status` | `pg_ctl status -D "D:/scoop/persist/postgresql/data"` |
| `bench:engine` | `node scripts/bench/engine-micro-bench.js` |
| `sync:strategy-manifest` | `node scripts/sync-strategy-manifest.js` |
| `worker:jobs` | `node engine/workers/jobWorker.js` |
| `maintenance:prune` | `node scripts/maintenance/prune-runtime-artifacts.js` |
| `maintenance:prune:apply` | `node scripts/maintenance/prune-runtime-artifacts.js --apply` |

### Frontend scripts

| Script | Command |
|---|---|
| `dev` | `vite` |
| `build` | `vite build` |
| `preview` | `vite preview` |
| `lint` | `tsc --noEmit` |

Each domain package declares `test: jest --passWithNoTests --testTimeout=20000`.

### Static script mismatch

The root `test:auth` script references `test/auth.service.test.js` and `test/auth.integration.test.js`. Neither path exists in the `main` tree snapshot. The auth package's visible test files are `packages/corex-auth/test/AuthService.test.js` and `packages/corex-auth/test/SecretsVault.test.js`.

This is a static path mismatch only. The script was **not executed** during this remote inventory, so no runtime exit code is claimed.

### Test discovery

- Root Jest config: `testMatch: ["**/test/**/*.test.js"]`.
- The recursive `main` tree contains 51 files matching `*.test.js`.
- The root `npm test` command invokes Jest with `--passWithNoTests`.
- The frontend has no declared test script and no frontend test files were found.
- The root has an `eslint.config.js`, but no root lint script or direct `eslint` dependency is declared in the root package manifest.

**Not run for this task:** `npm install`, `npm test`, `npm run test:auth`, frontend lint/build, package-local tests, database migrations, or runtime startup. These require a checked-out working environment and are not verifiable from GitHub file metadata alone.

## 7. Project instructions and planning files

- Root guidance: `AGENTS.md`, `SKILLS.md`, and `kilo.jsonc`.
- Package guidance: seven package-level `AGENTS.md` files, one in each domain package.
- Active roadmap: `plans/COREX_DEVELOPMENT_PLAN.md`.
- Historical task log: `plans/to_do.md` explicitly labels itself historical and points to the active roadmap.
- Decisions log: `plans/decisions.md`.
- Known issues: `plans/KNOWN_ISSUES.md`.
- Prior audits: `plans/Audit/`.
- Older target proposal: `plans/target-architecture.md`.

### Guidance mismatches to reconcile

1. Root `AGENTS.md` instructs agents to read `/KNOWN_ISSUES.md`, but that root-level file is absent. The actual file is `plans/KNOWN_ISSUES.md`.
2. `SKILLS.md` says WebSocket-only real-time communication and “no polling, anywhere.” The newer roadmap allows REST for commands, uploads, queries and initial snapshots, while prohibiting polling loops for live-state synchronization. The newer roadmap is the active authority; reconcile the wording during P0-07 rather than silently applying the broader historical rule.
3. `plans/decisions.md` and `plans/target-architecture.md` contain earlier package and event-bus decisions. The current roadmap explicitly requires those proposals to be reconciled against the current repository before adoption.
4. `plans/to_do.md` contains historical task details despite its header directing contributors to the active roadmap. Do not treat its old unchecked items as current authorization.

## 8. Baseline findings for follow-up tasks

These are observations for the later ownership/contract audit, not implementation authorization:

| ID | Observation | Follow-up |
|---|---|---|
| RB-01 | `@strategies` maps to a missing `strategies/` directory. | P0-02: trace consumers and classify alias disposition. |
| RB-02 | Root `test:auth` points to two test files absent from the current tree. | P0-06: verify expected auth test entrypoint and repair only under an approved task. |
| RB-03 | Seven package manifests exist, but root npm workspaces are not configured and no package-specific lockfiles exist. | P0-02/P1-01: assess intended package install/test ownership; do not add workspaces merely to change directory structure. |
| RB-04 | No exact Node/npm/Python runtime pins exist; Python dependencies are not declared in a Python manifest. | P0-06/P5-05: capture actual workstation versions and define reproducible runtime requirements if approved. |
| RB-05 | Root `db:start`, `db:stop`, and `db:status` scripts contain a machine-specific `D:/scoop/persist/postgresql/data` path. | P0-02: record consumers and deployment/local-development implications. |
| RB-06 | Root ESLint config exists, but the root manifest has no ESLint dependency or lint script. Frontend `lint` runs TypeScript checking. | P0-06: define the actual lint/test quality baseline. |
| RB-07 | Root guidance points to a missing root `KNOWN_ISSUES.md`; the actual file is under `plans/`. | P0-07: align guidance paths. |

## 9. Local evidence still required

The following must be collected from Owen's actual checkout before P0-01 can be marked DONE:

```powershell
git status --short --branch
git rev-parse HEAD
node --version
npm --version
python --version
npm test
npm run test:auth
npm --prefix front_end run lint
npm --prefix front_end run build
```

Record exact output and exit codes. Do not run destructive cleanup, migrations, database start/stop commands, or `npm install` over an unknown working tree as part of this baseline. If the local checkout has uncommitted work, preserve it.

## 10. Task status

Status: [~] IN PROGRESS  
Owner: ChatGPT (remote baseline inventory); Owen/Jules needed for local runtime and working-tree evidence  
Branch: `docs/p0-01-repository-baseline`  
Source commit: `d61e7652221cff7ab7f8cde187dcea4418fd3ed9`  
Evidence: GitHub recursive tree, root/frontend/package manifests, lockfiles, scripts, package instructions and roadmap inspected.  
Remaining: local Git status, exact installed Node/npm/Python versions, and actual command results.  
Completed date: Not yet complete.
