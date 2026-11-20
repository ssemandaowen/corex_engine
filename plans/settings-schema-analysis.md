# CoreX Settings Schema Analysis (Phase 2A)

## 1. Inventory of All Current Settings

| Key | Type | Default | Defined In | Stored In | Read By | Scope |
|---|---|---|---|---|---|---|
| `max_concurrent_strategies` | integer | `3` | `db/migrations/023_user_engine_settings.sql:10` | `user_engine_settings.max_concurrent_strategies` | `userEngineSettingsService.js:19` | User |
| `default_paper_balance` | float | `100000` | `db/migrations/023_user_engine_settings.sql:11` | `user_engine_settings.default_paper_balance` | `userEngineSettingsService.js:20` | User |
| `default_timeframe` | string (enum) | `'1m'` | `db/migrations/023_user_engine_settings.sql:12` | `user_engine_settings.default_timeframe` | `userEngineSettingsService.js:21` | User |
| `default_mode` | string (enum) | `'PAPER'` | `db/migrations/023_user_engine_settings.sql:13` | `user_engine_settings.default_mode` | `userEngineSettingsService.js:22` | User |
| `risk_max_daily_loss_pct` | float | `null` | `db/migrations/023_user_engine_settings.sql:14` | `user_engine_settings.risk_max_daily_loss_pct` | `userEngineSettingsService.js:23` (persisted but not read by risk gate) | User |
| `risk_max_position_pct` | float | `null` | `db/migrations/023_user_engine_settings.sql:15` | `user_engine_settings.risk_max_position_pct` | `userEngineSettingsService.js:24` (persisted but not read by risk gate) | User |
| `notifications_json` | json | `{}` | `db/migrations/023_user_engine_settings.sql:16` | `user_engine_settings.notifications_json` | `userEngineSettingsService.js:25` | User |
| `initialCash` / `cash` | float | `100000` | `db/migrations/001_corex_init.sql:51-52`, `engine/routes/settingsController.js:180` | `user_broker_settings.cash`, `user_broker_settings.initial_cash` | `settingsController.js:208`, `PaperBroker` / `LiveBroker` | User + Mode |
| `riskFloor` | float | `null` | `engine/routes/settingsController.js:183` | `user_broker_settings.config->>'riskFloor'` | `BaseBroker._passesRiskFloor()` (`packages/corex-broker-contract/src/base/BaseBroker.js:211`) | User + Mode |
| `commissionPct` | float | `0` | `engine/routes/settingsController.js:185` | `user_broker_settings.config->>'commissionPct'` | `CoreXPaperDriver` | User + Mode |
| `slippageBps` | float | `5` (paper) | `engine/routes/settingsController.js:186` | `user_broker_settings.config->>'slippageBps'` | `CoreXPaperDriver` | User + Mode |
| `spreadBps` | float | `2` (paper) | `engine/routes/settingsController.js:187` | `user_broker_settings.config->>'spreadBps'` | `CoreXPaperDriver` | User + Mode |
| `leverage` | float | `1` | `engine/routes/settingsController.js:191` | `user_broker_settings.config->>'leverage'` | `PaperBroker` / `LiveBroker` | User + Mode |
| `connectors` | json | `{}` | `db/migrations/012_user_auth_isolation.sql:5` | `user_system_settings.payload->'connectors'` | `settingsController.js:133`, `connectorSettingsService.js` | User |
| `editorFontSize` | integer | `13` | `front_end/src/store/uiStore.ts:60` | `localStorage('corex_editor_font_size')` | `front_end/src/components/strategies/EditorPanel.tsx:135` | User (Frontend-only) |
| `editorTabSize` | integer | `2` | `front_end/src/store/uiStore.ts:61` | `localStorage('corex_editor_tab_size')` | `front_end/src/components/strategies/EditorPanel.tsx:136` | User (Frontend-only) |
| `editorWordWrap` | bool | `true` | `front_end/src/store/uiStore.ts:62` | `localStorage('corex_editor_word_wrap')` | `front_end/src/components/strategies/EditorPanel.tsx:137` | User (Frontend-only) |
| `editorMinimap` | bool | `false` | `front_end/src/store/uiStore.ts:63` | `localStorage('corex_editor_minimap')` | `front_end/src/components/strategies/EditorPanel.tsx:138` | User (Frontend-only) |
| `editorTheme` | string (enum) | `'corex-dark'` | `front_end/src/store/uiStore.ts:64` | `localStorage('corex_editor_theme')` | `front_end/src/components/strategies/EditorPanel.tsx:139` | User (Frontend-only) |
| `editorLineNumbers` | bool | `true` | `front_end/src/store/uiStore.ts:65` | `localStorage('corex_editor_line_numbers')` | `front_end/src/components/strategies/EditorPanel.tsx:140` | User (Frontend-only) |
| `editorAutoClosingBrackets` | bool | `true` | `front_end/src/store/uiStore.ts:66` | `localStorage('corex_editor_auto_close')` | `front_end/src/components/strategies/EditorPanel.tsx:141` | User (Frontend-only) |
| `theme` | string (enum) | `'dark'` | `front_end/src/store/uiStore.ts:50` | `localStorage('corex_theme')` | `front_end/src/App.tsx:619`, `SettingsView.tsx:1173` | User (Frontend-only) |
| `candleViewportSize` | integer | `200` | Hardcoded in chart components | Hardcoded | `front_end/src/components/run/SingleInstanceChartCard.tsx` | User (Frontend-only) |
| `maxCandleHistory` | integer | `5000` | `config/constants.js:192` (`DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY`) | Hardcoded constant | `packages/corex-strategy-engine/src/SoACandleStore.js:25` | Global |
| `tablePageSize` | integer | `25` | Hardcoded in data tables | Hardcoded | `front_end/src/views/DataView.tsx` | User (Frontend-only) |
| `wsUpdateRateCap` | integer | `250` (ms) | `config/constants.js:199` (`PAPER_BROKER_DEFAULTS.POSITION_BROADCAST_MIN_MS`) | Hardcoded constant | `engine/services/broadcaster.js:35` | Global |

