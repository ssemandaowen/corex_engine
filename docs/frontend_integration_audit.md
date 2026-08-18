# CoreX Frontend ↔ Backend Integration — Fix & Audit Log

**Date:** 2026-07-11
**Scope:** Implement the remaining TODOs from `frontend_integration_todo.md`
(Section 2), audit the already-applied Section 1 fixes against the live
backend, and record every change for traceability.

Verification performed:
- Backend controller route shapes compared against each frontend `api/*` call.
- `node --check` on the edited backend file.
- `tsc --noEmit` on the frontend (clean, no type errors).
- Unit-tested the error-location regex with real V8-style stacks.

---

## 0. Backend Route Alignment (ground truth)

| Frontend call | Backend endpoint | Status |
|---|---|---|
| `authApi.signin / signup / signout / me` | `POST /api/auth/signin|signup|signout`, `GET /api/auth/me` | present |
| `authApi.*ApiKey` | `POST/GET/DELETE /api/auth/apikeys` | present (matches `authController.js`) |
| `systemApi.getStatus` | `GET /api/system/heartbeat` | present |
| `systemApi.get/UpdateSystemSettings` | `GET/PATCH /api/settings/engine` | present |
| `systemApi.get/patchAccountSettings` | `GET/PATCH /api/settings/account/:mode` | present |
| `systemApi.resetAccountSettings` (NEW) | `POST /api/settings/account/:mode/reset` | present (`settingsController.js:222`) |
| `systemApi.getMt5Status` | `GET /api/system/mt5-status` | present |
| `strategiesApi.list/create/get/update/delete` | `GET/POST/GET/PUT/DELETE /api/strategies[/:id]` | present |
| `runApi.start/stop/...` | `POST /api/run/start/:id`, `POST /api/run/stop/:id`, … | present (`executionController.js`) |
| `backtestApi.run/getProgress/getReport/list` | `POST/GET /api/backtest/:id`, `GET /api/backtest/progress/:jobId`, `GET /api/backtest` | present (`backtestController.js:584,638,873,509`) |

---

## 1. Section 1 "Already Applied" Fixes — Audit

Each claim in the doc was verified against the current source. All confirmed present.

| # | Claim | Verified at | Result |
|---|---|---|---|
| A | Mock login fallbacks removed in `App.tsx` (`handleSignin`/`handleSignup`) | `front_end/src/App.tsx:254,275` | ✅ uses `authApi.signin/signup`, no mock JWT |
| A | Hardcoded session user removed in `uiStore.ts` | `front_end/src/store/uiStore.ts:48-57` | ✅ loads `corex_user` from localStorage |
| A | API key endpoints → `/api/auth/apikeys` | `front_end/src/api/auth.ts:8-10` | ✅ |
| B | System settings → `PATCH /api/settings/engine` | `front_end/src/api/system.ts:7,8` | ✅ |
| B | Account settings → `PATCH /api/settings/account/:mode` | `front_end/src/api/system.ts:9-14` | ✅ |
| C | Heartbeat → `GET /api/system/heartbeat` | `front_end/src/api/system.ts:4` | ✅ |
| D | Backtest run/report/list mapped correctly | `front_end/src/api/backtest.ts:4-7` | ✅ |
| D | Progress polled (JSON, not SSE) every 1000ms | `front_end/src/components/run/BacktestSubTab.tsx:200-230` | ✅ |
| D | Mock seed runs removed in `DataView.tsx` | `front_end/src/views/DataView.tsx` | ✅ (no `BT_SEED`/`PR_SEED`/`LV_SEED`) |
| E | Mock broker positions removed in `AccountView.tsx` | `front_end/src/views/AccountView.tsx:110-117` | ✅ falls back to `0`/`'N/A'` |
| E | WS `STATUS_UPDATE` + `bridgeStatus` | `front_end/src/store/dataStore.ts:177,190` | ✅ |

---

## 2. Task 1 — Monaco Editor Compilation Diagnostics ✅ IMPLEMENTED

**Problem:** On a failed save, `StrategyView.handleSave` swallowed the backend
500 and only showed a generic toast. The real compile error (with line/column)
was lost.

**Changes:**

1. `front_end/src/components/strategies/EditorPanel.tsx`
   - Added `onReady?: (editor, monaco) => void` prop.
   - `handleEditorDidMount` now calls `onReady(editor, monaco)` so the parent
     can register diagnostics markers.

