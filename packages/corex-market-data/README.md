# corex-market-data

Market data layer: `DataProviderContract`, providers (TwelveData,
Yahoo, File), `DataProviderFactory`, and the backtest data resolver.

## Ownership

Owns market-data retrieval behind the `DataProviderContract`.
A single provider is active at a time (`DataProviderFactory.setActive`).
Provider errors are caught and logged, never surfaced to user
strategy code.

## Public API (`index.js`)

| Export | Description |
|--------|-------------|
| `DataProviderFactory` | Registers and selects the active provider. Auto-registers `TwelveDataProvider` on load. |
| `DataProviderContract` | The contract interface every provider implements. |
| `validateProviderImplementation` | Validates a provider against the contract. |
| `DataProviderError` | Typed provider error. |
| `DATA_PROVIDER_CONTRACT_VERSION` | Contract version constant. |
| `TwelveDataProvider` | Twelve Data WebSocket/REST provider. |
| `FileDataProvider` | File/CSV provider (synthetic data in tests). |
| `YahooFinanceProvider` | Yahoo Finance provider (uses `yahoo-finance2`). |
| `fetchGuardedHistory` | Backtest history fetch with the 5000-candle cap. |
| `MAX_BARS_LIMIT` | The 5000-candle backtest cap constant. |

## Allowed dependencies

- `ws` — Twelve Data WebSocket transport.
- `axios` — REST transport for providers.
- `yahoo-finance2` — Yahoo Finance provider (added in J3; was
  used but undeclared before).

## Known legacy couplings (aliases it still imports)

- `@core/services/configService` (`src/legacy/twelvedata.js`) —
  engine config service. **Target of J7** (remove the
  `@broker/twelvedata` self-import loop).
- `@broker/twelvedata` (`src/providers/TwelveDataProvider.js`) —
  legacy broker alias that points back at this package's own
  `src/legacy/twelvedata.js` (a self-import loop). **Target of
  J7**.
- Relative imports leaving the package into
  `corex-broker-contract/src/utils/...` (`SymbolNormalizer`,
  `DataPaginationLayer`) — recorded in the J4 boundary allowlist.

These are recorded in `test/fixtures/boundaryAllowlist.json` (J4
ratchet).

## Boundaries (do not violate without asking Owen)

- `runtimeId` = `userId::strategyName::symbol::mode`.
- 5000-candle global backtest cap, enforced at three gates —
  factory, backtestDataResolver, `DataProviderFactory.fetchHistorical`.
- Symbol normalization at each provider's boundary, before emitting
  ticks.

## How to run its tests

```bash
cd packages/corex-market-data
npm test
```

Tests use `jest --passWithNoTests --testTimeout=20000` and discover
`test/**/*.test.js`. Path aliases (`@root`, `@core`, `@broker`,
`@data`, `@events`, `@utils`, `@config`, `@strategies`) are
resolved via the `moduleNameMapper` in this package's `package.json`.

## Human verification required

- `TwelveDataProvider`: needs a real Twelve Data API key + WebSocket.
- `YahooFinanceProvider`: needs real Yahoo Finance API access.
- `FileDataProvider`: testable with synthetic CSV files in unit tests.
