# CoreX Legacy Packages Audit & Inspection Report

Date: $(date)
Scope: `packages/corex-market-data`, `packages/corex-broker-contract`, `packages/corex-gateway`

---

## Executive Summary
This audit inspects the dependency declarations, internal boundary ownership, documentation alignment, and test status across three older CoreX packages. No runtime code or logic was altered during this inspection.

---

## 1. `packages/corex-market-data`

### Dependency Findings
- **Declared Dependencies:** `ws` (^8.18.3), `winston` (^3.19.0), `axios` (^1.7.2).
- **Runtime Required Packages:** `axios` (`TwelveDataProvider.js`), `ws` (`TwelveDataProvider.js`), `winston` (`utils/logger.js`), `yahoo-finance2` (optional/dynamic require in `YahooFinanceProvider.js:80`).
- **Unused Declared Dependencies:** None.
- **Dev/Test Dependencies:** `jest` (^29.7.0), `module-alias` (^2.2.3).
- **Missing Declared Dependencies:** `yahoo-finance2` is dynamically required in `YahooFinanceProvider.js` if enabled, but is not listed in `package.json` `dependencies`.

### Ownership Findings
- **Upward Leakage / Cross-Boundary Imports:**
  - `YahooFinanceProvider.js` requires `@utils/logger`.
  - `FileDataProvider.js` requires `@events/bus`, `@utils/logger`, and `../../../corex-broker-contract/src/utils/SymbolNormalizer`.
  - `TwelveDataProvider.js` requires `@broker/twelvedata` and `../../../corex-broker-contract/src/utils/SymbolNormalizer`.
  - `DataProviderFactory.js` requires `../../corex-broker-contract/src/utils/DataPaginationLayer` and `@utils/logger`.
  - `MarketFeed.js` requires `@events/bus` and `@utils/logger`.

### Documentation Findings
- **README Status:** `README.md` exists and accurately describes `DataProviderContract`, providers, and factory wiring.
- **Limitation / Dependency Notes:** Missing explicit mention that `YahooFinanceProvider` requires optional external `yahoo-finance2` package.

### Test Status
- **Package Test Suite:** `npx jest packages/corex-market-data --runInBand --forceExit`
- **Results:** 6 passed, 6 total test suites (23 total tests passed).

### Audit Summary Matrix
- **Package:** `corex-market-data`
- **Dependency Findings:** Undeclared optional dependency `yahoo-finance2`.
- **Ownership Findings:** Upward imports to `@utils/logger`, `@events/bus`, and relative path imports into `corex-broker-contract`.
- **Documentation Findings:** Minor gap regarding `yahoo-finance2` optional runtime requirement.
- **Test Status:** 6/6 test suites passed (23 tests).
- **Severity:** Medium (Boundary leakage via relative paths to other package internals).
- **Recommended Next Action:** Replace relative imports to `corex-broker-contract` with explicit package imports or dependency injection, and declare `yahoo-finance2` in `optionalDependencies`.

---

## 2. `packages/corex-broker-contract`

### Dependency Findings
- **Declared Dependencies:** `ws` (^8.18.3), `winston` (^3.19.0), `pg` (^8.16.3), `dotenv` (^17.2.3).
- **Runtime Required Packages:** `ws` (`mt5Bridge.js`), `winston` (`utils/logger.js`), `pg` (`mt5Bridge.js`), `dotenv`.
- **Unused Declared Dependencies:** None.
- **Dev/Test Dependencies:** `jest` (^29.7.0), `module-alias` (^2.2.3).

### Ownership Findings
- **Upward Leakage / Cross-Boundary Imports:**
  - `BaseBroker.js` requires `@events/bus`, `@utils/logger`, and `@utils/strategy/StrategyPositionManager`.
  - `mt5Bridge.js` requires `@utils/logger`, `@events/bus`, and `@core/services/postgres`.
  - `CoreXPaperDriver.js` dynamically requires `@data/providers/FileDataProvider` and `@utils/logger`.
  - `BacktestDriver.js` requires `@utils/metrics`.
  - `MetaApiDriver.js` requires `@utils/metrics` and `@events/bus`.
  - `MT5MQL5Connector.js` requires `@config/constants` and `@events/bus`.

### Documentation Findings
- **README Status:** `README.md` exists and accurately documents `BaseBroker`, drivers (`BacktestDriver`, `CoreXPaperDriver`, `MetaApiDriver`), and `Socket_X` protocol structure.
- **Limitation / Dependency Notes:** Unclear separation between `BrokerContract` interface and implementation drivers.

### Test Status
- **Package Test Suite:** `npx jest packages/corex-broker-contract --runInBand --forceExit`
- **Results:** 6 passed, 6 total test suites (22 total tests passed).

### Audit Summary Matrix
- **Package:** `corex-broker-contract`
- **Dependency Findings:** Dependencies well-declared; relies on root path aliases (`@core`, `@utils`, `@events`, `@config`).
- **Ownership Findings:** Significant upward leakage into `@core/services/postgres`, `@utils/logger`, `@events/bus`, and `@data/providers/FileDataProvider`.
- **Documentation Findings:** Accurate README, but lacks documentation on domain/service coupling.
- **Test Status:** 6/6 test suites passed (22 tests).
- **Severity:** High (Direct import of `@core/services/postgres` inside `mt5Bridge.js` breaches contract/driver decoupling).
- **Recommended Next Action:** Refactor `mt5Bridge.js` to accept database/persistence adapters via injection rather than requiring `@core/services/postgres`.

---

## 3. `packages/corex-gateway`

### Dependency Findings
- **Declared Dependencies:** `ws` (^8.18.3), `winston` (^3.19.0), `pg` (^8.16.3), `dotenv` (^17.2.3), `express` (^4.21.0), `corex-broker-contract` (file:../corex-broker-contract).
- **Runtime Required Packages:** `express`, `pg`, `crypto`, `path`, `dotenv`, `corex-broker-contract`.
- **Unused Declared Dependencies:** None.
- **Dev/Test Dependencies:** `jest` (^29.7.0), `module-alias` (^2.2.3).

### Ownership Findings
- **Upward Leakage / Cross-Boundary Imports:**
  - `RiskGateway.js` requires `../../../corex-broker-contract/src/RuntimeBrokerFactory` via relative path traversal.
  - `SocketXServer.js` and `accountRoutes.js` dynamically require `../../../corex-auth/src/AuthService` via relative path traversal.
  - `TradingAccountRepository.js` reads root `.env` via relative path (`../../../../.env`).

### Documentation Findings
- **README Status:** `README.md` exists and documents Socket_X envelope format, auth injection, and account routing.
- **Limitation / Dependency Notes:** Relative path dependencies on `corex-auth` and `corex-broker-contract` internals are undocumented.

### Test Status
- **Package Test Suite:** `npx jest packages/corex-gateway --runInBand --forceExit`
- **Results:** 3 passed, 3 total test suites (85 total tests passed).

### Audit Summary Matrix
- **Package:** `corex-gateway`
- **Dependency Findings:** All third-party packages declared in `package.json`.
- **Ownership Findings:** Relative path traversals (`../../../corex-auth/src/...`, `../../../corex-broker-contract/src/...`) bypass npm/package boundaries.
- **Documentation Findings:** Missing explicit architectural notes regarding dependency injection expectations for auth and risk engines.
- **Test Status:** 3/3 test suites passed (85 tests).
- **Severity:** Medium (Relative directory traversal across sibling package directories).
- **Recommended Next Action:** Standardize inter-package dependencies in `package.json` (`corex-auth`, `corex-broker-contract`) and require via package name rather than relative path traversal (`../../../`).
