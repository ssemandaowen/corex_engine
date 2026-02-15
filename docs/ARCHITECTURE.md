# CoreX Architecture

## Event-Driven Flow
1. Market data enters via broker WebSocket (TwelveData) and is normalized.
2. Ticks are published on the event bus (`EVENTS.MARKET.TICK`).
3. Engine enqueues ticks, fans out to strategies, and processes each strategy queue.
4. Strategies emit signals through a unified entry point (`_processData` → `next`).
5. Signals pass through `SignalAdapter`, which routes to PAPER or LIVE based on DB runtime state.
6. Orders and lifecycle events are published to the event bus and broadcast to UI via WebSocket.

## Dynamic Mode Switching
1. Strategy runtime state is stored in DB (`strategies.runtime_mode`, `strategies.runtime_params`).
2. Loader syncs runtime state in-memory without a process restart.
3. `SignalAdapter` performs a DB lookup per signal to determine `PAPER` or `LIVE`.
4. MT5 execution is gated by `system_settings.payload.execution` and terminal allowlist.

## Core Components
- `engine/core/engine.js`: Orchestrates tick distribution and strategy execution queues.
- `engine/managers/strategyManager.js`: Loads strategies from DB and syncs runtime state.
- `utils/BaseStrategy.js`: Standard strategy interface with `_processData` as the single entry point.
- `engine/signalAdapter.js`: Signal gateway for PAPER/LIVE/Backtest execution.
- `engine/services/broadcaster.js`: WebSocket bridge for UI events.
- `engine/services/mt5Bridge.js`: MT5 bridge WS and order relay.
- `engine/services/configService.js`: DB-backed settings cache.
- `engine/backtestManager.js`: Backtest orchestration and report persistence.

## WebSocket Event Types
- `DATA_TICK`
- `ORDER_FILLED`
- `PARAM_UPDATE`
- `STRATEGY_SIGNAL`
- `MT5_CONNECTED`, `MT5_DISCONNECTED`, `MT5_AUTHORIZED`, `MT5_AUTH_FAILED`
- `MT5_HEARTBEAT`, `MT5_ACCOUNT_SYNC`, `MT5_POSITIONS_SYNC`
- `MT5_ORDER_REQUEST`, `MT5_ORDER_RESULT`

## Persistence
- `strategies`: Strategy source, runtime mode, runtime params
- `backtests`: Backtest reports and performance
- `orders`: Live execution orders
- `system_settings`, `broker_settings`: Centralized config
