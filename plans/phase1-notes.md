# Phase 1 Notes — Untouched Mock/Synthetic Items & Acceptance Verification

## 1. Untouched Mock/Synthetic Items Encountered
The following mock/synthetic data sources and simulated fallback handlers were encountered during Phase 1 styling and class sweeps. In accordance with Phase 1 instructions, they remain untouched for removal in Phase 4:

1. `front_end/src/views/HomeView.tsx:33-51`: `mockMetrics` and `mockActiveStrategies` hardcoded objects providing synthetic equity curves, PnL numbers, and active strategy stats when backend status is absent or loading.
2. `front_end/src/views/DataView.tsx:427-440`: `setTimeout` delay simulating async database queries returning hardcoded analytical data.
3. `front_end/src/components/analytics/StrategyExplorer.tsx:80-120`: Hardcoded equity/drawdown curve points and synthetic strategy performance metrics.
4. `front_end/src/components/run/SingleInstanceChartCard.tsx:46-60`: `setInterval` loop generating synthetic telemetry data points (cpu, memory, PnL) if live telemetry is missing.
5. `front_end/src/views/AccountView.tsx:457`: Hardcoded placeholder wrong password HTML message.

## 2. Acceptance Checklist Grep Outputs

### Command: `git grep -nE "rounded" -- front_end/src`
```
(empty)
```

### Command: `git grep -nE "shadow|backdrop|gradient|animate-|transition|duration-|ease-" -- front_end/src`
```
front_end/src/index.css:23:  box-shadow: none !important;
front_end/src/index.css:24:  text-shadow: none !important;
front_end/src/index.css:25:  backdrop-filter: none !important;
front_end/src/index.css:26:  transition: none !important;
front_end/src/views/SettingsView.tsx:1180:                    showToast(`UI theme transitioned to '${chosen}'`, 'success');
```

### Command: `git grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" -- front_end/src/components front_end/src/views front_end/src/App.tsx front_end/src/context`
```
(empty)
```

## 3. Frontend Build Output

### Command: `pnpm --prefix front_end run build`
```
> corex-ui@0.0.0 build /app/front_end
> vite build

vite v6.4.5 building for production...
transforming...
✓ 2771 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.99 kB │ gzip:   0.48 kB
dist/assets/index-C6jXmxKq.css     62.34 kB │ gzip:  10.49 kB
dist/assets/index-B2tEImXV.js   1,452.01 kB │ gzip: 413.92 kB
✓ built in 8.41s
```