---

## 2. Current Settings API Surface

### 1. `GET /api/settings`
- **Method & Path:** `GET /api/settings` (`engine/routes/settingsController.js:11`)
- **Auth:** `authGuard` middleware (`engine/server.js:71`).
- **Request:** None.
- **Response:** `{ success: true, payload: { runtime, persisted } }`
- **Called by:** Not currently called directly by frontend.

### 2. `GET /api/settings/engine`
- **Method & Path:** `GET /api/settings/engine` (`engine/routes/settingsController.js:155`)
- **Auth:** `authGuard`.
- **Response:** `{ success: true, payload: { user_id, max_concurrent_strategies, ... } }`
- **Called by:** `front_end/src/api/system.ts:7` (`getSystemSettings`).

### 3. `PATCH /api/settings/engine`
- **Method & Path:** `PATCH /api/settings/engine` (`engine/routes/settingsController.js:161`)
- **Auth:** `authGuard`.
- **Request Body:** `{ settings: { max_concurrent_strategies: 5, ... } }`
- **Response:** `{ success: true, payload: { ... } }`
- **Called by:** `front_end/src/api/system.ts:8` (`updateSystemSettings`).

### 4. `GET /api/settings/account/:mode`
- **Method & Path:** `GET /api/settings/account/:mode` (`engine/routes/settingsController.js:197`)
- **Auth:** `authGuard`.
- **Response:** `{ success: true, payload: { mode, balance, initialCash, riskFloor, slippageBps, ... } }`
- **Called by:** `front_end/src/api/system.ts:9,11,13` (`getPaperSettings`, `getLiveSettings`, `getAccountSettings`).

### 5. `PATCH /api/settings/account/:mode`
- **Method & Path:** `PATCH /api/settings/account/:mode` (`engine/routes/settingsController.js:226`)
- **Auth:** `authGuard`.
- **Request Body:** Partial account settings object (e.g. `{ initialCapital: 50000, riskFloor: 0.05 }`).
- **Response:** `{ success: true, payload: { ... } }`
- **Called by:** `front_end/src/api/system.ts:10,12,14` (`updatePaperSettings`, `updateLiveSettings`, `patchAccountSettings`).

### 6. `POST /api/settings/account/:mode/reset`
- **Method & Path:** `POST /api/settings/account/:mode/reset` (`engine/routes/settingsController.js:256`)
- **Auth:** `authGuard`.
- **Response:** `{ success: true, message: "Account reset to defaults", payload: { ... } }`
- **Called by:** `front_end/src/api/system.ts:15` (`resetAccountSettings`).

### 7. `GET /api/settings/connectors`
- **Method & Path:** `GET /api/settings/connectors` (`engine/routes/settingsController.js:118`)
- **Auth:** `authGuard`.
- **Query Params:** `?mode=paper|live`
- **Response:** `{ success: true, payload: [ { connectorType, schema, isActive, hasSecrets, maskedKeys, config }, ... ] }`
- **Called by:** `front_end/src/api/connectorSettings.ts:4` (`list`).

