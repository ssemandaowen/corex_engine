# P3-04 — Broker Folder Ownership Cleanup & Socket_X Integration Audit

> Status: REVIEW
> Owner: Kilo Code
> Branch: `fix/p3-04-broker-ownership` (branched from `origin/main` @ `1d67733`; the earlier local commit was cherry-picked here because `fix/upload-multipart-transport` is already PR #58 for unrelated upload work)
> Authorization: Owen's explicit task brief dated 2026-11-14. This task is the bounded Phase 3 work for broker ownership; it does not authorize a full execution-authority rebuild.
> Roadmap mapping: P3-04 (Execution and broker adapter ownership), P3-07 (Retire obsolete legacy paths).

## Problem

The legacy `/broker` tree still contains forwarding mirrors, dead backtest modules, and application-level runtime status helpers even though `packages/corex-broker-contract` owns broker contracts, drivers, connectors and modes. Some package consumers import application-level forwarding files through `@broker/*`.

## Verified evidence (baseline)

- `broker/base/*`, `broker/connectors/*`, `broker/modes/*` are one-line forwarding files into `packages/corex-broker-contract/src/**`.
- `broker/backtest/BacktestFeed.js` and `broker/backtest/SignalGenerationEngine.js` have no consumers anywhere in the repository (rg search across engine, scripts, test, db, index.js). The active backtest path is `engine/backtestManager.js`, which directly constructs `BacktestBroker`.
- `broker/twelvedata.js` forwards to `packages/corex-market-data/src/legacy/twelvedata`. Six application files and one package-internal file import it.
- `broker/liveStore.js` and `broker/paperStore.js` read `runtimeService.getAllStatus()` using keys `${userId}::LIVE` / `${userId}::PAPER`, which do not match the registry key format `${userId}::${strategyName}::${symbol}::${mode}`. They return `null` in practice.
- `packages/corex-broker-contract/package.json` has `"main": "src/mt5Bridge.js"` while `index.js` is the documented public API.
- `SocketXServer` is never instantiated or mounted by `engine/server.js`; only `/ws` and `/mt5` upgrades exist.
- `RiskGateway` can create its own broker via `RuntimeBrokerFactory` when no broker is registered for an `accountId`, so it is not wired to the strategy `RuntimeRegistry`.
- `MetaApiDriver` always constructs `MetaApiConnector`; `connectorType` is ignored.
- `MT5MQL5Connector` calls `mt5Bridge.sendOrderRequest()`, which does not exist; the bridge exposes `request()`/`openPosition()`/`closePosition()`/`closeAllPositions()`.
- `MetaApiConnector` is a skeleton that returns `success: true` without executing a trade.
- Two MT5 transports exist: HTTP polling (`broker/CorexReceiver.mq5` + `engine/routes/mt5Controller.js`) and WebSocket (`packages/corex-broker-contract/src/mt5Bridge.js` + `engine/managers/mt5Receiver.py`).

## Scope

1. Correct the broker-contract package entry point to `index.js` and make consumers use the public API.
2. Remove confirmed forwarding mirrors and dead backtest modules after migrating consumers.
3. Move the legacy TwelveData singleton access behind `corex-market-data`'s public API.
4. Consolidate in-process paper/live broker lookup into `runtimeService`.
5. Fix confirmed connector selection and MT5 connector protocol defects.
6. Record Socket_X integration gaps and the MT5 transport decision; do not implement a new execution authority.

## Non-goals

- No new execution authority, no Socket_X mounting, no change to `BrokerContract` semantics.
- No live/paper execution verification (requires Owen's broker credentials).
- No deletion of either MT5 receiver until a replacement is verified.
- No database migration.

## Acceptance criteria

- [x] `require("corex-broker-contract")` resolves to the documented public API in production (module-alias) and tests.
- [x] No repository source file imports a removed `@broker/*` forwarding path.
- [x] `broker/base`, `broker/connectors`, `broker/modes`, `broker/backtest`, `broker/twelvedata.js`, `broker/liveStore.js`, `broker/paperStore.js` are removed.
- [x] `corex-market-data` exposes the legacy singleton and `MarketFeed` through its public API; no package-internal file imports `@broker/*`.
- [x] `runtimeService.getBrokerForMode()` is the single in-process lookup used by system routes; the standalone reset script uses persisted broker settings.
- [x] Confirmed MetaApiDriver connector selection and MT5 connector/bridge protocol defects are fixed with tests.
- [x] Targeted broker, factory, backtest, runtime lifecycle, execution pipeline, Socket_X risk and MT5 tests run; pre-existing failure identified.
- [x] `plans/decisions.md`, `plans/STATUS.md`, `plans/KNOWN_ISSUES.md` and `plans/architecture/BROKER_OWNERSHIP_AND_SOCKETX_AUDIT.md` record evidence, gaps and handoff.
- [x] Application-level forwarding shims `engine/services/mt5Bridge.js`, `engine/core/runtime/RuntimeBrokerFactory.js`, `engine/core/runtime/MarketFeed.js` removed after migrating consumers.

## Verification commands

```powershell
$pkgs = @("corex-broker-contract","corex-market-data","corex-gateway","corex-strategy-engine","corex-portfolio")
foreach ($p in $pkgs) { npx jest --config "packages/$p/package.json" --rootDir "packages/$p" --runInBand --silent }
npx jest --runInBand --silent test/broker-legacy-paths-removed.test.js test/runtime-broker-lookup.test.js test/backtestBroker.events.test.js test/paperBroker.events.test.js test/brokerPersistence.integration.test.js test/round7.comprehensive.test.js test/DeclarativeStrategy.test.js
```

Notes:
- `--runInBand` is required: parallel workers crash on this repo (jest-worker child process exceptions).
- Jest does not exit after the summary because of open handles; a shell timeout after the summary is expected and is not a test failure.

## Handoff — 2026-11-14

Owner / agent: Kilo Code
Status: REVIEW
Branch: `fix/p3-04-broker-ownership`
Last verified commit: `29ee775` (on top of `origin/main` @ `1d67733`).
Files changed: see `git show --stat 29ee775`. Core changes: broker package entry point (`main: index.js`); deletion of all verified `/broker` mirrors and dead backtest modules; deletion of the three engine forwarding shims (`engine/services/mt5Bridge.js`, `engine/core/runtime/MarketFeed.js`, `engine/core/runtime/RuntimeBrokerFactory.js`); market-data public exposure of `MarketFeed`/`legacyMarketData`; `runtimeService.getBrokerForMode`; MetaApiDriver connector selection; MT5 connector/bridge protocol mapping; tests; plans.
Completed: Repository investigation, consumer migration, verified deletions, confirmed MT5/driver fixes, regression tests, documentation, rebase onto `origin/main`.
Commands and test results (all on `29ee775`):
- broker-contract: 12 suites / 165 tests pass.
- market-data: 6 suites / 70 tests pass.
- gateway: 3 suites / 85 tests pass.
- strategy-engine: 10 suites / 87 tests pass.
- portfolio: 2 suites / 12 tests pass.
- root targeted (incl. `test/backtest-resolver-public-api.test.js` from `origin/main`): 8 suites / 97 tests pass.
- `node --check` on changed JS: pass.
- ESLint not installed; no `lint` script.
Rebase conflicts resolved (only two, both mechanical):
- `engine/backtestManager.js`: kept the public-API imports; `origin/main` had already moved the resolver import to `@data`, which this change also does.
- `package.json`: dropped the four `@broker/*` aliases (no remaining consumers).
Unverified items / limitations: real MT5 execution; MetaAPI execution; Socket_X transport (still not mounted — no `/socketx` upgrade handler in `engine/server.js`, `RiskGateway.registerBroker` never called); end-to-end engine boot with DB/broker credentials. `MetaApiConnector` remains skeleton-like (execute returns success without placing a trade). MT5 has two independent transports (HTTP polling EA `/api/mt5/*` and the Python WS bridge); neither is end-to-end verified.
Known pre-existing failure (not fixed, out of scope): `test/runtime-lifecycle-provider.test.js` — "recovers warmup when provider becomes available after cold start" reads `entry.strategyInstance` while the registry stores `entry.instance`.
Parallel work overlap: PR #60 (draft, `refactor/broker-backtest-public-api`) also removes the `BacktestBroker` mirror and consumes the broker public API; PR #26 (open, `refactor(j8): retire the legacy broker/ tree`) overlaps the `/broker` deletions. Both touch `engine/backtestManager.js` and `broker/modes/BacktestBroker.js`, so one of these efforts must be closed or rebased onto the other before merging.
Decisions needed: MT5 transport selection (HTTP polling EA vs Python WS receiver); whether to keep or delete `MetaApiConnector`; approval for the separate Socket_X execution-authority design.
Blockers: none for the cleanup itself.
Exact next action: review `29ee775`; decide how to reconcile with PR #60 / PR #26; then push this branch and open the PR. Follow-ups: Socket_X mounting, `RuntimeLifecycle.reattemptWarmup` field mismatch, MT5 transport selection.
May another agent continue? YES — resume this file and `plans/STATUS.md`.