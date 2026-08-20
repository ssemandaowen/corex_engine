# AGENTS.md — corex-broker-contract

Package: `corex-broker-contract` — BrokerContract interface, drivers (Backtest / Paper / Live / REST), BaseBroker, RuntimeBrokerFactory, and supporting utilities.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@events`, `@utils`, `@config`, `@core`, `@broker`.
- One commit per component change (contract, driver, util, test). Run tests after each commit.

## Boundaries (do not violate without asking Owen)
- `runtimeId` = `userId::strategyName::symbol::mode` — never bypass.
- BrokerContract interface: `submit`/`modify`/`cancel`/`query_status` are the primary async methods. `placeOrder`/`getPosition`/`getAccount` are deprecated delegates.
- `CoreXPaperDriver` owns its local virtual ledger — never route paper through MetaAPI/REST.
- `MetaApiDriver` / `RestDriver`: Live mode — broker owns the ledger. `setCash`/`setInitialCash`/`resetAccount` return `false` (no-op).
- `SymbolNormalizer`: every driver AND every data source normalizes at its boundary before anything reaches the internal event bus.
- `SharedFillSim`: single fill-simulation module shared by BacktestDriver and CoreXPaperDriver — never duplicate fill logic.
- `RuntimeBrokerFactory`: same-symbol-one-driver rule enforced at session creation, not at order time.

## Human verification required
- MetaApiDriver + RestDriver: need Owen's real broker credentials (MetaAPI token, MT5 terminal) to verify end-to-end. Skeleton connector is functional but untested against real broker. Flag, don't self-certify.
