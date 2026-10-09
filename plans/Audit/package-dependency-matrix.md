# J3 — Package dependency matrix

> Branch: `jules/j3-package-deps-docs`. Generated 2026-10-04 from origin/main (dfb1b24).
> Method: grep every external `require()` (not `./`, not Node builtins, not `@`-aliases, not other `corex-*` package names) under each package's `src/` and `index.js`; compare with `package.json` `dependencies`.

## Matrix

| Package | Declared deps | Used in src | Mismatch |
|---------|---------------|-------------|----------|
| corex-accounts | `pg` | `pg` | none |
| corex-auth | (none) | (none) | none |
| corex-broker-contract | `ws`, ~~`winston`~~, ~~`pg`~~, ~~`dotenv`~~ | `ws` | removed `winston`, `pg`, `dotenv` (grep proves zero usage in package) |
| corex-gateway | ~~`ws`~~, ~~`winston`~~, `pg`, `dotenv`, `express`, `corex-broker-contract` | `dotenv`, `pg`, `express` | removed `ws`, `winston` (grep proves zero usage in package) |
| corex-market-data | `ws`, ~~`winston`~~, `axios`, **`yahoo-finance2`** | `ws`, `axios`, `yahoo-finance2` | added `yahoo-finance2` (used but undeclared); removed `winston` (unused) |
| corex-portfolio | `pg` | `pg` | none |
| corex-strategy-engine | `mathjs`, `technicalindicators` | `mathjs`, `technicalindicators` | none |

## Changes made in this task

1. **corex-market-data** — added `yahoo-finance2@^4.0.2` (resolved version in
   `package-lock.json` is 4.0.2). It was required by
   `src/providers/YahooFinanceProvider.js:80` but never declared.
2. **corex-market-data** — removed `winston` (grep: zero `require("winston")`
   in the package; `winston` is used only by the engine's `utils/logger.js`).
3. **corex-broker-contract** — removed `winston`, `pg`, `dotenv` (grep: the
   package only `require("ws")` directly; `pg`/`dotenv` were transitive via
   `@core/services/postgres`, which is the engine's module and carries its own
   `pg` dependency at the root).
4. **corex-gateway** — removed `ws`, `winston` (grep: the package uses
   `crypto` (builtin), `dotenv`, `pg`, `express`; the WebSocket *server* lives
   in the engine's `broadcaster.js`, not in this package — `SocketXServer` is
   protocol-level and does not `require("ws")`).

## Grep evidence for each removal

- `winston`: `grep -rn "require(['\"]winston" packages/` → no matches in any
  package. Only `utils/logger.js:3` (engine) requires it.
- `pg` in corex-broker-contract: `grep -rn "require(['\"]pg" packages/corex-broker-contract/`
  → no matches; `grep -rn "\bPool\b" packages/corex-broker-contract/` → no matches.
- `dotenv` in corex-broker-contract: `grep -rn "dotenv" packages/corex-broker-contract/`
  → no matches.
- `ws` in corex-gateway: `grep -rn "require(['\"]ws['\"]" packages/corex-gateway/`
  → no matches; `grep -rn "WebSocket" packages/corex-gateway/` → no matches.

## Notes

- `corex-broker-contract`'s `mt5Bridge.js` requires `@core/services/postgres`
  (the J6 target). That is an *alias* import into the engine, not a direct
  `pg` require, so it does not justify declaring `pg` in this package.
- `corex-gateway`'s `SocketXServer` is the Socket_X protocol implementation;
  the actual `ws` WebSocket server is `engine/services/broadcaster.js`. The
  gateway package therefore does not need `ws`.
- `corex-portfolio` and `corex-strategy-engine` tests import
  `corex-broker-contract/src/...` directly (deep cross-package imports); those
  are test-only and are recorded in the J4 boundary allowlist, not dependency
  mismatches.
- No `npm update` was run; only `package.json` `dependencies` blocks were
  edited. The root `package-lock.json` already contains `yahoo-finance2@4.0.2`
  (hoisted), so no lockfile change is required for the add.
