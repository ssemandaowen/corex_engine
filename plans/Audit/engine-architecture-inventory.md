# Engine Architecture Inventory

Date: 2026-10-02
Base commit: `dfb1b24` (with `chore/strategy-engine-closure` applied, uncommitted at time of writing)
Method: static import-graph analysis of `require(...)` specifiers across `engine/`, `packages/`,
`broker/`, `utils/`, `config/`, `events/`, resolved through the `_moduleAliases` table and
verified with `require.resolve`. No runtime tracing.

This is an inventory, not a plan. It records what is actually in the tree.

---

## 1. Size

| Area | Files | Lines |
| --- | --- | --- |
| `engine/` | 77 | 14 551 |
| `packages/` (7 packages) | 154 | 20 257 |
| `broker/` (legacy tree) | 11 | small — 7 of 11 are 2–4 line shims |
| `utils/` | 26 | ~3 200 |

`engine/` is the largest single directory but not the largest collection of logic:
`packages/` together are 39% more lines than `engine/`.

### Packages

| Package | Files | Lines |
| --- | --- | --- |
| `corex-strategy-engine` | 80 | 8 149 |
| `corex-broker-contract` | 27 | 4 106 |
| `corex-market-data` | 15 | 3 275 |
| `corex-gateway` | 13 | 2 876 |
| `corex-portfolio` | 8 | 839 |
| `corex-auth` | 5 | 772 |
| `corex-accounts` | 4 | 240 |

---

## 2. Alias table — what each alias actually resolves to

Verified by resolving every entry in `package.json:_moduleAliases`.

| Alias | Resolves to | Kind |
| --- | --- | --- |
| `@core` | `engine/` | repo folder |
| `@utils` | `utils/` | repo folder |
| `@config` | `config/` | repo folder |
| `@events` | `events/` | repo folder |
| `@strategies` | `strategies/` | **does not exist** |
| `@broker` | `broker/` | **legacy tree, not the package** |
| `@broker/corex-broker-contract` | `packages/corex-broker-contract` | package |
| `@broker/RuntimeBrokerFactory` | `…/src/RuntimeBrokerFactory` | package internal |
| `@data` | `packages/corex-market-data` | package |
| `@auth` | `packages/corex-auth` | package |
| `corex-*` (6 names) | `packages/corex-*` | package |

Two traps here:

- **`@broker` means `broker/`, not `packages/corex-broker-contract`.** Any code reading
  `@broker/base/BaseBroker` as the package is wrong. Verified: `require.resolve("@broker/base/BaseBroker")`
  returns `broker/base/BaseBroker.js`.
- **`@strategies` points at a directory that does not exist.** It is in the alias table with
  no target on disk.

---

## 3. Package → outside-package edges

Relative imports within a package excluded. Counts are `require` sites.

| Package | Reaches out to |
| --- | --- |
| `corex-strategy-engine` | `@config`(3), `@core`(1), `@utils`(4), `corex-broker-contract`(2) |
| `corex-market-data` | `@broker`(1), `@core`(1), `@data`(1), `@events`(3), `@utils`(6) |
| `corex-broker-contract` | `@config`(6), `@core`(2), `@data`(1), `@events`(10), `@utils`(7) |
| `corex-portfolio` | `@events`(2), `@utils`(1), `corex-broker-contract`(2) |
| `corex-accounts` | `@core`(2), `@events`(1), `@utils`(2) |
| `corex-gateway` | *(nothing — only `express`, `pg`, `crypto`, `dotenv`, `path`)* |
| `corex-auth` | *(nothing — only `crypto`)* |

Only `corex-auth` and `corex-gateway` are free of repo-folder coupling. The other five depend
on `@utils`, `@config`, `@events` or `@core`, so **none of them is independently installable
today**, including the two "contract"/domain packages.

### The circular dependency that already exists

```
corex-strategy-engine/src/Strategy.js:5
        requires @core/core/strategy/StrategyContract
engine/core/strategy/StrategyContract.js:151
        requires @utils/strategy/StrategyIntrospection
utils/strategy/StrategyIntrospection.js
        requires ../../packages/corex-strategy-engine/src/StrategyIntrospection
```

A real cycle spans engine → utils → package, and `engine/` also imports
`corex-strategy-engine` (3 sites). So engine and the strategy package are mutually entangled
today, not merely one-directional.

---

## 4. `engine/` — what it owns, and where it leaks

### Outbound edges from `engine/`

| Target | Sites | Assessment |
| --- | --- | --- |
| `engine/` (self, `@core/…`) | 148 | expected — internal |
| `utils/` | 57 | **high coupling to a folder AGENTS.md wants domain-neutral** |
| `events/` | 22 | expected |
| `config/` | 9 | expected |
| `corex-broker-contract` | 9 | expected — engine composes packages |
| `corex-strategy-engine` | 3 | expected |
| `corex-market-data` | 3 | expected |
| `corex-accounts` | 1 | expected |

The engine's package-facing direction is correct: it depends *on* packages, 16 sites total.
The 57 `utils/` references are the real weight.

### Largest files

