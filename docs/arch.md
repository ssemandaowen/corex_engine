To provide you with a sharp, professional overview, here is the high-level workflow of your server acting as the **Control**, integrated with the hybrid **Postgres + File** database design.

### 1. The Total System Workflow

This is how a signal travels from your strategy to the broker and finally into the ledger.

1. **Initialization:** The server reads the `strategy_registry`. It verifies the `source_hash` of the file on disk. If it matches, the strategy is loaded into memory.
2. **Signal Generation:** The strategy (running in `backtest` or `live` mode) emits a signal.
3. **Validation:** The `engine` checks the `quota_profiles` and `risk_limits` in Postgres.
4. **Persistence (The Ledger):** A pending record is created in the `orders` table **before** the message leaves the server.
5. **Execution:** The `mt5Bridge` sends the request to the MT5 Terminal. The raw handshake is logged in `mt5_messages`.
6. **Reconciliation:** MT5 returns a "Fill." The server updates the `order_fills` and calculates the new `positions` snapshot in the DB.

---

### 2. Comprehensive Database Blueprint

This summary consolidates the five domains into a single source of truth.

| Schema Domain | Tables | Key Logic |
| --- | --- | --- |
| **Access Control** | `users`, `api_keys`, `quota_profiles` | Hard-coded limits on symbols/volume. |
| **Strategy Control** | `strategies`, `strategy_versions`, `runs` | Uses SHA-256 hashes to prevent code tampering. |
| **The Ledger** | `orders`, `order_fills`, `positions` | **Append-only.** You never delete a trade. |
| **Bridge Audit** | `mt5_terminals`, `mt5_messages` | Handshake observability for troubleshooting. |
| **Research Hub** | `backtest_runs`, `datasets`, `metrics` | Performance stats in DB; raw tick data on disk. |

---

### 3. Integrated File Structure

This structure ensures the **Server** can manage both its SQL records and its physical assets efficiently.

```bash
/project-root
├── db/
│   ├── migrations/             # SQL versioning (Core, Execution, MT5)
│   └── pool.js                 # Postgres connection logic
├── data/
│   ├── strategies/             # Physical JS/Python files (Read-only)
│   └── datasets/               # CSV/Parquet files for backtesting
├── engine/
│   ├── core/
│   │   ├── runner.js           # The "Control" - executes strategies
│   │   └── ledger.js           # Writes to orders/fills/positions
│   ├── services/
│   │   ├── hashVerifier.js     # Validates file integrity against DB
│   │   └── mt5Bridge.js        # Manages socket and mt5_messages
│   └── models/                 # Database abstraction (ORM or Raw)
└── broker/
    ├── paper.js                # Local simulation logic
    └── live.js                 # Production execution logic

```

---

### 4. Operational Principles

* **Source of Truth:** If it's not in the DB, it didn't happen. The server recovers its state from `positions` on restart.
* **Server as Control:** The server decides what runs based on the `strategy_runs` status; the files are just the logic units it executes.
* **Asynchronous Logging:** Hot paths (price updates) happen in memory; critical transitions (order fills) are persisted immediately.

**Would you like me to generate the full SQL DDL script for all these tables so you can run it as a single migration?**