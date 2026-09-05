# corex-portfolio Extraction Plan v2

> **Date:** 2026-09-06
> **Package:** `corex-portfolio`
> **Scope:** Trade history CRUD + equity analytics only. No broker persistence, no connector/credential concerns.
> **Status:** Planning only — no implementation in this document.

---

## 1. What `tradeHistoryService.js` Does Today (Actual Code Read)

**File:** `engine/services/tradeHistoryService.js` (378 lines)

| Function | Purpose | DB Interaction |
|----------|---------|----------------|
| `getHistoryReport(rawFilters, options)` | Public entry point. Accepts `userId`, `environment`, `strategyId`, `symbol`, `from`, `to`, `limit`. Returns `meta`, `performance`, `fills`, `trades`, `equityCurve`, `analytics`. | Queries `orders` LEFT JOIN `order_fills`. |
| `parseFilters(raw)` | Normalizes and validates filter inputs. Coerces `environment` to `PAPER`/`LIVE`. Clamps `limit` to 1–10,000. | None |
| `buildWhereClause(filters)` | Builds parameterized WHERE clause for the history query. | None |
| `normalizeFillRow(row)` | Maps raw DB row → JS object (`orderId`, `fillId`, `strategyId`, `symbol`, `side`, `quantity`, `price`, `commission`, `filledAt`, `status`, `environment`). | None |
| `buildClosedTrades(fills)` | FIFO-aware trade reconstruction from fills. Groups by `strategyId::symbol`, computes entry/exit, PnL, commission allocation. | None |
| `buildEquityAnalytics(initialCapital, trades)` | Builds equity curve, drawdown curve, returns series, and 20-period rolling Sharpe ratio. | None |
| `buildPerformance(trades, initialCapital)` | Aggregates performance metrics: net profit, ROI, max drawdown, win rate, Sharpe, profit factor, gross profit/loss, avg win/loss, expectancy. | None |

**Current keying:** `userId` + `environment`. The service has zero awareness of `account_id` or `trading_accounts`.

---

## 2. Current Schema (Actual Migration Read)

### `orders` table
- Created in `db/migrations/002_control_ledger.sql`
- Evolved via migrations `006` (environment), `007` (terminal_id), `011` (strategy_name/intent/sl/tp), `012` (user_id), `015` (runtime_id)
- **Current columns:** `id`, `strategy_id`, `symbol`, `side`, `order_type`, `quantity`, `status`, `created_at`, `environment`, `terminal_id`, `strategy_name`, `intent`, `sl`, `tp`, `user_id`, `runtime_id`
- **No `account_id` column exists.**

### `order_fills` table
- Created in `db/migrations/002_control_ledger.sql`
- **Current columns:** `id`, `order_id`, `external_deal_id`, `fill_price`, `fill_quantity`, `commission`, `filled_at`
- **No `account_id` column exists.**

---

## 3. Design Decision: `userId` vs `account_id` Keying

### Option A — Keep `userId` keying (Recommended)
- **Package scope:** `corex-portfolio` remains a pure `userId`-scoped analytics module.
- **Zero schema changes** to `orders` or `order_fills`.
- **Zero knowledge** of `trading_accounts` — the package treats identity as an opaque `userId` string, matching the one-directional dependency rule already enforced for `corex-market-data`.
- **Controller-layer resolution:** If the frontend or routes need account-scoped history, `executionController.js` resolves `accountId → userId` via `TradingAccountRepository` before calling the package. The package never imports `corex-gateway`.
- **Why this fits:** The project’s stated build philosophy is “optimize for latency, avoid unnecessary features, don’t over-engineer.” Adding `account_id` to orders requires touching every order insertion point (`systemController.js`, `mt5Controller.js`, `liveOrderDispatcher.js`, broker drivers) and backfilling existing data. That is a separate architectural work package, not a lean extraction.

### Option B — Add `account_id` to orders (Deferred)
- **What it would require:** new migration adding `account_id` to `orders` + `order_fills`, backfill script, updates to every order insertion point, plus `accountId` as the new primary filter in `tradeHistoryService`.
- **Why defer:** This extraction is specifically scoped to “trade history CRUD + equity analytics only.” Order creation belongs to execution/strategy-engine packages in the target architecture. Introducing `account_id` here would couple `corex-portfolio` to `corex-gateway` and create a circular dependency pressure.

### Decision Required from Owen
Confirm **Option A** (lean `userId`-scoped package, no schema changes) or **Option B** (full `account_id` schema migration as part of this extraction).

---

## 4. Package Scope (Narrow — No Speculative Extensibility)

`corex-portfolio` owns:
- Trade history query and normalization (`orders` + `order_fills`)
- Closed-trade reconstruction (FIFO grouping)
- Equity analytics: equity curve, drawdown curve, returns, rolling Sharpe
- Performance aggregation: net profit, ROI, max drawdown, win rate, profit factor, expectancy

`corex-portfolio` explicitly does **not** own:
- Order creation / modification / cancellation (belongs to execution / strategy-engine)
- Broker persistence (`brokerPersistenceService`) — belongs to `corex-accounts`
- Connector credentials / secrets — belongs to `corex-accounts`
- Risk checks — belongs to `corex-risk`

---

## 5. Proposed Migration Work

### If Option A is chosen (`userId` keying):
**No new migration required.** The existing `orders` + `order_fills` schema is sufficient.

