# AGENTS.md — corex-market-data

Package: `corex-market-data` — DataProviderContract, providers (TwelveData, Yahoo, File), DataProviderFactory, MarketFeed.

## Conventions
- Node.js >= 18. CommonJS modules (`require`/`module.exports`).
- Tests: `npm test` runs `jest --passWithNoTests --testTimeout=20000`. All specs in `test/**/*.test.js`.
- Path aliases via `moduleNameMapper` in `package.json` jest config: `@root`, `@core`, `@data` (self), `@events`, `@utils`, `@config`, `@strategies`, `corex-broker-contract`.
- For SymbolNormalizer and DataPaginationLayer from the broker-contract package, use the public API: `require("corex-broker-contract")`.

## Boundaries (do not violate without asking Owen)
- `runtimeId` = `userId::strategyName::symbol::mode` — never bypass.
- 5000-candle global backtest cap, enforced at three gates — factory, backtestDataResolver, DataProviderFactory.fetchHistorical.
- Symbol normalization at each provider's boundary, before emitting ticks.
- Provider errors are caught and logged, never surfaced to user strategy code.
- Single active provider at a time (enforced by factory.setActive).

## Human verification required
- TwelveDataProvider: requires real Twelve Data API key + WebSocket to verify end-to-end.
- YahooFinanceProvider: requires real Yahoo Finance API access to verify.
- FileDataProvider: can be tested with synthetic CSV files in unit tests.
