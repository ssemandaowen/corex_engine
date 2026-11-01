# CoreX Frontend Overhaul Plan (Phase 0 Audit Findings)

## 1. Frontend Styling Audit
### Files Defining Styling
- `front_end/src/index.css`: Main stylesheet importing Google Fonts (`DM Sans`, `JetBrains Mono`, `Space Grotesk`), `@import "./styles/variables.css"`, and `@import "tailwindcss"`. Defines `@theme` directives, global body rules, helper classes (`.panel-header`, `.section-label`), and scrollbar styles (includes `border-radius: 3px`).
- `front_end/src/styles/variables.css`: CSS custom properties definition file (`:root`, `.theme-dark`, `.theme-light`, `.theme-godot-dark`, `.theme-godot-light`). Contains variables for border-radius (`--ui-radius: 12px`, `--ui-radius-sm: 8px`, `--ui-radius-xs: 6px`), theme palettes, shadows (`--ui-shadow`), and glow (`--ui-glow`).
- Components & Views inline styles & Tailwind utility classes (`front_end/src/components/*`, `front_end/src/views/*`, `front_end/src/App.tsx`, `front_end/src/context/ToastContext.tsx`): Extensive inline styles (`style={{ backgroundColor: ... }}`) and utility classes (`rounded`, `rounded-lg`, `rounded-full`, `shadow-xl`, `backdrop-blur`, `bg-gradient-to-...`, `transition-all`, `animate-pulse`, etc.).

### Styling Approach Detected
A hybrid styling architecture combining **Tailwind CSS v4** with **CSS Custom Properties (Variables)** and extensive inline React `style` objects.
Key issues relative to task guidelines:
- Widespread use of rounded corners (`rounded-lg`, `rounded-full`, `--ui-radius`).
- Extensive use of box-shadows, glow effects, gradients, and backdrop blur (`shadow-xl`, `--ui-shadow`, `--ui-glow`).
- CSS transitions and animations (`transition-all`, `animate-pulse`, `animate-fade-in`).
- Hardcoded inline color values (hex/rgb literals) in components.

---

## 2. Mock / Synthetic / Fake Data Audit
### `Math.random` Usage
- `front_end/src/store/dataStore.ts`:
  - Lines 114, 124, 531, 582, 607, 622: `id: Math.random().toString(36).substr(2, 9)` used to generate unique IDs for client-side signal, log, error, and toast items.
- `front_end/src/context/ToastContext.tsx`:
  - Line 22: `Math.random().toString(36).substr(2, 9)` used for toast notification identifiers.

### Synthetic Data / Hardcoded Data
- `front_end/src/views/HomeView.tsx`:
  - Lines 33-51: `mockMetrics` and `mockActiveStrategies` hardcoded objects providing synthetic equity curves, PnL numbers, and active strategy stats when backend status is absent or loading.
- `front_end/src/views/DataView.tsx`:
  - Lines 427-440: `setTimeout` delay simulating async database queries returning hardcoded analytical data.
  - Hardcoded reports data rendered when backtest results are absent or empty.
- `front_end/src/components/analytics/StrategyExplorer.tsx`:
  - Lines 80-120: Hardcoded equity/drawdown curve points and synthetic strategy performance metrics.
- `front_end/src/components/run/SingleInstanceChartCard.tsx`:
  - Lines 46-60: `setInterval` loop generating synthetic telemetry data points (cpu, memory, PnL) if live telemetry is missing.
- `front_end/src/views/AccountView.tsx`:
  - Lines 457, 1382, 1395, 1610: Placeholder wrong password HTML and hardcoded credentials text.

### Silent Fallback Sessions & Auth in `App.tsx`
- `front_end/src/store/uiStore.ts`:
  - Lines 42-49: Reads `corex_user` and `corex_token` from `localStorage` on init without immediate server verification.
- `front_end/src/App.tsx`:
  - If token exists in `localStorage`, `App.tsx` bypasses login without verifying token validity via backend auth endpoint. If API calls return 401, token is removed but initial load renders authenticated UI components with potentially stale or fake user state.

---

