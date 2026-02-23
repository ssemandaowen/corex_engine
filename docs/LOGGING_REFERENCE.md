# CoreX Logging Reference

## 1. Why this exists
This document explains how to read and interpret CoreX logs quickly during development and operations.

## 2. Log Format

Typical file log format:
```text
YYYY-MM-DD HH:mm:ss [COREX] LEVEL [MODULE][LEVEL] Message
```

Examples:
```text
2026-02-20 07:05:29 [COREX] INFO [STRATEGY_BOOTLOADER][INFO] Boot complete: 5/5 strategies booted successfully
2026-02-20 07:05:34 [COREX] WARN [WS] STATUS_UPDATE failed: loader.listStrategies is not a function
2026-02-20 21:15:00 [COREX] ERROR [ENGINE][ERROR] [ADAPTER] ema_crossover signal failed: broker.buy is not a function
```

## 3. Severity Meaning

- `DEBUG`: internal diagnostics and guard traces.
- `INFO`: normal lifecycle, state transitions, successful operations.
- `WARN`: degraded behavior, recoverable errors, configuration drift.
- `ERROR`: operation failed; action required.

## 4. Module Tags and Meaning

- `[ENGINE]`: tick routing, warmup, registration, runtime processing.
- `[STRATEGY_BOOTLOADER]`: strategy discovery/compile/link/register lifecycle.
- `[STRATEGY_COMPILER]`: source compile + validation failures.
- `[ADAPTER]`: signal validation/routing/execution path issues.
- `[WS]`: broadcaster/status websocket emission and client connectivity.
- `[CONFIG]`: settings load/refresh/runtime apply.
- `[DB]`: migrations, connectivity, persistence issues.
- `[MT5]` / bridge tags: live bridge connectivity and execution sync.

## 5. Common Log Families (Message -> Meaning -> Action)

### 5.1 Strategy Lifecycle
- Message: `OFFLINE -> STAGED`
  - Meaning: strategy compiled and staged, not running yet.
  - Action: start strategy via execution endpoint/UI.

- Message: `STAGED -> WARMING_UP`
  - Meaning: registration started, historical sync in progress.
  - Action: wait; investigate only if stuck too long.

- Message: `WARMING_UP -> ACTIVE`
  - Meaning: warmup complete and strategy is live.
  - Action: normal.

- Message: `WARMING_UP -> ERROR`
  - Meaning: warmup failed.
  - Action: inspect data feed connectivity and symbol/timeframe validity.

### 5.2 Adapter Errors
- Message: `INVALID_SCHEMA`
  - Meaning: strategy emitted malformed signal.
  - Action: ensure `strategyId`, `symbol`, `intent`, and valid numeric `quantity`.

- Message: `Signal locked: <strategy>_<symbol>`
  - Meaning: concurrent duplicate execution prevented.
  - Action: normal guard behavior unless constant lock churn.

- Message: `BROKER_CLOSE_NOT_SUPPORTED` / `BROKER_UNAVAILABLE`
  - Meaning: broker integration mismatch.
  - Action: verify broker execution API for mode.

### 5.3 WS/Broadcaster
- Message: `STATUS_UPDATE failed: loader.listStrategies is not a function`
  - Meaning: stale module/build mismatch.
  - Action: verify loader export + restart node process.

- Message: `WebSocket is closed before the connection is established` (browser console)
  - Meaning: client-side reconnect race or auth/session issue.
  - Action: inspect reconnect logic, auth token, and server upgrade path.

### 5.4 Feed/Network
- Message: `Client network socket disconnected before secure TLS connection was established`
  - Meaning: upstream network/TLS failure.
  - Action: check network, DNS, firewall/proxy, provider status.

### 5.5 DB/Config
- Message: `Postgres unreachable (ECONNREFUSED)`
  - Meaning: DB unavailable.
  - Action: start DB or set fallback flags (`COREX_DB_REQUIRED=false` if intended).

- Message: `Config load failed`
  - Meaning: settings retrieval/parsing issue.
  - Action: check persisted payload integrity and DB connectivity.

## 6. Strategy Author Logging (Recommended)

Use helper APIs from `StrategyDevHelpers`:
- `logDecision(message, meta?, level?)`
- `logSignal(signal, stage?, level?)`
- `logGuard(name, passed, details?)`

Example:
```js
this.logGuard("warmup", this.isWarmedUp(symbol), { symbol, lookback: this.lookback });
this.logDecision("ENTRY_CONDITION_MET", { symbol, price: data.close, fast: fast.at(-1), slow: slow.at(-1) });
this.logSignal(signal, "EMIT");
```

These produce predictable logs with strategy identifiers and context.

## 7. Fast Triage Workflow

1. Filter `ERROR` first, then `WARN`.
2. Group by module tag (`ENGINE`, `ADAPTER`, `STRATEGY_BOOTLOADER`, `WS`, `DB`).
3. Identify the first failure in time order (root cause), not the downstream cascade.
4. Cross-check with state transitions around failure timestamp.
5. Confirm recovery log exists (`... -> ACTIVE`, reconnect success, config reloaded).

## 8. Suggested Logging Improvements (Next Iteration)

- Add stable error codes per family (`ADAPTER_INVALID_SCHEMA`, `WS_STATUS_UPDATE_FAIL`).
- Add correlation ID per execution request/strategy tick path.
- Add structured JSON logs in parallel to text logs for easier search/alerting.