---

## 3. Limits Layering Architecture

Hard vs soft limits are currently enforced in:
1. **Risk Engine Guardrails (Hard Limits):**
   - Defined in `config/constants.js:205-212` (`RISK_DEFAULTS`):
     - `MAX_POSITION_SIZE`: `0.25` (25% portfolio max per position).
     - `MAX_POSITION_RISK_PCT`: `5.0%` (hard floor guardrail).
     - `MAX_GLOBAL_DRAWDOWN_PCT`: `10.0%` (pipeline halt cutoff).
   - Validated at runtime by risk gate and broker drivers (`packages/corex-broker-contract/src/base/BaseBroker.js:211`).
2. **Schema Registry Integration:**
   - The new Schema Registry plugs directly into `PATCH /api/settings` by validating every incoming `{ key, value }` against `entry.min`, `entry.max`, and `entry.enum` BEFORE delegating to persistence.
   - If a setting edit violates hard limits or schema constraints, the server rejects the edit with HTTP `400 BAD_REQUEST` and error `SETTINGS_VALIDATION_FAILED`, returning the schema bounds.

---

## 4. Schema Registry Mapping Proposal

### Can the Registry be a Pure Metadata Layer?
**YES.** A new DB table is NOT required. All settings map cleanly into the existing three tables:

1. **`user_engine_settings`** (table created in `db/migrations/023_user_engine_settings.sql`):
   - Holds structured columns: `max_concurrent_strategies`, `default_paper_balance`, `default_timeframe`, `default_mode`, `risk_max_daily_loss_pct`, `risk_max_position_pct`.
   - Holds JSON column `notifications_json`: stores UI display limits, editor settings (`editorFontSize`, `editorTabSize`, `editorWordWrap`, `editorMinimap`, `editorTheme`, `editorLineNumbers`, `editorAutoClosingBrackets`, `theme`, `candleViewportSize`, `tablePageSize`, `wsUpdateRateCap`).
2. **`user_broker_settings`** (`db/migrations/012_user_auth_isolation.sql:9`):
   - Holds account mode settings (`cash`, `initial_cash`, `riskFloor`, `commissionPct`, `slippageBps`, `spreadBps`, `leverage`).
3. **`user_system_settings`** (`db/migrations/012_user_auth_isolation.sql:3`):
   - Holds system & connector configuration payloads.

No migration is needed for Phase 2.

---

## 5. Backend-Only vs Exposed Classification

| Key | Expose to Frontend? | Reason |
|---|---|---|
| `max_concurrent_strategies` | Yes (Read-Only) | Enforcement is server-side; UI shows capacity quota. |
| `default_paper_balance` | Yes | User preference for paper account reset value. |
| `default_timeframe` | Yes | Default timeframe pre-selected in runtime launcher. |
| `default_mode` | Yes | Default mode pre-selected on login. |
| `risk_max_daily_loss_pct` | Yes | Soft risk limit editable by user. |
| `risk_max_position_pct` | Yes | Soft position size cap editable by user. |
| `riskFloor` | Yes | Drawdown floor protection setting. |
| `commissionPct` | Yes | Paper broker simulation fee configuration. |
| `slippageBps` | Yes | Paper broker simulation slippage configuration. |
| `spreadBps` | Yes | Paper broker simulation spread configuration. |
| `leverage` | Yes | Account margin leverage multiplier. |
| `theme` | Yes | UI visual theme selection (`dark`, `light`, `godot-dark`, `godot-light`, `high-contrast`). |
| `editorFontSize` | Yes | Code editor font size. |
| `editorTabSize` | Yes | Code editor indentation size. |
| `editorWordWrap` | Yes | Code editor word wrap toggle. |
| `editorMinimap` | Yes | Code editor minimap toggle. |
| `editorTheme` | Yes | Code editor theme palette selection. |
| `editorLineNumbers` | Yes | Code editor line numbers toggle. |
| `editorAutoClosingBrackets` | Yes | Code editor bracket completion toggle. |
| `candleViewportSize` | Yes | Chart initial rendering bar count. |
| `tablePageSize` | Yes | Pagination size for trade/log tables. |
| `wsUpdateRateCap` | Yes | Client WS update throttling frequency. |
| `maxCandleHistory` | **No (Backend-Only)** | Engine memory safety boundary; UI cannot alter buffer ceiling. |
| `apiKeys` / secrets / credentials | **No (Backend-Only / Masked)** | Security invariant; credentials must never be sent in full text. |