### If Option B is chosen (`account_id` keying):
**New migration `031_add_account_id_to_orders.sql`:**
- `ALTER TABLE orders ADD COLUMN IF NOT EXISTS account_id TEXT;`
- `ALTER TABLE order_fills ADD COLUMN IF NOT EXISTS account_id TEXT;`
- Backfill `account_id` for existing orders by resolving `userId` + `environment` → default `trading_accounts.account_id`
- Indexes: `idx_orders_account_id`, `idx_order_fills_account_id`
- FK: `orders.account_id REFERENCES trading_accounts(account_id)` (deferred if data is dirty)

**Update call sites:**
- `engine/routes/systemController.js:787` — INSERT includes `account_id`
- `engine/routes/mt5Controller.js:131` — INSERT includes `account_id`
- `engine/services/liveOrderDispatcher.js` — UPDATE/INSERT includes `account_id`
- All broker drivers that persist orders (BacktestDriver, CoreXPaperDriver, MetaApiDriver)

---

## 6. Package Structure (Matches Existing Conventions)

```
packages/corex-portfolio/
├── AGENTS.md
├── package.json
├── index.js
├── README.md
├── src/
│   ├── tradeHistoryService.js
│   └── analytics/
│       ├── buildClosedTrades.js
│       ├── buildEquityAnalytics.js
│       └── buildPerformance.js
└── test/
    └── tradeHistoryService.test.js
```

### `package.json` (target)
```json
{
  "name": "corex-portfolio",
  "version": "2026.1.27",
  "description": "CoreX Portfolio Layer — trade history, equity analytics, drawdown/returns calculations",
  "main": "index.js",
  "engines": { "node": ">=18.0.0" },
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
    "testMatch": ["**/test/**/*.test.js"],
    "moduleNameMapper": {
      "^@root$": "<rootDir>/../../..",
      "^@core$": "<rootDir>/../../engine",
      "^@utils$": "<rootDir>/../../utils",
      "^@events$": "<rootDir>/../../events",
      "^@config$": "<rootDir>/../../config"
    }
  }
}
```

### `index.js` (target)
```js
module.exports = {
  TradeHistoryService: require("./src/tradeHistoryService")
};
```

### `src/tradeHistoryService.js`
- Move `engine/services/tradeHistoryService.js` verbatim into package.
- Replace `require("@core/services/postgres")` with direct `require("pg")` pool injection via constructor: `new TradeHistoryService(pool)`.
- Singleton export retained for backward compatibility with the shim.

---

## 7. Re-export Shim

`engine/services/tradeHistoryService.js` becomes a re-export shim:

```js
module.exports = require("@portfolio/corex-portfolio");
```

This preserves the existing `@core/services/tradeHistoryService` require path used by `executionController.js`.

---

## 8. Consumer Updates

**Current consumer:** `engine/routes/executionController.js:14,238`
- No path changes required — the shim preserves the alias.
- The `/api/run/history` endpoint continues to pass `userId`, `environment`, etc. unchanged.

**No other consumers** exist in `engine/`, `packages/`, or `front_end/`.

---

## 9. Test Strategy

### Unit tests (new — `packages/corex-portfolio/test/tradeHistoryService.test.js`)
- `buildClosedTrades`: FIFO match, partial close, same-side add, zero-quantity edge cases
- `buildEquityAnalytics`: equity curve shape, drawdown magnitude, returns, rolling Sharpe
- `buildPerformance`: net profit, ROI, win rate, profit factor, expectancy
- `normalizeFillRow`: side coercion, quantity normalization, timestamp fallback
- `parseFilters`: environment coercion, limit clamping, date validation

### Integration test
- `executionController.js` GET `/api/run/history` continues to work through the shim.
- No new DB migration if Option A is chosen; existing `orders`/`order_fills` data is used.

---

## 10. What Is Uncertain / Needs a Design Decision

| Item | Why Uncertain | Decision Needed |
|------|---------------|-----------------|
| `userId` vs `account_id` keying | `orders` table currently has no `account_id`. Adding it touches every order insertion point and requires backfill. | Owen must choose Option A (lean, no schema change) or Option B (full schema migration). |
| `paper_trades` table | A parallel `paper_trades` table exists alongside `orders`. `tradeHistoryService` does not read it. Should `corex-portfolio` eventually unify these, or is `paper_trades` owned by another package? | Defer — out of scope for this extraction, but document as a future consolidation task. |
| `runtime_id` scoping | `orders` has `runtime_id`. The current analytics ignores it. If a user wants history per-runtime rather than per-user, the service would need a new filter. | Defer — not requested in current scope. |

---

## 11. Execution Order (If Option A Is Confirmed)

1. Create `packages/corex-portfolio/` with `package.json`, `index.js`, `AGENTS.md`, `src/`, `test/`.
2. Move `engine/services/tradeHistoryService.js` → `packages/corex-portfolio/src/tradeHistoryService.js`; replace `@core/services/postgres` with injected `pg` pool.
3. Create `engine/services/tradeHistoryService.js` re-export shim.
4. Add unit tests in `packages/corex-portfolio/test/`.
5. Run `npm test`; verify zero regressions.
6. Update `plans/to_do.md`.

**Do not proceed to implementation until Owen confirms Option A vs Option B.**