## 3. Polling Loops and Subscription Audit
### `setInterval` / Polling Loops in Frontend
1. `front_end/src/components/run/SingleInstanceChartCard.tsx:46`: `setInterval(fetchTelemetry, 3000)` - REST polling for run telemetry.
2. `front_end/src/components/run/MonitorSubTab.tsx:96`: `setInterval(loadInstances, 6000)` - REST polling for active execution instances.
3. `front_end/src/components/run/MonitorSubTab.tsx:115`: `setInterval(fetchTelemetry, 3000)` - REST polling for telemetry metrics.
4. `front_end/src/components/run/LiveBridgeSubTab.tsx:32`: `setInterval(fetchMt5Status, 8000)` - REST polling for MT5 bridge state.
5. `front_end/src/components/run/BacktestSubTab.tsx:304`: `setInterval(poll, 1500)` - REST polling for backtest job progress.
6. `front_end/src/components/run/RuntimesSubTab.tsx:145`: `setInterval(..., 1000)` - Polling loop for runtime statuses.
7. `front_end/src/hooks/useRuntimes.ts:38`: `setInterval(..., 1000)` - Global runtime status polling timer.
8. `front_end/src/views/RunView.tsx:142`: `setInterval(..., 3000)` - Polling run status.
9. `front_end/src/views/HomeView.tsx:96`: `setInterval(fetchOpsTelemetry, 20000)` - Polling system operational metrics.
10. `front_end/src/views/SettingsView.tsx:294`: `setInterval(getDiag, 5000)` - Polling diagnostic info.
11. `front_end/src/views/DataView.tsx:188`: `setInterval(loadData, 8000)` - Polling data reports.
12. `front_end/src/views/WorkspaceView.tsx:163`: `setInterval(..., 1000)` - Uptime counter timer.

### Candidates for WS Subscription Replacement
- Telemetry fetches (`/api/run/:id/telemetry`) -> Replace with `DATA_TICK` or `STRATEGY_METRICS_TICK` WS subscriptions.
- MT5 Bridge status (`/api/bridge/status`) -> Replace with `MT5_BRIDGE_STATUS` WS events.
- Backtest job progress polling (`/api/backtest/jobs/:id`) -> Replace with `BACKTEST_PROGRESS` WS push events.
- System ops telemetry (`/api/system/status`) -> Replace with `STATUS_UPDATE` / `FEED_METRICS` WS push events.

---

## 4. Settings Audit
### Backend `settingsController` Mounting
- `settingsController.js` **IS mounted** in `engine/server.js`:
  - `const settingsRoutes = require("@core/routes/settingsController");`
  - `app.use("/api/settings", authGuard, userLimiter, settingsRoutes);`
  - `app.use("/api/accounts", authGuard, userLimiter, accountConnectorRouter);`

### Hardcoded Settings vs Server-Stored Settings
- **Hardcoded in Frontend (`uiStore.ts` & local states):**
  - Editor settings: `editorFontSize` (13), `editorTabSize` (2), `editorWordWrap` (true), `editorMinimap` (false), `editorTheme`, `editorLineNumbers` (true), `editorAutoClosingBrackets` (true).
  - Display/traffic limits: max candle history (`5000`), chart viewport size, table pagination sizes, WS update rates, active UI theme (`dark`, `light`, `godot-dark`, `godot-light`).
- **Server-Stored Settings:**
  - System settings (`user_system_settings`), Engine settings (`user_engine_settings`), Account settings (`user_broker_settings`).

---

## 5. WebSocket Event Types Audit
### Backend Event Types Defined in `@config/constants` (`WS_EVENT_TYPES`)
There are 27 active WS event types emitted by `broadcaster.js`.

