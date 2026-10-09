# J4 — Boundary baseline

> Branch: `jules/j4-ratchet-test`. Generated 2026-10-04 from origin/main (dfb1b24).
> Ratchet test: `test/architectureBoundaries.test.js`. Allowlist: `test/fixtures/boundaryAllowlist.json`.

## Violation counts per package

| Package | @core | @utils (non-foundation) | @broker (legacy) | relative-leaves-package | cross-package /src/ | Total |
|---------|-------|-------------------------|------------------|-------------------------|---------------------|-------|
| corex-accounts | 2 | 0 | 0 | 0 | 0 | 2 |
| corex-auth | 0 | 0 | 0 | 0 | 0 | 0 |
| corex-broker-contract | 1 | 1 | 0 | 0 | 0 | 2 |
| corex-gateway | 0 | 0 | 0 | 3 | 0 | 3 |
| corex-market-data | 1 | 0 | 1 | 5 | 0 | 7 |
| corex-portfolio | 0 | 0 | 0 | 0 | 0 | 0 |
| corex-strategy-engine | 1 | 3 | 0 | 0 | 0 | 4 |
| **Total** | **5** | **4** | **1** | **8** | **0** | **17** |

## Full violation list (17)

### corex-accounts (2)
- `src/brokerPersistenceService.js:4` — `@core/services/pgStore` (@core) — **target of J5**
- `src/connectionsService.js:4` — `@core/services/secretsVault` (@core) — **target of J5**

### corex-broker-contract (2)
- `src/base/BaseBroker.js:6` — `@utils/strategy/StrategyPositionManager` (@utils non-foundation) — **held for Owen (Position/Order type ownership)**
- `src/mt5Bridge.js:6` — `@core/services/postgres` (@core) — **target of J6**

### corex-gateway (3)
- `src/http/accountRoutes.js:5` — `../../../corex-auth/src/AuthService` (relative-leaves-package)
- `src/socketx/RiskGateway.js:3` — `../../../corex-broker-contract/src/RuntimeBrokerFactory` (relative-leaves-package)
- `src/socketx/SocketXServer.js:409` — `../../../corex-auth/src/AuthService` (relative-leaves-package)

### corex-market-data (7)
- `src/DataProviderFactory.js:17` — `../../corex-broker-contract/src/utils/DataPaginationLayer` (relative-leaves-package)
- `src/legacy/twelvedata.js:9` — `@core/services/configService` (@core) — **target of J7**
- `src/providers/FileDataProvider.js:27` — `../../../corex-broker-contract/src/utils/SymbolNormalizer` (relative-leaves-package)
- `src/providers/TwelveDataProvider.js:24` — `@broker/twelvedata` (@broker legacy) — **target of J7**
- `src/providers/TwelveDataProvider.js:25` — `../../../corex-broker-contract/src/utils/SymbolNormalizer` (relative-leaves-package)
- `src/providers/YahooFinanceProvider.js:20` — `../../../corex-broker-contract/src/utils/SymbolNormalizer` (relative-leaves-package)

### corex-strategy-engine (4)
- `src/ParamSchema.js:3` — `@utils/strategy/StrategyParamUtils` (@utils non-foundation)
- `src/Strategy.js:5` — `@core/core/strategy/StrategyContract` (@core)
- `src/Strategy.js:6` — `@utils/strategy/StrategyStateStore` (@utils non-foundation)
- `src/Strategy.js:7` — `@utils/strategy/StrategyDataManager` (@utils non-foundation)

> Note: the 4 corex-strategy-engine violations and the corex-broker-contract
> BaseBroker violation are the legacy `utils/strategy/` + `engine/core/strategy/`
> couplings that PR #16 (`chore/legacy-deletion`) removes by moving
> StrategyContract into the package and making the package self-contained.
> Once PR #16 merges, those 5 allowlist entries become stale and the ratchet
> test will fail until they are removed from `boundaryAllowlist.json` (the
> intended shrink behavior).

## Size report (informational)

`node scripts/size-report.js` (report only, exits 0): 20 files over 400 lines,
8 over 700 (needs review). Largest: `engine/routes/systemController.js` (1006),
`engine/routes/backtestController.js` (993), `engine/backtestManager.js` (913),
`utils/analytics.js` (890), `engine/services/broadcaster.js` (788).

## Ratchet demonstration

- Test passes today (3/3): no new violations, no stale allowlist entries.
- Adding a forbidden import (e.g. `require("@core/services/postgres")` to
  `packages/corex-portfolio/index.js`) makes the "no NEW boundary violations"
  test fail. Reverting restores green. Demonstrated locally; the temporary edit
  was reverted before commit.