| File | Lines | Concern |
| --- | --- | --- |
| `engine/routes/systemController.js` | 1 006 | route + orchestration + broker access |
| `engine/routes/backtestController.js` | 993 | route layer carrying backtest logic |
| `engine/backtestManager.js` | 913 | **domain logic (backtest) in the engine** |
| `engine/core/engine.js` | 718 | composition root |
| `engine/services/pgStore.js` | 648 | persistence |
| `engine/strategyLoader.js` | 621 | loader; duplicate of `core/loader/StrategyLoader.js` |
| `engine/services/broadcaster.js` | 787 | WebSocket broadcast |

`engine/backtestManager.js` at 913 lines implements backtest behaviour, not orchestration.
That is a domain concept in the engine layer, which §3.4 prohibits. `packages/corex-backtest`
is named in the target structure but does not exist.

### `engine/core/pipeline/` — the domain-logic cluster

Seven files, 616 lines. `SignalGenerationEngine` (248 lines) implements a "Tick Sandwich":
pre-process state injection → strategy call → post-process stamp/freeze. It reaches for
`Strategy`, `Position`, `Risk`, `Broker`.

There is a second, older `SignalGenerationEngine` at `broker/backtest/SignalGenerationEngine.js`
(53 lines). The two differ substantially — 225 insertions / 30 deletions between them.
Both export the same concept. **Two implementations of signal generation exist.**

`SocketXRiskEngine` (22 lines) is risk policy: it returns `RISK_LIMIT_EXCEEDED` on rejection.
That is risk-model behaviour in the engine, and no `corex-risk` package exists.

`corex-gateway/src/socketx/RiskGateway.js` also implements risk checks and consumes the
pipeline. So risk logic is split across engine and gateway.

---

## 5. `broker/` legacy tree — already shimmed, except the singletons

Of 11 files in `broker/`, 7 are pure re-export shims to `packages/corex-broker-contract`:
`base/BaseBroker.js`, `base/BrokerContract.js`, `connectors/MetaApiConnector.js`,
`connectors/MT5MQL5Connector.js`, `modes/{Backtest,Live,Paper}Broker.js` — each a single
`module.exports = require(...)` line.

The remaining 4 are **real implementations, not shims**, and all are live:

| File | Role | Consumers |
| --- | --- | --- |
| `broker/twelvedata.js` | market-data singleton | `engine/core/engine.js`, `engine/services/{broadcaster,marketStatus,integrationRuntime}.js`, `engine/routes/{systemController,dataController}.js`, `packages/corex-market-data/src/providers/TwelveDataProvider.js` |
| `broker/liveStore.js` | live-broker accessor | `engine/routes/systemController.js` |
| `broker/paperStore.js` | paper-broker accessor | `engine/routes/systemController.js`, `scripts/reset-paper-account.js` |
| `broker/backtest/SignalGenerationEngine.js` | duplicate signal engine | see §4 |

The worst of these: **`packages/corex-market-data/src/providers/TwelveDataProvider.js` imports
`@broker/twelvedata`** — a package importing a legacy repo-folder singleton. `corex-market-data`
cannot be installed independently, and the provider layer depends on a global mutable market-data
singleton rather than injected config.

`broker/backtest/BacktestFeed.js` has no consumers outside itself.

---

## 6. `utils/` — 7 shims, 19 real implementations

`AGENTS.md` §3.7 restricts `utils/` to domain-neutral primitives. Current contents:

**Genuine shims (safe to delete once consumers migrate)** — 5 in `utils/strategy/`:
`Position.js`, `StrategyPositionManager.js`, `StrategyRuntimeUtils.js`,
`StrategyIntrospection.js`, `DeclarativeStrategy.js`.

**Newly shimmed (previous session)** — `StrategyManifest.js`, `StrategyValidator.js`, both now
25–32 line forwarding files to `corex-strategy-engine`.

**Domain-neutral and correctly placed** — `logger.js` (136), `linkedList.js` (44),
`metrics.js` (216), `security.js` (262), `stateController.js` (87),
`data/fastQueue.js` (66).

**Domain code living in `utils/`** — 10 files, all unowned:

| File | Lines | Problem |
| --- | --- | --- |
| `utils/strategy/IncrementalIndicators.js` | 199 | **duplicates EMA/RSI/ATR** already in `packages/corex-strategy-engine/src/indicators/` |
| `utils/strategy/StrategyParamUtils.js` | 322 | duplicates the package copy |
| `utils/strategy/StrategyStateStore.js` | 143 | duplicates the package copy |
| `utils/strategy/RuleChain.js` | 150 | DSL, no owner |
| `utils/strategy/StrategyDevHelpers.js` | 132 | no owner |
| `utils/strategy/StrategySignalUtils.js` | 107 | no owner |
| `utils/strategy/IndicatorAdapter.js` | 72 | no owner |
| `utils/strategy/SoACandleStore.js` | 117 | duplicates the package copy |
| `utils/strategy/StrategyDataManager.js` | 88 | duplicates the package copy |
| `utils/BaseStrategy.js` | 476 | **second strategy base class**, parallel to the package `Strategy` |

