# CoreX Scripts Audit

> **Date:** 2026-10-06
> **Scope:** Audit of all `package.json` "scripts" entries and all script files under `scripts/`.
> **Method:** Code inspection for legacy path imports (`@core/services`, `@broker`, `utils/strategy`), dry-run execution with 20-second timeout, and error classification.

---

## 1. `package.json` "scripts" Inventory

| Key | Command | Legacy Path Imports | Execution Result |
|---|---|---|---|
| `start` | `node index.js` | Indirect via `engine/server.js` | Not tried — long-running HTTP/WS server (requires PostgreSQL and env configuration) |
| `menu` | `node scripts/menu.js` | None | Runs — displays interactive CLI operational menu |
| `dev` | `nodemon index.js` | Indirect via `engine/server.js` | Not tried — long-running development server watcher |
| `test` | `jest --passWithNoTests` | None | Runs — executes Jest test suite (569 passed, 3 pre-existing failures) |
| `test:auth` | `jest --runInBand test/auth.service.test.js test/auth.integration.test.js` | None | Fails — `NO_TESTS_FOUND` (`test/auth.service.test.js` and `test/auth.integration.test.js` do not exist) |
| `status:set` | `node scripts/gh-project-status.js` | None | Runs — prints CLI usage (`Usage: node scripts/gh-project-status.js <issueNumber> <statusName> [projectNumber]`) |
| `account:reset` | `node scripts/reset-paper-account.js` | `@broker/paperStore`, `@core/services/postgres` | Not tried — requires user ID argument and active PostgreSQL DB connection |
| `ui:dev` | `npm --prefix front_end run dev` | None | Not tried — long-running Vite frontend development server |
| `ui:build` | `npm --prefix front_end run build` | None | Runs — builds React/TypeScript UI in `front_end/dist/` |
| `ui:preview` | `npm --prefix front_end run preview` | None | Not tried — long-running Vite preview server |
| `db:migrate` | `node db/migrate.js` | `@core/services/postgres`, `@core/services/authService` | Not tried — requires active PostgreSQL database connection |
| `strategies:migrate` | `node db/migrate_strategies_to_db.js` | `@core/services/postgres` | Not tried — requires active PostgreSQL database connection |
| `core:clean` | `node -e "const fs=require('fs'); fs.rmSync('./data/backtests/', {recursive:true, force:true})"` | None | Runs — removes `./data/backtests/` directory recursively |
| `status` | `node ./utils/system-check.js` | `@core/services/postgres` (in deleted file) | Fails — `Error: Cannot find module '/app/utils/system-check.js'` (file deleted in commit `dfb1b24`) |
| `mt5:receiver` | `python engine/managers/mt5Receiver.py` | None | Not tried — requires Python runtime and active MT5 terminal connection |
| `mt5:receiver:env` | `set DOTENV_CONFIG_PATH=.env.receiver && python engine/managers/mt5Receiver.py` | None | Not tried — Windows command requiring Python runtime and MT5 connection |
| `db:start` | `pg_ctl start -D "D:/scoop/persist/postgresql/data" -w` | None | Not tried — Windows local PostgreSQL service control command |
| `db:stop` | `pg_ctl stop -D "D:/scoop/persist/postgresql/data" -m fast` | None | Not tried — Windows local PostgreSQL service control command |
| `db:status` | `pg_ctl status -D "D:/scoop/persist/postgresql/data"` | None | Not tried — Windows local PostgreSQL service status check |
| `bench:engine` | `node scripts/bench/engine-micro-bench.js` | None | Runs — executes micro-benchmarks for Queue pointer speedup and strategy tick burst |
| `sync:strategy-manifest` | `node scripts/sync-strategy-manifest.js` | `@core/services/postgres` | Fails — `ENOENT: no such file or directory, open '/app/corex-ui/src/monaco/strategyManifest.generated.json'` |
| `worker:jobs` | `node engine/workers/jobWorker.js` | `@core/services/postgres`, `@core/services/jobQueue`, `@core/services/strategyCompiler` | Not tried — long-running job worker process (requires PostgreSQL) |
| `maintenance:prune` | `node scripts/maintenance/prune-runtime-artifacts.js` | `@core/services/postgres` | Runs — executes dry-run scan (`mode=DRY_RUN days=14 fs={"scanned":1,"stale":0,"removed":0,"skipped":1} db={"skipped":true,"reason":"DB_NOT_CONFIGURED"}`) |
| `maintenance:prune:apply` | `node scripts/maintenance/prune-runtime-artifacts.js --apply` | `@core/services/postgres` | Not tried — mutates filesystem/DB and requires active PostgreSQL connection |

---

## 2. Files under `scripts/` Directory

| File Path | Legacy Path Imports | Execution Result / Notes |
|---|---|---|
| `scripts/maintenance/prune-runtime-artifacts.js` | `@core/services/postgres` | Runs — dry-run execution without `--apply` scans runtime artifacts safely |
| `scripts/bench/engine-micro-bench.js` | None | Runs — benchmarks Queue pointer speedup (99.36% faster) and strategy tick burst |
| `scripts/gh-project-status.js` | None | Runs — outputs usage information when called without required parameters |
| `scripts/check-admin.js` | `@core/services/postgres` | Not tried — queries PostgreSQL `users` table for `admin@corex.local` |
| `scripts/reset-paper-account.js` | `@broker/paperStore`, `@core/services/postgres` | Not tried — requires user ID argument and active PostgreSQL DB connection |
| `scripts/sync-strategy-manifest.js` | `@core/services/postgres` | Fails — `ENOENT: no such file or directory, open '/app/corex-ui/src/monaco/strategyManifest.generated.json'` (`corex-ui` folder renamed/moved to `front_end/`) |
| `scripts/validate-strategy.js` | None | Runs — displays strategy CLI validator usage (`Usage: node scripts/validate-strategy.js <strategy-file>`) |
| `scripts/test-auth.js` | None | Fails — `Error: connect ECONNREFUSED 127.0.0.1:3000` (requires running CoreX HTTP server) |
| `scripts/menu.js` | None | Runs — displays interactive CLI operational menu options |
| `scripts/debug-broker-emit.js` | `@broker/modes/PaperBroker` | Fails — `Error: Cannot find module '@events/bus'` (missing `require("module-alias/register")` initialization) |
| `scripts/lib/scriptArgs.js` | `@core/services/postgres` | Runs / Helper — exports CLI argument parsing functions (`parseArgs`, `requiresEngine`) |
| `scripts/README.md` | None | Not tried / Documentation — Markdown documentation file for `scripts/` directory |
