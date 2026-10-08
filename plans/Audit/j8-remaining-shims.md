# J8 — Remaining broker/ shims

> Branch: `jules/j8-retire-broker-tree`. Generated 2026-10-04.
> The legacy `broker/` tree was retired. Only files with NO package
> equivalent remain, as temporary shims.

## Kept shims (no package equivalent — still imported via @broker/)

| File | Imported by | Why kept |
|------|-------------|----------|
| `broker/paperStore.js` | `engine/routes/systemController.js:7`, `scripts/reset-paper-account.js:21` | Thin wrapper around `@core/services/runtimeService` (`getPaperBroker`/`getLiveBroker`). No package exports this. Requires `@core` (engine-internal), so it cannot move into a package without inverting the dependency. |
| `broker/liveStore.js` | `engine/routes/systemController.js:8` | Thin wrapper around `@core/services/runtimeService` (`getLiveBroker`). Same rationale as `paperStore.js`. |
| `broker/CorexReceiver.mq5` | (not a JS module) | MQL5 indicator source. Not imported via `@broker/`; kept for the MT5 terminal. |

## Retired (deleted — had package equivalents)

These were one-line re-export shims into `packages/corex-broker-contract`
or `packages/corex-market-data`. Consumers were repointed to the package
directly, so the shims were deleted:

| Deleted shim | Package equivalent | Consumers repointed to |
|--------------|--------------------|------------------------|
| `broker/twelvedata.js` | `corex-market-data` (`.twelvedata` export added) | `engine/core/engine.js`, `engine/services/broadcaster.js`, `engine/services/marketStatus.js`, `engine/services/integrationRuntime.js`, `engine/routes/systemController.js`, `engine/routes/dataController.js`, `packages/corex-market-data/src/providers/TwelveDataProvider.js` |
| `broker/modes/BacktestBroker.js` | `corex-broker-contract` (`.BacktestBroker`) | `engine/backtestManager.js`, `test/backtestBroker.events.test.js`, `test/round7.comprehensive.test.js` |
| `broker/modes/PaperBroker.js` | `corex-broker-contract` (`.PaperBroker`) | `test/brokerPersistence.integration.test.js`, `test/paperBroker.events.test.js`, `scripts/debug-broker-emit.js`, `test/round7.comprehensive.test.js` |
| `broker/modes/LiveBroker.js` | `corex-broker-contract` (`.LiveBroker`) | (no remaining consumers — was already unused) |
| `broker/base/BaseBroker.js` | `corex-broker-contract` (`.BaseBroker`) | (no remaining consumers — already imported via package) |
| `broker/base/BrokerContract.js` | `corex-broker-contract` (`.BrokerContract`) | (no remaining consumers — already imported via package) |
| `broker/connectors/MetaApiConnector.js` | `corex-broker-contract` (`.MetaApiConnector`) | (no remaining consumers — already imported via package) |
| `broker/connectors/MT5MQL5Connector.js` | `corex-broker-contract` (`.MT5MQL5Connector`) | (no remaining consumers — already imported via package) |
| `broker/backtest/BacktestFeed.js` | (orphan — deleted on PR #16) | (none) |
| `broker/backtest/SignalGenerationEngine.js` | (orphan — deleted on PR #16) | (none) |

## Package API additions made by this task

- `corex-market-data` index now exports `twelvedata` (the legacy
  TwelveData transport singleton from `src/legacy/twelvedata.js`),
  so engine consumers that need the raw transport
  (`searchSymbols`, `getStatus`, `applyRuntimeConfig`,
  `updateSymbols`) can `require("corex-market-data").twelvedata`
  instead of the retired `@broker/twelvedata` alias.

## J7 prerequisite applied on this branch

This branch is cut from `main` (before J7 merged), so the J7
self-import-loop fix is also applied here:
- `TwelveDataProvider.js` requires `../legacy/twelvedata` directly
  (not `@broker/twelvedata`).
- `legacy/twelvedata.js` no longer requires
  `@core/services/configService`; the config service is injected via
  `configure({ configService })` from `engine/services/integrationRuntime.js`.

## Removal condition

The two kept shims (`paperStore.js`, `liveStore.js`) can be deleted
when `getPaperBroker`/`getLiveBroker` are either:
1. moved into a package that owns runtime-status reads (e.g. a
   `corex-runtime` package that wraps `runtimeService`), or
2. inlined at their two call sites (`systemController.js`,
   `reset-paper-account.js`) and the `@core/services/runtimeService`
   dependency is resolved there.

Until then they remain as temporary shims so the `@broker/` alias
still resolves for those two consumers.