2. `front_end/src/views/StrategyView.tsx`
   - Added `editorRef` + `handleEditorReady` and passed `onReady={handleEditorReady}`
     to `EditorPanel`.
   - Added `setCompileMarkers(line, column, message)` and `clearCompileMarkers()`
     using `monaco.editor.setModelMarkers(model, 'corex-compile', [...])`.
   - Added `parseCompileError(data, fallbackMsg)` — prefers the structured
     `details.line/column` from the backend, then falls back to regex on the
     message (`line N`, `:LINE:COL`, `at line N`).
   - `handleSave`: on success, clears markers; on error, parses the backend
     payload and registers an inline Monaco `Error` marker + logs it to the
     strategy terminal + shows a `Compile error (line N): …` toast.

3. `engine/routes/strategyController.js` (`PUT /api/strategies/:id`)
   - Added `extractErrorLocation(err)` which parses the V8 stack for
     `db://strategies/...:LINE:COL` (or `:LINE`). Restricted to the strategy
     source path so engine-internal errors (security/validation) never produce
     a spurious marker.
   - The 500 response now includes `details: { line, column }` when available.

**Verification:**
- `node --check` passes.
- Regex unit-tested: syntax error → `{line:3,column:1}`,
  `ReferenceError` → `{line:14,column:5}`, security error → `null`.
- Frontend `tsc --noEmit` clean.

---

## 3. Task 2 — Reset Balance API Action ✅ IMPLEMENTED

**Problem:** The "Reset Balance" button (`AccountView.tsx:659`) only issued a
local `PATCH` of the current values — it never reset the backend sandbox to
defaults.

**Changes:**

1. `front_end/src/api/system.ts`
   - Added `resetAccountSettings: (mode) => client.post('/api/settings/account/${mode}/reset')…`
   - Backed by the existing backend route `POST /api/settings/account/:mode/reset`
     (`settingsController.js:222`), which clears cash/config and restores
     defaults.

2. `front_end/src/views/AccountView.tsx`
   - Extracted the settings loader into a reusable component-level
     `loadAccountData()` (was an inline closure inside `useEffect`).
   - `handleResetPaper` now: confirms via `Swal`, calls
     `systemApi.resetAccountSettings('paper')`, and on success re-fetches
     settings (`loadAccountData()`) + live status (`fetchMt5Status`) so the UI
     reflects the restored defaults.
   - The "Reset Balance" button (`onClick={handleResetPaper}`) is now wired to
     the real reset action.

---

## 4. Task 3 — Strategy Runtimes Execution Synchronization ✅ VERIFIED (already implemented)

`runApi.start(id, { mode, symbol, params })` → `POST /api/run/start/:id`.
Backend `executionController.js:592` reads `mode`, `symbol`, `params` off the
body and forwards them to `runtimeService.startStrategy(...)`.

- `front_end/src/views/StrategyView.tsx:240` (`handleStart`) passes
  `{ mode, symbol: localParams.symbol || 'EURUSD', params: localParams }`.
- `front_end/src/views/WorksspaceView.tsx:255` (`triggerStart`) passes
  `{ mode, symbol, params }` from the per-row form state.
- Stop calls `runApi.stop(id)` and `updateStrategyStatus(id, 'stopped')` in
  both `StrategyView.tsx:259` and `WorkspaceView.tsx:223` and `RunView.tsx:235`.

No change required — behavior already correct and matches backend contract.

---

## 5. Task 4 — Global Token Expiry & Unauthorized Handling ✅ VERIFIED (already implemented)

- `front_end/src/api/client.ts:23-33`: response interceptor clears
  `corex_token` and dispatches `corex:unauthorized` on HTTP 401.
- `front_end/src/App.tsx:240-243`: `handleUnauthorized` sets `token` and
  `authUser` to `null`. Because `authUser || token` is falsy, the component
  re-renders the login/auth wrapper immediately (App.tsx:316).

No change required — behavior already correct.

---

## 6. Additional Correctness Fix

- `front_end/src/api/strategies.ts`: `update` type changed from
  `{ script_body?: string; … }` to `{ code?: string; … }` to match the actual
  backend contract (`PUT /api/strategies/:id` reads `req.body.code`). The
  runtime call already passed `{ code: currentCode }`; the type now reflects it.

---

## 7. Summary of Files Changed

| File | Change |
|---|---|
| `engine/routes/strategyController.js` | `extractErrorLocation()` + `details` in PUT error response |
| `front_end/src/components/strategies/EditorPanel.tsx` | `onReady` prop |
| `front_end/src/views/StrategyView.tsx` | Monaco markers + compile-error parse |
| `front_end/src/api/system.ts` | `resetAccountSettings()` |
| `front_end/src/views/AccountView.tsx` | `loadAccountData()` + reset-wired button |
| `front_end/src/api/strategies.ts` | `update` type → `code` |

**Still TODO (out of this pass, noted in `data_provider_refactor.md`):**
- Phased market-data provider refactor (DataProviderContract, TwelveDataProvider,
  factory, wiring into `engine.js`/`MarketFeed.js`, per-runtime `connectorType`).