---

## 6. WS Delta Mechanism & Event Types Reconciliation

### WS Event Types Reconciliation
- **Total defined in `@config/constants.js:108-144` (`WS_EVENT_TYPES`):** Exactly **35 constants**.
- **Handled in `dataStore.ts`:** 26 event types.
- **Unhandled in `dataStore.ts`:** 9 event types (`FEED_METRICS`, `MT5_CONNECTED`, `MT5_DISCONNECTED`, `MT5_AUTHORIZED`, `MT5_AUTH_FAILED`, `MT5_HEARTBEAT`, `MT5_ORDER_REQUEST`, `MT5_ORDER_RESULT`, `STRATEGY_PLOT_UPDATE`).
- *(Note on Phase 0 Audit statement: The 27 count referred to active event categories emitted by `broadcaster.js`).*

### New WS Event Type for Settings Deltas
- Add `SETTINGS_DELTA: "SETTINGS_DELTA"` to `WS_EVENT_TYPES` in `config/constants.js`.
- Payload format: `{ key: string, value: any, version: number }`.
- Target: Sent ONLY to sockets belonging to the affected `userId` (`broadcaster._safeSend(ws, ...)` filtering on `ws.userId === userId`).

---

## 7. Versioning & Reconnect Protocol

1. **User Settings Monotonic Counter:**
   - Store `settings_version` (integer) in `user_engine_settings.settings_version` (default `1`, incremented on every edit).
2. **WebSocket Upgrade & Sync Handshake:**
   - On WS connection/reconnect, client includes `?settings_version=N` in connection URL query string (`engine/server.js:106`).
   - If client `N === serverVersion`: server sends `{ type: "SETTINGS_SYNC", status: "UP_TO_DATE" }`.
   - If client `N < serverVersion`: server replies with `{ type: "SETTINGS_SNAPSHOT", version: serverVersion, settings: { ... } }`.

---

## 8. Frontend Impact Analysis

### Files to Switch from Local Storage / Hardcoded Values to Settings Store:
1. `front_end/src/store/uiStore.ts`: Remove local theme/editor getters/setters that manipulate `localStorage`.
2. `front_end/src/components/strategies/EditorPanel.tsx`: Read editor options from settings store instead of `uiStore`.
3. `front_end/src/views/SettingsView.tsx`: Replace manual setting sections with generic, schema-driven `SettingsPanel`.
4. `front_end/src/components/run/SingleInstanceChartCard.tsx`: Read `candleViewportSize` from settings store.
5. `front_end/src/views/DataView.tsx`: Read `tablePageSize` from settings store.

---

## 9. Risks & Open Decisions for Owen

1. **Q1: Should frontend display settings (theme, editor font, page size) sync across user devices via DB persistence?**
   - *Recommendation:* **Yes.** Storing them in `user_engine_settings.notifications_json` ensures seamless multi-device workspace preferences without requiring new database columns or tables.
2. **Q2: Should settings edits use HTTP REST or WS messages?**
   - *Recommendation:* **HTTP REST (`PATCH /api/settings`) for writes, WS for live propagation.** HTTP provides clean HTTP status codes (`200 OK` vs `400 Bad Request` validation errors), while WS deltas immediately update all other open browser tabs for that user.

---

## 10. Proposed Phase 2B Implementation Breakdown

1. **Step 2B-1: Schema Registry Module (`engine/services/settingsSchemaRegistry.js`)**
   - Create schema registry module with type checking, min/max/enum validation, and default values.
   - Expose `GET /api/settings/schema` with ETag support (`304 Not Modified`).
2. **Step 2B-2: Single-Setting Edit & WS Delta Handler**
   - Update `PATCH /api/settings` to validate single `{ key, value }` edits against schema, update DB, increment `settings_version`, and broadcast `SETTINGS_DELTA` over WS.
3. **Step 2B-3: Generic `SettingsPanel` Component & Store**
   - Build Zustand settings store in frontend consuming `/api/settings/schema` and listening to `SETTINGS_DELTA` WS events.
   - Build generic auto-rendering `SettingsPanel` in `front_end/src/components/settings/SettingsPanel.tsx`.
4. **Step 2B-4: Wire UI Components & Settings Reconnect Handshake**
   - Wire `EditorPanel.tsx`, `SettingsView.tsx`, and chart components to settings store. Pass `settings_version` on WS reconnect.
