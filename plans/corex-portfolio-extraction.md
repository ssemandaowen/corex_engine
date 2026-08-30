# corex-portfolio Extraction Plan

> **Date:** 2026-08-27
> **Package:** `corex-portfolio`
> **Scope:** Trade history + equity analytics only (no broker dependencies)
> **Risk:** Lowest of Phase 2 — single file, single consumer, no circular deps

---

## 1. File List

### Moves to `packages/corex-portfolio/`

| Source | Target | Notes |
|--------|--------|-------|
| `engine/services/tradeHistoryService.js` | `packages/corex-portfolio/src/tradeHistoryService.js` | Sole file. 378 lines. Pure trade history + equity analytics. |

### Re-export shim (stays in engine)

| Path | Purpose |
|------|---------|
| `engine/services/tradeHistoryService.js` | Re-export shim → `corex-portfolio` (replaces original file) |

### Consumers (no change required)

| File | Require path | Action |
|------|--------------|--------|
| `engine/routes/executionController.js:14` | `@core/services/tradeHistoryService` | No change — shim preserves alias |

---

## 2. Package Structure

```
packages/corex-portfolio/
├── package.json
├── index.js
├── AGENTS.md
├── README.md
├── src/
│   └── tradeHistoryService.js
└── test/
    └── tradeHistoryService.test.js   (new — see §6)
```

---

## 3. Target `package.json`

```json
{
  "name": "corex-portfolio",
  "version": "2026.1.27",
  "description": "CoreX Portfolio Layer — trade history, equity analytics, drawdown/returns calculations",
  "main": "index.js",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "test": "jest --passWithNoTests --testTimeout=20000"
  },
  "dependencies": {
    "pg": "^8.16.3"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "module-alias": "^2.2.3"
  },
  "_moduleAliases": {
    "@root": "../..",
    "@core": "../../engine",
    "@utils": "../../utils",
    "@events": "../../events",
    "@config": "../../config"
  },
  "jest": {
    "testMatch": [
      "**/test/**/*.test.js"
    ],
    "moduleNameMapper": {
      "^@root/(.*)$": "<rootDir>/../../$1",
      "^@core/(.*)$": "<rootDir>/../../engine/$1",
      "^@utils/(.*)$": "<rootDir>/../../utils/$1",
      "^@events/(.*)$": "<rootDir>/../../events/$1",
      "^@config/(.*)$": "<rootDir>/../../config/$1"
    }
  }
}
```

**Dependency rationale:**
- `pg` — needed for Postgres queries (same dependency as corex-gateway, corex-broker-contract)
- No `@core/services/postgres` — package uses raw `pg` pool directly, matching the pattern in corex-broker-contract's TradingAccountRepository

**Note:** `tradeHistoryService.js` currently requires `@core/services/postgres`. During extraction, this will be replaced with a direct `pg` pool connection (same pattern as `TradingAccountRepository` in corex-broker-contract). The package manages its own DB connection.

---

## 4. Index (`index.js`)

```javascript
"use strict";

const { TradeHistoryService } = require("./src/tradeHistoryService");

module.exports = {
    TradeHistoryService
};
```

---

## 5. Re-export Shim (`engine/services/tradeHistoryService.js`)

Replace the current 378-line file with:

```javascript
"use strict";

/**
 * Re-export shim — canonical implementation moved to corex-portfolio.
 * Maintains backward compatibility with @core/services/tradeHistoryService requires.
 */

const { TradeHistoryService } = require("corex-portfolio");

module.exports = new TradeHistoryService();
```

**Why a singleton export?** The original exports `new TradeHistoryService()` — a singleton. The shim preserves this exact shape so `executionController.js` works unchanged.

---

## 6. Tests

### New test file: `packages/corex-portfolio/test/tradeHistoryService.test.js`

Cover:
- `parseFilters()` — filter normalization, environment validation, limit clamping
- `normalizeFillRow()` — row mapping, side normalization
- `buildClosedTrades()` — position matching, P&L calculation, commission handling
- `buildPerformance()` — win rate, profit factor, expectancy
- `buildEquityAnalytics()` — equity curve, drawdown curve, rolling Sharpe
- `getHistoryReport()` — integration with mocked pg pool

**Strategy:** Mock `pg` query responses (no real DB needed for unit tests).

---

## 7. Extraction Steps

| Step | Action | Verify |
|------|--------|--------|
| 1 | Create `packages/corex-portfolio/` directory structure | — |
| 2 | Write `package.json`, `index.js`, `AGENTS.md`, `README.md` | — |
| 3 | Move `tradeHistoryService.js` → `packages/corex-portfolio/src/` | — |
| 4 | Replace `@core/services/postgres` require with direct `pg` pool | — |
| 5 | Write re-export shim at `engine/services/tradeHistoryService.js` | — |
| 6 | Write tests in `packages/corex-portfolio/test/` | `npm test` in package |
| 7 | Run root tests | Full suite: 399+ passed |
| 8 | Commit | One commit per component |

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| `@core/services/postgres` shim doesn't exist in package | Use raw `pg` pool directly (same pattern as corex-broker-contract) |
| `executionController.js` breaks | Re-export shim preserves singleton shape — no consumer changes needed |
| DB connection config | Package reads `DATABASE_URL` env var directly (same as other packages) |

---

## 9. What Stays in `engine/`

- `engine/routes/executionController.js` — calls `tradeHistoryService.getHistoryReport()` via shim
- `engine/services/brokerPersistence.js` — separate concern (broker settings, not portfolio analytics)
- `engine/services/connectorSettingsService.js` — encrypted credentials, not portfolio

---

## 10. Definition of Done

- [ ] `packages/corex-portfolio/` created with all files
- [ ] `engine/services/tradeHistoryService.js` is a re-export shim
- [ ] `executionController.js` unchanged and working
- [ ] Package tests pass standalone (`npm test` in package)
- [ ] Root test suite passes (399+ tests, no new failures)
- [ ] AGENTS.md + README.md written