`utils/BaseStrategy.js` (476 lines) is the largest item here. It is not a shim — it is a
complete second implementation of the strategy base class, importing
`@core/core/strategy/StrategyContract`, and mixing in `IndicatorAdapter`,
`StrategySignalUtils`, `StrategyDevHelpers`, `StrategyParamUtils`. Its production consumer
was the legacy `StrategyValidator`, which is now a shim, but it remains **live**: it is the
base class the security scanner permits strategies to extend
(`utils/security.js:122` checks `mod.includes("basestrategy")`), and
`test/runtimeExclusivity.test.js` requires it directly. The two base classes coexist by
design for now — see §7.1.

---

## 7. Open decisions

Per instruction these are recorded rather than decided here.

### 7.1 Where `StrategyContract` belongs

Today: `engine/core/strategy/StrategyContract.js`, consumed by 6 modules including the
strategy package. It is a domain contract sitting in the orchestration layer, and it closes
a cycle (engine → utils → package → engine). Candidate owners: a new `corex-strategy-contract`
package, or the strategy package itself with an engine-side adapter. Needs Owen's decision:
`StrategyContract` is not currently on the protected-boundary list.

### 7.2 How logging is injected without coupling to the application logger

`corex-strategy-engine/src/Strategy.js:3` requires `@utils/logger`, a winston instance owned
by the application. `utils/security.js` also hardcodes it. So the package cannot construct
without the app's logger. Options: constructor/factory injection of a logger interface, a
package-owned no-op logger default, or a logging facade package. Not decided.

### 7.3 Independently installable, or merely dependency-direction-clean?

Two defensible positions, and they imply very different amounts of work:

- **Independently installable** — each package gets its own manifest with real deps, no
  `@utils`/`@core`/`@config`/`@events` imports. Today **five of seven packages fail this**;
  only `corex-auth` and `corex-gateway` pass. This is the stricter reading of §7.10 and
  makes `@root` aliases effectively illegal inside packages.
- **Dependency-direction-clean within CoreX** — packages may read shared primitives
  (`@utils/logger`, `@config/constants`, `@events/bus`) but must not reach into another
  package's internals or into `engine/`. Much smaller change; matches how the code is
  actually written today.

The difference is roughly an order of magnitude in effort. Needs a decision before further
extraction work, because it determines whether the next step is "inject a logger" or
"extract the shared primitives into their own packages".

### 7.4 Ownership of the five unowned `utils/strategy/` modules

`IncrementalIndicators`, `IndicatorAdapter`, `RuleChain`, `StrategyDevHelpers`,
`StrategySignalUtils` — all strategy-domain, all outside any package, none referenced by the
package. Related: `IncrementalIndicators` duplicates EMA/RSI/ATR that the package already
implements, and `rule()` was dropped from the strategy manifest without a recorded
replacement, so `RuleChain` may be on a deprecation path.

### 7.5 How the engine composes packages without becoming a domain layer

`engine/` is 14.5k lines and currently contains at least three domain concerns:
backtest (`backtestManager.js`, 913 lines), risk (`SocketXRiskEngine`), and signal generation
(`SignalGenerationEngine`, 248 lines) — the last of which is duplicated in `broker/backtest/`.
The target structure names `corex-backtest`, `corex-risk` and `corex-execution` packages; none
exist. The open question is how much moves and in what order, given that the worker pool
remains dormant and several boundaries are protected.

---

## 8. Observations worth recording, not acted on here

1. **`utils/BaseStrategy.js` is live and has a test.** Its production consumer was removed
   (the legacy validator is now a shim), but `test/runtimeExclusivity.test.js:5` requires it
   directly and `test/round7.comprehensive.test.js` exercises its runtime injection. It is
   also the base class the security scanner explicitly permits strategies to extend
   (`utils/security.js:122`). Do not remove it; it needs an owner decision instead.
2. **Two `SignalGenerationEngine` implementations** with different behaviour (§4).
3. **`@strategies` alias targets a non-existent directory.**
4. **`corex-market-data` imports a legacy broker singleton** (§5) — the only package→legacy
   coupling found outside `utils`.
5. **`engine/strategyLoader.js` (621 lines) vs `engine/core/loader/StrategyLoader.js`** —
   two loaders with overlapping names; the `core/loader` one is a thin delegation wrapper.
6. No `corex-backtest`, `corex-risk`, `corex-execution` packages exist, though the target
   structure names all three.

---

## 9. Method and limits

- Counts come from `require(...)` sites, so lazy `require()` inside functions is counted but
  dynamic specifiers are not resolvable and are excluded.
- `@alias` targets were resolved from `package.json:_moduleAliases` and confirmed with
  `require.resolve`, not assumed.
- Engine size, package sizes, alias targets, and the cycle in §3 are verified facts.
- The domain-leak judgement in §4 and §7.5 is an interpretation of `AGENTS.md` §3.4/§3.12
  applied to observed code, not a measured defect.
- **No runtime verification.** Worker-pool dormancy, live broker paths, and the actual
  composition behaviour of `engine/core/engine.js` were not executed.
- Absence of a reference was not treated as proof of dead code except where noted as
  unverified.