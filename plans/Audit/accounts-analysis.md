# Account/Credential/Session Handling Analysis

> **Date:** 2026-08-28
> **Purpose:** Analyze state and coupling for prospective `corex-accounts` package.
> **Status:** READ-ONLY ANALYSIS.

---

## 1. File Analysis Tables

### `engine/services/brokerPersistence.js`
| Site | Action | Scope/Assumptions |
|:-----|:-------|:------------------|
| Line 13: `persistBrokerSettings(userId, mode, payload)` | Write | Assumes a user has exactly one set of settings per mode (Paper/Live). |
| Line 28: `bus.on(EVENTS.BROKER.STATE_CHANGED, ...)` | Write | Event-driven persistence based on `(userId, mode)`. |

### `engine/services/connectorSettingsService.js`
| Site | Action | Scope/Assumptions |
|:-----|:-------|:------------------|
| Line 43: `getConnectorConfig(userId, connectorType)` | Read | Keyed by `userId` + `connectorType`. Implicitly assumes one config per type per user. |
| Line 76: `saveConnectorConfig(...)` | Write | Upserts keyed by `userId` + `connectorType`. |

### `engine/routes/authController.js` & `engine/middleware/authGuard.js`
| Site | Action | Scope/Assumptions |
|:-----|:-------|:------------------|
| `authController.js`: 83, 143 | Write | Inserts into `corex_sessions` keyed by `session_id` and `user_id`. |
| `authController.js`: 190 | Write | Revokes session via `session_id` + `user_id`. |
| `authGuard.js`: 49 | Read | Validates session in `corex_sessions` via `session_id` + `user_id`. |

### `engine/core/runtime/RuntimeRegistry.js`
| Site | Action | Scope/Assumptions |
|:-----|:-------|:------------------|
| Line 12: `runtimeId` key | Read/Write | Constructed as `userId::strategyName::SYMBOL::MODE`. |
| Line 44: `set(runtimeId, entry)` | Write | Maps `runtimeId` to entry containing `userId`, `mode`, `broker`, `instance`. |

---

## 2. RuntimeRegistry Identity
The `RuntimeRegistry` uses a composite `runtimeId` (`userId::strategyName::SYMBOL::MODE`) to identify active workspaces.

- **Broker Identity:** Within an entry, the `broker` object is tied to `userId` and `mode`.
- **Ambiguity:** `RuntimeRegistry` does not know about "Account IDs". It derives `mode` from the runtime context. If a user has multiple accounts for the *same* `mode` (e.g., two different Live accounts), the current `RuntimeRegistry` structure will have no way to distinguish between them without a change to the `runtimeId` schema to include `accountId`.

---

## 3. Connection vs Account Conflation
- **Credentials:** `connectorSettingsService.js` stores credentials directly tied to `userId` and `connectorType` (e.g., `metaapi` token).
- **Socket_X Conflation:** The `corex-gateway` (outside this analysis scope, but relevant) uses `AccountId` (`cx_pap_...`) to resolve mode server-side.
- **Current State:** Credentials are global per user per connector type. If a user needs to connect two different MT5 accounts via `mt5_bridge`, they cannot currently do this because the settings service upserts by `(userId, connectorType)`.

---

## 4. Places the single-account assumption is hardcoded

- [ ] **`engine/services/brokerPersistence.js`**: `persistBrokerSettings` assumes `userId` and `mode` (PAPER/LIVE) are unique identifiers for settings.
- [ ] **`engine/services/connectorSettingsService.js`**: `upsert` queries `ON CONFLICT (user_id, connector_type)` — fundamentally prevents multiple accounts of the same connector type per user.
- [ ] **`engine/core/runtime/RuntimeRegistry.js`**: `runtimeId` is `userId::strategyName::SYMBOL::MODE`. There is no `accountId` slot, implicitly assuming only one broker/account active for that combination per user.
- [ ] **`engine/core/pipeline/SignalProcessingEngine.js`**: Relies on `RuntimeRegistry` entry's `broker` instance, which is derived from the current session/runtime context, not from an explicit `account_id`.
