# CoreX Frontend-Backend Integration & TODO Guide

This document outlines the investigation, fixes, and future tasks required to align the CoreX frontend dashboard with the proprietary Node.js backend high-fidelity trading engine. 

Before these changes, the UI was running on mock data and misaligned API paths (resulting in 404/500 errors). The system has been aligned to pull real data from the backend.

---

## 1. Summary of Applied Fixes

We have resolved several core mismatch issues across authentication, settings, status indicators, and backtesting:

### A. Authentication & User Management
* **Removed Mock Login Fallbacks**: In [App.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/App.tsx), we removed the code in `handleSignin` and `handleSignup` that caught API errors and automatically signed the user in with a mock JWT (`mock_jwt_token_corex`) and mock user profile. The UI now validates credentials against the real backend DB.
* **Cleared Hardcoded Session User**: In [uiStore.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/store/uiStore.ts), we removed the automatic assignment of the mock profile (`Owen Ssemanda`) on token initialization. The system now loads the user profile stored in `localStorage` (`corex_user`), which is set dynamically upon successful login or sign-up.
* **Aligned API Key Endpoints**: In [auth.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/api/auth.ts), the endpoints for creating, listing, and revoking API keys were changed from `/api/auth/api-key` to `/api/auth/apikeys` to match the backend [authController.js](file:///C:/Users/SBUM/desktop/corex/engine/routes/authController.js).

### B. Settings & Profile Alignments
* **System Settings**: Aligned [system.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/api/system.ts) to call the backend [settingsController.js](file:///C:/Users/SBUM/desktop/corex/engine/routes/settingsController.js) `/api/settings/engine` instead of `/api/settings/system`, and switched the method from `PUT` to `PATCH`.
* **Account/Broker Settings**: Aligned account settings to point to `/api/settings/account/:mode` instead of `/api/settings/:mode`, and changed the method to `PATCH`. This allows persistent saving of leverage, cash balance, commission, slippage, and broker connectors.

### C. Live Performance & Health Status
* **System Heartbeat**: Mapped the frontend status check in [system.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/api/system.ts) to `/api/system/heartbeat` (which returns real system CPU, memory, and database status) instead of `/api/system/status` (which returned a 404).

### D. Backtesting & Simulation Progress
* **Corrected Backtest Actions**:
  - `run` is now mapped to `POST /api/backtest/:id` (runs a backtest for strategy `:id`).
  - `getReport` is now mapped to `GET /api/backtest/:id` (retrieves the completed backtest report).
  - `list` is now mapped to `GET /api/backtest` (retrieves all backtest reports).
* **Backtest Progress Tracking**: The backend does *not* expose a Server-Sent Events (SSE) stream on `/api/backtest/progress/:jobId` (it returns standard JSON). Connecting to it via `EventSource` caused simulation failures in the UI. We updated [BacktestSubTab.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/components/run/BacktestSubTab.tsx) to poll the JSON endpoint every 1000ms using `getProgress` until completion (`DONE`, `ERROR`, or `CANCELLED`).
* **Disabled Fallback Mock Runs**: In [DataView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/DataView.tsx), we removed the code that injected mock historical runs (`BT_SEED_...`, `PR_SEED_...`, `LV_SEED_...`) when a strategy had no real runs. Now, the view displays only actual backtests and runtimes from the server database.

### E. Live Broker Accounts & WebSocket
* **Removed Mock Broker Data**: In [AccountView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/AccountView.tsx), we cleared the mock EURUSD and GBPUSD open positions. If no live positions are active on the MT5 gateway, it displays an empty list. Default metrics (balance/equity) now fallback to `0` and `'N/A'` instead of hardcoded `$124.5k`.
* **Aligned WebSocket Event Types**:
  - In [dataStore.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/store/dataStore.ts), we mapped the WebSocket ingestion to listen for `STATUS_UPDATE` (the actual event broadcast by the backend [broadcaster.js](file:///C:/Users/SBUM/desktop/corex/engine/services/broadcaster.js)) instead of the mock `SYSTEM_STATUS`. This feeds real CPU/RAM utilization and strategy runtimes into the store.
  - Aligned the `MT5_BRIDGE_STATUS` payload check to read `bridgeStatus` instead of `status` to fix the permanent `DISCONNECTED` label.

---

## 2. TODO List for Future Frontend Implementation

For the remaining views and files (like `WorkspaceView.tsx`, `RunView.tsx`, or Monaco Editor diagnostics), follow these instructions to wrap up backend connectivity:

### Task 1: Monaco Editor Compilation Diagnostics
* **Context**: When a user saves code in [StrategyView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/StrategyView.tsx) via `strategiesApi.update()`, the backend compiles the script. If compilation fails, the backend returns a 500 error with the exception details.
* **Requirement**: Instead of showing a generic toast ("Failed to compile assembly"), the frontend should parse the compilation error line number and message, and register it directly in Monaco as a visual diagnostic marker.
* **Implementation Plan**:
  1. Catch the compile error in `handleSave`.
  2. Parse the error message (usually contains line/column numbers, e.g., `ReferenceError: x is not defined at line 14`).
  3. Use Monaco's marker API to set the error:
     ```typescript
     monaco.editor.setModelMarkers(editor.getModel(), 'owner', [{
       startLineNumber: errorLine,
       startColumn: 1,
       endLineNumber: errorLine,
       endColumn: 1000,
       message: errorMessage,
       severity: monaco.MarkerSeverity.Error
     }]);
     ```

### Task 2: Implement "Reset Balance" API Action
* **Context**: In the "Sandbox Settings" within [AccountView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/AccountView.tsx), there is a button to "Reset Balance".
* **Requirement**: This should call the backend endpoint `POST /api/settings/account/:mode/reset` rather than performing a local reset or mock call.
* **Implementation Plan**:
  1. Add a `resetAccountSettings(mode: 'paper' | 'live')` API call in [system.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/api/system.ts):
     ```typescript
     resetAccountSettings: (mode: 'paper' | 'live') => client.post(`/api/settings/account/${mode}/reset`).then(res => res.data)
     ```
  2. Bind the "Reset Balance" button click in `AccountView.tsx` to this API call. Upon completion, trigger a refetch of settings and status.

### Task 3: Strategy Runtimes Execution Synchronization
* **Context**: In [RunView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/RunView.tsx) and [WorkspaceView.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/views/WorkspaceView.tsx), users start or stop strategies in `PAPER` or `LIVE` mode.
* **Requirement**: Ensure the `symbol` and custom `runtime_params` are correctly passed when starting a strategy via `runApi.start(id, { mode, symbol, params })`.
* **Implementation Plan**:
  1. In `WorkspaceView.tsx`, verify that when the "Start" action is triggered, it passes the selected symbol and parameter object.
  2. Double-check that stopping a strategy calls `runApi.stop(id)` and updates the local Zustand store's strategy status to `'stopped'`.

### Task 4: Global Token Expiry & Unauthorized Handling
* **Context**: We have an interceptor in [client.ts](file:///C:/Users/SBUM/desktop/corex/front_end/src/api/client.ts) that clears `corex_token` and dispatches `corex:unauthorized` upon a 401 response.
* **Requirement**: Ensure that the user is immediately redirected to the login panel.
* **Implementation Plan**:
  1. Review [App.tsx](file:///C:/Users/SBUM/desktop/corex/front_end/src/App.tsx)'s `useEffect` listener for `corex:unauthorized`.
  2. Ensure it clears Zustand state (`authUser` and `token`) instantly to force rendering of the authentication wrapper.
