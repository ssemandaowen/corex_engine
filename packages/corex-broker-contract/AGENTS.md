# AGENTS.md — corex-broker-contract

Package: `corex-broker-contract` — BrokerContract interface, drivers (Backtest / Paper / Live), BaseBroker, RuntimeBrokerFactory, and supporting utilities.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@events`, `@utils`, `@config`, `@core`, `@broker`.
- One commit per component change (contract, driver, util, test). Run tests after each commit.

## Architecture

### BrokerContract Layer
This package defines the abstract broker interface and its concrete implementations:

```
Strategy code → BrokerContract (interface)
                    ↓
            RuntimeBrokerFactory
                    ↓
    BacktestDriver | CoreXPaperDriver | MetaApiDriver
```

### Components
- `src/base/BrokerContract.js` — Abstract interface (submit/modify/cancel/query_status)
- `src/base/BaseBroker.js` — Base class with risk floor enforcement
- `src/base/UnsupportedOperationError.js` — Typed error for unsupported operations
- `src/RuntimeBrokerFactory` — Creates broker instances per (mode, symbol)
- `src/drivers/BacktestDriver.js` — Historical simulation
- `src/drivers/CoreXPaperDriver.js` — Virtual ledger paper trading
- `src/drivers/MetaApiDriver.js` — Live trading via MetaAPI/MT5
- `src/connectors/MetaApiConnector.js` — MetaAPI connection
- `src/connectors/MT5MQL5Connector.js` — MT5/MQL5 connection
- `src/utils/SharedFillSim.js` — Fill simulation (shared by Backtest + Paper)
- `src/utils/SymbolNormalizer.js` — Symbol normalization at boundary
- `src/utils/DataPaginationLayer.js` — Data pagination for large requests
- `src/mt5Bridge.js` — MT5 WebSocket bridge

## Boundaries (do not violate without asking Owen)
- BrokerContract interface: `submit`/`modify`/`cancel`/`query_status` are the primary async methods. `placeOrder`/`getPosition`/`getAccount` are deprecated delegates.
- `CoreXPaperDriver` owns its local virtual ledger — never route paper through MetaAPI.
- `MetaApiDriver`: Live mode — broker owns the ledger. `setCash`/`setInitialCash`/`resetAccount` return `false` (no-op).
- `SymbolNormalizer`: every driver AND every data source normalizes at its boundary before anything reaches the internal event bus.
- `SharedFillSim`: single fill-simulation module shared by BacktestDriver and CoreXPaperDriver — never duplicate fill logic.
- `RuntimeBrokerFactory`: same-symbol-one-driver rule enforced at session creation, not at order time.

## Related Packages
- `corex-gateway` — Socket_X protocol, account model, connection lifecycle (depends on this package for BrokerContract/drivers)
- `corex-auth` — JWT signing/verification, AES-256-GCM encryption
- `corex-market-data` — Market data providers

## Human verification required
- MetaApiDriver: needs Owen's real broker credentials (MetaAPI token, MT5 terminal) to verify end-to-end. Skeleton connector is functional but untested against real broker. Flag, don't self-certify.