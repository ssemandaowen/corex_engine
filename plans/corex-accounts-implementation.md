# corex-accounts Implementation Plan

> **Date:** 2026-08-28
> **Package:** `corex-accounts`
> **Scope:** Account identity, credential management (replacing connectorSettingsService.js)
> **Goal:** Fix data loss bug (connections overwriting across accounts), introduce proper account model.

---

## 1. File List

### New Files
- `packages/corex-accounts/`
- `db/migrations/026_accounts_and_connections.sql`

### Re-export shims (in `engine/services/`)
- `engine/services/brokerPersistence.js` (shim)
- `engine/services/connectorSettingsService.js` (shim)

---

## 2. Package Structure

```
packages/corex-accounts/
├── package.json
├── index.js
├── src/
│   ├── accountsService.js
│   └── connectionsService.js
└── test/
    └── accounts.test.js
```

---

## 3. Database Migration (`026_accounts_and_connections.sql`)

```sql
CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,   -- cx_pap_<ulid> / cx_liv_<ulid>
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('paper','live')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  connection_id   TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(account_id),
  connector_type  TEXT NOT NULL,
  credentials     JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, connector_type) -- FIXES DATA LOSS BUG
);
```

---

## 4. API Definition

### `accountsService.js`
- `createAccount(userId, type) -> account_id`
- `getAccountsForUser(userId) -> Account[]`
- `setAccountStatus(accountId, status) -> void`

### `connectionsService.js`
- `saveConnection(accountId, connectorType, credentials) -> void`
- `getConnection(accountId, connectorType) -> { credentials, status }`
- `revokeConnection(connectionId) -> void`
- Encryption logic: Reuse `engine/services/secretsVault.js` via absolute import (or alias). **Must not change AES scheme.**

---

## 5. Re-export Shims (Backward Compatibility)

### `engine/services/brokerPersistence.js`
Replaces the 44-line file.

```javascript
const { persistBrokerSettings } = require("corex-accounts"); // or appropriate shim target
// ... maintain original exported function signature
```

### `engine/services/connectorSettingsService.js`
Replaces the 274-line file.

```javascript
const { connectionsService } = require("corex-accounts");
// ... maintain original exported class instance and CONNECTOR_SCHEMAS
```

---

## 6. Regression Testing (`packages/corex-accounts/test/accounts.test.js`)

1. **Bug Fix Test**: Create Account A, Save 'mt5_bridge' connection. Create Account B, Save 'mt5_bridge' connection. Assert both exist independently in the DB.
2. **Revocation Test**: Save connection, revoke, assert `getConnection` returns `null` (or status 'revoked', depending on API).
3. **API Compatibility Test**: Import re-export shim in `engine/services/connectorSettingsService.js`, call `getConnectorConfig`, verify it delegates correctly to `corex-accounts` (mocked).

---

## 7. Implementation Steps

| Step | Action | Verify |
|------|--------|--------|
| 1 | Create package structure | — |
| 2 | Write `026_accounts_and_connections.sql` | `npm run db:migrate` |
| 3 | Implement `accountsService` and `connectionsService` | Unit tests |
| 4 | Write re-export shims | `npm test` (engine) |
| 5 | Verify bug fix with regression test | Test script passes |
| 6 | Verify zero diff on forbidden files | `git status` |
| 7 | Full suite test | `npm test` (root) |
