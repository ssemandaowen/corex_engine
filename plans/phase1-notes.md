# Phase 1 Notes — Untouched Mock/Synthetic Items Encountered

The following mock/synthetic data sources and simulated fallback handlers were encountered during Phase 1 styling and class sweeps. In accordance with Phase 1 instructions, they remain untouched for removal in Phase 4:

1. `front_end/src/views/HomeView.tsx:33-51`: `mockMetrics` and `mockActiveStrategies` hardcoded objects providing synthetic equity curves, PnL numbers, and active strategy stats when backend status is absent or loading.
2. `front_end/src/views/DataView.tsx:427-440`: `setTimeout` delay simulating async database queries returning hardcoded analytical data.
3. `front_end/src/components/analytics/StrategyExplorer.tsx:80-120`: Hardcoded equity/drawdown curve points and synthetic strategy performance metrics.
4. `front_end/src/components/run/SingleInstanceChartCard.tsx:46-60`: `setInterval` loop generating synthetic telemetry data points (cpu, memory, PnL) if live telemetry is missing.
5. `front_end/src/views/AccountView.tsx:457`: Hardcoded placeholder wrong password HTML message.