### Event Types Handled in `front_end/src/store/dataStore.ts`
1. `STATUS_UPDATE` - Updates system status and strategies.
2. `MT5_ACCOUNT_SYNC` - Syncs MT5 account info.
3. `MT5_POSITIONS_SYNC` - Syncs MT5 open positions.
4. `DATA_TICK` - Updates latest tick prices per symbol.
5. `DATA_CANDLE` - Updates latest candle prices.
6. `MARKET_LOST` - Handled (no-op).
7. `ORDER_CREATED` - Updates orders ring buffer.
8. `ORDER_FILLED` - Updates orders ring buffer.
9. `ORDER_CANCELLED` - Updates orders ring buffer.
10. `ORDER_UPDATED` - Updates orders ring buffer.
11. `POSITION_UPDATED` - Updates positions ring buffer.
12. `PORTFOLIO_UPDATED` - Updates portfolio state.
13. `STRATEGY_START` - Updates strategy status to running.
14. `STRATEGY_STOP` - Updates strategy status to stopped.
15. `STRATEGY_STATE` - Updates strategy status.
16. `STRATEGY_LOADED` - Adds strategy to store.
17. `STRATEGY_UNLOADED` - Removes strategy from store.
18. `STRATEGY_PARAMS_UPDATED` - Updates runtime params.
19. `STRATEGY_METRICS_TICK` - Updates strategy metrics.
20. `STRATEGY_SIGNAL` - Adds signal line to terminal log.
21. `WORKER_STATE` - Updates worker state.
22. `BACKTEST_PROGRESS` - Updates backtest job progress state.
23. `SYSTEM_LOG` - Appends to activity logs.
24. `SYSTEM_ERROR` - Appends to system error logs.
25. `RUNTIME_MEMORY_WARNING` - Appends warning to activity logs.
26. `PARAM_UPDATE` - Handled (no-op).

### Event Types NOT Currently Handled in Frontend
- `FEED_METRICS`
- `MT5_CONNECTED`, `MT5_DISCONNECTED`, `MT5_AUTHORIZED`, `MT5_AUTH_FAILED`, `MT5_HEARTBEAT`, `MT5_ORDER_REQUEST`, `MT5_ORDER_RESULT`
- `STRATEGY_PLOT_UPDATE`
- `BACKTEST_UPLOAD_CREATED`, `BACKTEST_UPLOAD_DELETED`, `BACKTEST_UPLOAD_ARCHIVED`

---

## 6. Proposed Phase Order and Implementation Plan

### Phase 1 — Flat Design System
1. Update `front_end/src/styles/variables.css` and `front_end/src/index.css`:
   - Set all `--ui-radius` variables to `0px`.
   - Remove shadows, glow, and gradient CSS variables.
   - Set `transition: none` globally.
2. Update Tailwind configuration and replace all `rounded-*`, `shadow-*`, `backdrop-blur`, `bg-gradient-*`, `transition-*`, and `animate-*` classes in all views and components.
3. Replace all hex/rgb color literals in inline styles across `frontend/src/` with token variables.

### Phase 2 — Server-Driven Settings ("Godot Inspector" Model)
1. Backend: Implement schema registry in a new module (`engine/services/settingsSchemaRegistry.js`). Define key, type, label, group, default, min/max or enum, scope, restartRequired, exposeToFrontend.
2. Backend: Add `GET /api/settings/schema` with ETag support, and PATCH edit handler sending single key/value WS deltas + version number over broadcaster.
3. Frontend: Create generic `SettingsPanel` component driven entirely by schema. Build single settings store consuming schema + WS deltas.

### Phase 3 — Minimise Server Traffic and Memory
1. Implement explicit WS subscription protocol (`{ action: 'subscribe', channel, symbol, timeframe }`).
2. Implement backend coalescing for forming-candle / tick updates and backpressure buffering limit.
3. Replace all frontend `setInterval` polling with WS subscriptions or one-shot user action REST calls. Convert list stores to bounded ring buffers.

### Phase 4 — Remove All Mocks, Wire Real Data
1. Delete all synthetic data sources, hardcoded mock arrays, and `setTimeout` delays.
2. Enforce strict auth in `App.tsx`: show only login screen when unauthenticated or token is invalid.
3. Wire Reports/Analytics view to read real stored backtest results from backend endpoints. If no results exist, show explicit empty state.

### Phase 5 — Verification & End-to-End Tests
1. Run named behavior tests 1–10 as defined in task specification.
2. Run automated acceptance checklist greps to verify zero `border-radius`, `box-shadow`, hex literals, or `setInterval` polling remains.

---

## 7. Key Risks & Mitigation Strategy
1. **Risk:** Schema mismatch or out-of-sync settings on WS reconnect.
   - **Mitigation:** Frontend sends version tag on WS reconnect; server sends diff or full schema snapshot if stale.
2. **Risk:** WebSocket connection leaks on component unmount during rapid view tab switching.
   - **Mitigation:** Implement explicit cleanup in React `useEffect` hooks to unsubscribe channels on view unmount.
3. **Risk:** Accidentally touching backend `corex-*` internal packages or database migrations.
   - **Mitigation:** Scope backend additions strictly to `engine/` routes and new settings schema module.
