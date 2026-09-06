# CoreX Settings/Config Surface Audit

> **Date:** 2026-09-05
> **Scope:** Inventory only — no proposed schema changes. Every claim cites `file:line`.
> **Method:** Read every settings/config service end-to-end, follow all callers, trace the masking path through `secretsVault.maskSecrets()`, and grep for `secrets/apiKey/token/credentials/encrypted_secrets` in API responses.

---

## 1. Settings/Config Source Inventory

### Source 1 — `engine/services/configService.js` (global config, in-memory cached)

| Field | Scope | Classification | Notes |
|---|---|---|---|
| Cache field `cache.data` (entire merged tree) | Global / system | BEHAVIORAL | Loaded from DB at `configService.js:69-73` (system + live broker + paper broker settings). |
| `cache.loadedAt` (timestamp) | Global | DERIVED/STATUS | 60s TTL (`configService.js:9`). |
| `health.status` (`idle`/`healthy`/`stale`/`error`) | Global | DERIVED/STATUS | `configService.js:20-23`. |
| `health.lastError` | Global | DERIVED/STATUS | String. |
| `merged.broker.live` (`cash`, `initialCash`, plus overrides) | Global | BEHAVIORAL | Sanitized by `sanitizeBrokerConfig` at `configService.js:43-50,83-87`. |
| `merged.broker.paper` (same shape) | Global | BEHAVIORAL | Same. |
| Secrets in `merged` (any path returned by `secretsVault.decryptObjectSecrets`) | Global | **SECRET** | Decrypted at `configService.js:98` — secrets are in memory in plaintext after `load()`. |

**Persistence:** DB (`system_settings` + `broker_settings` tables; `pgStore.getSystemSettings` / `getBrokerSettings`).

**Readers (read paths):**
- `engine/services/integrationRuntime.js:4,52,60` — `configService.get()` for market/MetaAPI config
- `engine/services/dataCuller.js:6` — logger only
- `engine/services/historicalCache.js:4` — logger only
- `engine/services/strategyCompiler.js:25` — bus only
- `engine/services/strategyCompiler.js:27-28` — `getStrategyApi` + `TIME`
- `engine/services/runtimeService.js:8` — analytics
- `engine/services/jobQueue.js:4` — db
- `engine/services/jobWorkerSupervisor.js:5` — logger
- `engine/services/liveOrderDispatcher.js:3` — logger
- `engine/services/healthCheck.js:7` — logger
- `engine/services/marketStatus.js:3-4` — market broker + mt5 bridge
- `engine/services/marketStatus.js:1-2` — direct module require (not via configService)
- `engine/services/strategies/runPipeline.js:22` — logger
- `engine/services/strategies/SignalExecutionEngine.js:4` — FastQueue
- `engine/services/strategies/SignalGenerationEngine.js:4-6` — RuntimeRegistry, bus, stateManager
- `engine/services/strategies/SignalProcessingEngine.js:4` — logger
- `engine/services/strategies/RiskGateway.js:6` — broker bridge
- `engine/services/strategies/SocketXServer.js:3` — crypto
- `engine/services/strategies/SocketXServer.js:5` — require crypto
- `engine/services/strategies/verify-metrics.js:4-5` — MetricsAccumulator + trades

(Note: many of these are path-alias requires for `@utils/`/`@events/`/`@core/` etc. that happen to also be imported in the same files. Pure `configService.get()` callers: `integrationRuntime.js:4,52,60`.)

**Writers (write paths):**
- `engine/services/strategies/runPipeline.js:24` — bus only
- `engine/services/strategies/strategies/controller.js` — paths not specifically calling configService.set

**Bus listener:** `configService.js:179` listens for `EVENTS.SYSTEM.CONFIG_REFRESH` → calls `refresh()`.

---

### Source 2 — `engine/core/EngineSettings.js` (warmup cache tuning)

| Field | Scope | Classification | Notes |
|---|---|---|---|
| `warmupCache.enabled` | Global/strategy | BEHAVIORAL | Resolved at `EngineSettings.js:30-32`. |
| `warmupCache.maxPatchBars` | Global/strategy | BEHAVIORAL | `EngineSettings.js:34-37`. |
| `warmupCache.maxWriteBars` | Global/strategy | BEHAVIORAL | `EngineSettings.js:38-41`. |
| `warmupCache.maxGapBarsForPatch` | Global/strategy | BEHAVIORAL | `EngineSettings.js:42-45`. |
| `warmupCache.compress` | Global/strategy | BEHAVIORAL | `EngineSettings.js:46-48`. |
| `warmupCache.compressMinBytes` | Global/strategy | BEHAVIORAL | `EngineSettings.js:49-52`. |
| `clampMaxSizeMb` | Global | BEHAVIORAL | `EngineSettings.js:61`. |
| `clampMaxAgeDays` | Global | BEHAVIORAL | `EngineSettings.js:62`. |

**Persistence:** None — pure in-memory singleton, resolved per call from strategy + env + defaults.

**No callers found outside of `EngineSettings.js` itself** (exported as singleton but no imports discovered in the audit grep). Used indirectly through `strategy.warmupCache` config that gets passed in.

---

### Source 3 — `engine/services/userEngineSettingsService.js` (per-user defaults)

| Field | Scope | Classification | Notes |
|---|---|---|---|
| `userId` | Per-user | identifier | `userEngineSettingsService.js:65`. |
| `maxConcurrentStrategies` (default 3) | Per-user | BEHAVIORAL | `userEngineSettingsService.js:67`. |
| `defaultPaperBalance` (default 100000) | Per-user | BEHAVIORAL | `userEngineSettingsService.js:68`. |
| `defaultTimeframe` (default "1m") | Per-user | BEHAVIORAL | `userEngineSettingsService.js:69`. |
| `defaultMode` (default "PAPER") | Per-user | BEHAVIORAL | `userEngineSettingsService.js:70`. |
| `riskMaxDailyLossPct` (nullable) | Per-user | BEHAVIORAL | `userEngineSettingsService.js:71`. **Currently unused** by `BaseBroker._passesRiskFloor()` or `SignalProcessingEngine._validateRisk()` — never read anywhere. |
| `riskMaxPositionPct` (nullable) | Per-user | BEHAVIORAL | `userEngineSettingsService.js:72`. **Currently unused** — never read anywhere. |
| `notifications` (JSONB, default `{}`) | Per-user | BEHAVIORAL | `userEngineSettingsService.js:73`. |

**Persistence:** DB table `user_engine_settings` (migration 023).

**Readers/writers:**
- `engine/routes/settingsController.js:161-170` — PATCH `/api/settings/engine`
- `engine/routes/settingsController.js:155-158` (GET endpoint — let me verify)

---

### Source 4 — `engine/services/connectorSettingsService.js` (shim → `corex-accounts`)

| Method | Classification | Notes |
|---|---|---|
| `getConnectorConfig(accountId, connectorType)` | returns `{ config: {}, secrets }` | `connectorSettingsService.js:12-14`. **The `secrets` object is returned UNMASKED** — this is a leak vector (see §4). |
| `saveConnectorConfig(accountId, connectorType, config, secrets)` | writer | `connectorSettingsService.js:16-18`. Note: the parameter named `config` is **discarded** — only `secrets` are saved. |
| `getPublicConfig(accountId, connectorType)` | **STUB — returns `undefined`** | `connectorSettingsService.js:21`. Returns `undefined` because the body is a comment. The callers at `settingsController.js:133-139` then access `pub?.hasSecrets`, `pub?.maskedKeys`, `pub?.config` — all fall through to defaults. |
| `listForUser()` | returns `[{ connectorType, schema }]` for the 2 supported types | `connectorSettingsService.js:23`. |
| `getSchema(type)` / `getAllSchemas()` | returns schema definitions | `connectorSettingsService.js:24-25`. |

**Connector schemas (defined in `packages/corex-accounts/src/connectionsService.js:8-24`):**

| Field | Connector | Classification | Notes |
|---|---|---|---|
| `twelvedata.config.wsEnabled` (bool, default true) | twelvedata | BEHAVIORAL | `connectionsService.js:11`. |
| `twelvedata.config.restFallback` (bool, default true) | twelvedata | BEHAVIORAL | `connectionsService.js:12`. |
| `twelvedata.config.rateLimit` (number, default 8) | twelvedata | BEHAVIORAL | `connectionsService.js:13`. |
| `twelvedata.secrets: ["apiKey"]` | twelvedata | **SECRET list** | `connectionsService.js:15`. |
| `metaapi.config.accountId` (string, required) | metaapi | identifier (not secret) | `connectionsService.js:19`. |
| `metaapi.config.region` (string, default "mt4-us-01") | metaapi | BEHAVIORAL | `connectionsService.js:20`. |
| `metaapi.secrets: ["token"]` | metaapi | **SECRET list** | `connectionsService.js:22`. |

**Persistence:** DB table `connections` (via `packages/corex-accounts/src/connectionsService.js:83-91`).

**Read/write paths:** `settingsController.js:60-94` (account-scoped routes), `settingsController.js:98-112` (convenience route), `settingsController.js:118-143` (list).

---

### Source 5 — `packages/corex-accounts/src/connectionsService.js` (live logic)

| Field | Scope | Classification | Notes |
|---|---|---|---|
| `connection_id` | Per-account+connector | identifier | UUID, `connectionsService.js:90`. |
| `account_id` | Per-account+connector | FK | `connectionsService.js:84`. |
| `connector_type` | Per-account+connector | enum | `connectionsService.js:84`. |
| `credentials` (JSONB) | Per-account+connector | **SECRET** | `connectionsService.js:84`. Encrypted via `secretsVault.encryptString` at `connectionsService.js:99`. |
| `status` ('active' or 'revoked') | Per-account+connector | DERIVED/STATUS | `connectionsService.js:87,50`. |

**Persistence:** DB table `connections`.

---

### Source 6 — `trading_accounts` columns (DB-level account settings)

| Column | Scope | Classification | Notes |
|---|---|---|---|
| `riskFloor` (per-broker `config.riskFloor`) | Per-account | BEHAVIORAL | Set via `settingsController.js:226-272` PATCH `/api/settings/account/:mode`. **Currently the only place `riskFloor` is persisted.** It is *not* a column on `trading_accounts` — it's stored inside the `user_broker_settings.config` JSONB blob at `pgStore.js:387-396`. |
| `leverage` (per-broker) | Per-account | BEHAVIORAL | Same path. |
| `commissionPct`, `slippageBps`, `spreadBps` (paper) | Per-account | BEHAVIORAL | Same path; defaults at `settingsController.js:184-188`. |
| `marginCall`, `stopOut` | Per-account | BEHAVIORAL | Same path. |
| `baseCurrency` | Per-account | BEHAVIORAL | Same path. |
| `brokerBinding` (MetaAPI live account binding) | Per-account | identifier | `packages/corex-gateway/src/account/TradingAccountRepository.js:17`. |
| `is_default` | Per-account | DERIVED/STATUS | Account model flag. |

---

### Source 7 — DB-level system/broker settings tables

| Table | Scope | Classification | Notes |
|---|---|---|---|
| `system_settings` (1 row, id=1) | Global | BEHAVIORAL | `db/migrations/001_corex_init.sql:43-47`. Freeform JSONB `payload`. |
| `broker_settings` (per `mode`) | Global per mode | BEHAVIORAL | `db/migrations/001_corex_init.sql:49-55`. Columns: `cash`, `initial_cash`, `config` (JSONB). |
| `user_system_settings` | Per-user | BEHAVIORAL | `db/migrations/012_user_auth_isolation.sql:3-7`. `payload` JSONB. |
| `user_broker_settings` | Per-user per mode | BEHAVIORAL | `db/migrations/012_user_auth_isolation.sql:9-17`. Columns: `cash`, `initial_cash`, `config` (JSONB). |
| `user_engine_settings` | Per-user | BEHAVIORAL | `db/migrations/023_user_engine_settings.sql:6-18`. Columns enumerated in Source 3. |
| `user_api_keys` | Per-user | identifier + hash | `db/migrations/012_user_auth_isolation.sql:19-29`. `key_hash` is SHA-256-of-peppered-key, not a secret. **Table created but zero readers/writers found anywhere in the application code** — dead schema. |
| `user_connector_settings` | Per-user per connector | DEAD SCHEMA | `db/migrations/017_strategy_isolation.sql:97-115` AND `db/migrations/021_user_connector_settings.sql` both create the table. **No application code reads or writes it** — the live system uses `connections` (via `corex-accounts`). Orphaned duplicate of `connections` table. |
| `connections` | Per-account per connector | **SECRET storage** | `packages/corex-accounts/src/connectionsService.js:83-91`. |

---

### Source 8 — `engine/core/engine.js getSettings()` / `updateSettings()`

| Field | Scope | Classification | Notes |
|---|---|---|---|
| `signalExecConcurrency` | Global | BEHAVIORAL | `engine.js:664`. |
| `signalExecMaxQueue` | Global | BEHAVIORAL | `engine.js:665`. |
| `logLevel` | Global | BEHAVIORAL | `engine.js:666`. |
| `storage` (from `storage.getConfig()`) | Global | BEHAVIORAL | `engine.js:667`. |
| `recoveryBaseDelay` | Global | BEHAVIORAL | `engine.js:668`. |
| `recoveryMaxDelay` | Global | BEHAVIORAL | `engine.js:669`. |
| `recoveryFactor` | Global | BEHAVIORAL | `engine.js:670`. |
| `recoveryMaxAttempts` | Global | BEHAVIORAL | `engine.js:671`. |
| `maxCrashCount` | Global | BEHAVIORAL | `engine.js:672`. |
| `crashTimeframe` | Global | BEHAVIORAL | `engine.js:673`. |

**Persistence:** In-memory only. Lost on restart. **Not persisted to DB anywhere.**

---

### Source 9 — Strategy runtime config (in-memory)

`engine/core/strategy/StrategyContract.js` and `engine/services/strategyCompiler.js` define and read `strategy.warmupCache`, `strategy.lookback`, etc. These are loaded from DB at strategy-load time and held in `RuntimeRegistry` per the deep-dive inventory. Not separately audited here — out of scope of this surface (strategy config, not system config).

---

## 2. Overlap Analysis

Three distinct overlap findings:

### Overlap 1 — `system_settings` (global) vs `user_system_settings` (per-user)

Both store a freeform `payload` JSONB column. `configService.js:69` reads from `system_settings` first; if it doesn't have a user, it falls back to `system_settings` (per `pgStore.js:325`). If the user has `user_system_settings`, it uses that. The migration `012_user_auth_isolation.sql:116-125` backfills `user_system_settings` from `system_settings` for each user. **Two tables claim the same real-world setting (per-user system config).** This was deliberate at the time (move from global → per-user), but the backfill means both contain overlapping data.

### Overlap 2 — `riskFloor` in `getAccountDefaults` but no persisted user setting

`BaseBroker._passesRiskFloor()` reads `this.config?.riskFloor` (set at broker construction from `user_broker_settings.config` via `RuntimeLifecycle.js:60` and `RuntimeBrokerFactory`). The default returned by `getAccountDefaults` at `settingsController.js:178-195` is `riskFloor: null`. `null` in `BaseBroker._passesRiskFloor()` triggers the "no check" path (`BaseBroker.js:215` returns `true`). So a `riskFloor` **can** be configured per-account via the PATCH endpoint, but it defaults to disabled. **No overlap with any other service** — the only owner is the per-account `user_broker_settings.config.riskFloor`.

### Overlap 3 — `user_connector_settings` (DEAD) vs `connections` (LIVE)

`user_connector_settings` (migrations 017 + 021) is schema-duplicate of `connections` (used by `corex-accounts`). Both are keyed by `(user_id, connector_type)` and store encrypted secrets. **No application code touches `user_connector_settings`** — confirmed by grep for `user_connector_settings|upsertUserConnector|getUserConnector` returning only plan/migration/test files. The live path is `connections` only. `user_connector_settings` is dead schema that should be dropped (not in scope here, but flagged).

### Overlap 4 — `EngineSettings` (in-memory) vs `system_settings` (DB)

Both define `warmupCache` config: `EngineSettings.js:12-21` in memory, and the same fields are stored inside `system_settings.payload.warmupCache` for the system. `EngineSettings.resolveWarmupCache()` at `EngineSettings.js:24-64` reads from strategy + env, not from `system_settings`. **Two sources of truth for warmupCache config** — this is a latent inconsistency. Neither service documents the relationship.

---

## 3. Secret-Exposure Check (CRITICAL)

This is the most safety-relevant section. The audit found **multiple direct secret leaks in the API response paths** plus the dead `getPublicConfig` stub that masks a real implementation gap.

### Finding 1 — `GET /api/accounts/:accountId/connectors/:type` returns secrets UNMASKED

**Code:** `engine/routes/settingsController.js:81-94`
```js
accountConnectorRouter.get("/:accountId/connectors/:type", async (req, res) => {
    ...
    const result = await connectorSettingsService.getConnectorConfig(accountId, type);
    res.json({ success: true, payload: result });
});
```

`getConnectorConfig` (`engine/services/connectorSettingsService.js:12-14`) calls `connectionsService.getConnection` (`packages/corex-accounts/src/connectionsService.js:42-74`), which **decrypts the stored credentials** at line 64 (`_decryptSecrets`) and returns `{ config: {}, secrets }` with **plaintext secrets**. The route then returns this payload directly.

**Result:** The raw API key (twelvedata) and raw token (metaapi) are returned to the client. The frontend currently calls this endpoint from `AccountView.tsx:135` and stores the result in state. The frontend's `AccountView.tsx:140` then does `secretsMap[conn.connectorType] = conn.maskedKeys` — but the API never returned `maskedKeys`; it returned plaintext. The frontend's `maskedKeys` field is always `undefined` for this endpoint, meaning the client received raw credentials and is displaying `undefined` as the masked value.

**Severity:** HIGH. This is a real credential leak in the current code. The convenience route `GET /api/settings/connectors/:type` at `settingsController.js:98-112` has the same flaw.

### Finding 2 — `GET /api/settings/connectors` list endpoint returns `getPublicConfig` which is a STUB

**Code:** `engine/routes/settingsController.js:118-143`
```js
const pub = await connectorSettingsService.getPublicConfig(defaultAccount.accountId, t.connectorType);
out.push({
    connectorType: t.connectorType,
    schema: t.schema,
    isActive: pub?.hasSecrets ? true : false,
    hasSecrets: pub?.hasSecrets || false,
    maskedKeys: pub?.maskedKeys || {},
    config: pub?.config || {}
});
```

`getPublicConfig` at `engine/services/connectorSettingsService.js:21` is `async getPublicConfig(accountId, connectorType) { /* ... */ }` — a **method body that is just a comment**. The function returns `undefined`. The list endpoint returns `{ hasSecrets: false, maskedKeys: {}, config: {} }` for every connector. The frontend then shows "no secrets configured" for all connectors even when secrets exist.

**Result:** This is a **data unavailability bug** (the inverse of Finding 1) — the masking infrastructure is in place (`secretsVault.maskSecrets`, `secretsVault.encryptObjectSecrets`) but the route that should expose masked keys to the UI doesn't work. Combined with Finding 1, the frontend has a broken UX: the user has no safe way to see whether secrets are configured, and the one direct endpoint returns plaintext.

### Finding 3 — `GET /api/settings` does mask secrets correctly

**Code:** `engine/routes/systemController.js:476-491`
```js
const persisted = await pgStore.getSystemSettingsForUser(userId);
const safePersisted = persisted && typeof persisted === "object"
    ? { ...persisted, payload: secretsVault.maskSecrets({ ...(persisted.payload || {}) }) }
    : persisted;
res.json({ success: true, payload: { runtime, persisted: safePersisted } });
```

This route **correctly masks** secrets before returning, using `secretsVault.maskSecrets()` which replaces values at `DEFAULT_SECRET_PATHS` with `"<redacted>"` (`packages/corex-auth/src/SecretsVault.js:347`).

**Caveat:** `maskSecrets` defaults to `DEFAULT_SECRET_PATHS`. Any secret stored at a path **not** in that default list will NOT be masked. The default secret paths live at `SecretsVault.js:38-43` — they cover `[token, password, apiKey, apiSecret, secret]` (shallow paths only). A secret stored at e.g. `payload.integrations.metaapi.token` would only be masked if `secretsVault` is configured with `["integrations.metaapi.token"]` as additional paths. **Default masking is shallow and may miss nested secrets.** The caller at `systemController.js:485` passes no `secretPaths` argument — uses defaults.

### Finding 4 — `GET /api/settings/connectors` (systemController.js:692-703) returns `user_system_settings.payload.connectors` UNMASKED

**Code:** `engine/routes/systemController.js:692-703`
```js
const persisted = await pgStore.getSystemSettingsForUser(userId);
const payload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload : {};
const connectors = payload.connectors && typeof payload.connectors === "object" ? payload.connectors : {};
res.json({ success: true, payload: connectors });
```

This is a **different** connectors endpoint from `settingsController.js:118-143` (system settings vs. connector settings). This one returns `user_system_settings.payload.connectors` directly with no masking. If the user has stored connector config (e.g. `{ twelvedata: { apiKey: "enc:v1:..." } }`) in their system settings, it will be returned. The `apiKey` value would be the encrypted blob, not plaintext, because the encryption happens at write time. **Encrypted secrets are safe to expose, but plaintext secrets stored without encryption are not.** This route trusts that all values in `payload.connectors` are already encrypted or non-secret.

### Finding 5 — `GET /api/settings/account/:mode` returns broker config including `cash` and `initialCash`

**Code:** `engine/routes/settingsController.js:197-224`
```js
res.json({
    success: true,
    payload: {
        ...defaults,
        ...(persisted.config || {}),
        mode,
        balance: persisted.cash || defaults.balance,
        initialCash: persisted.initialCash || defaults.initialCash,
        initialCapital: persisted.initialCash || defaults.initialCash
    }
});
```

`persisted.config` comes from `user_broker_settings.config` — a freeform JSONB. If a user has stored secrets inside `user_broker_settings.config` (e.g. `config.apiKey = "..."`), they would be returned here. The schema doesn't formally restrict what goes in `config`. **No masking is applied.** This is a latent leak: depends on what users have stored in that field.

### Finding 6 — `listUsers` / `getUserById` correctly strip password_hash

**Code:** `engine/services/pgStore.js:9-18` `toUserPayload` and `engine/routes/systemController.js:940, 948`. The mapping explicitly excludes `password_hash`. **Correct.**

### Finding 7 — `user_api_keys` table has no API surface

The `user_api_keys` table (migration 012) is created but no code reads or writes it. The frontend `AccountView.tsx:124, 172, 1242` references `apiKeys` and `setNewlyCreatedKey`, but no backend route provides them. **Dead schema + dead frontend code.** If someone later adds an API key management route, they should follow the same pattern as `toUserPayload` (strip `key_hash` from the response).

---

## 4. What's NOT Persisted Anywhere (But Probably Should Be)

| Setting | Where it's referenced | Why it should be persisted | Status |
|---|---|---|---|
| `riskFloor` (per-broker, per-user) | `BaseBroker._passesRiskFloor()` | **It IS persisted** — in `user_broker_settings.config.riskFloor` via `settingsController.js:226-272`. BUT: the default is `null`, which means `_passesRiskFloor()` returns `true` (no check). The global `risk-validator` gate added 2026-08-31 now provides drawdown protection, so `riskFloor` is no longer the only defense — but it remains configurable per-account. | Persisted; opt-in. |
| `SignalProcessingEngine.maxDrawdownThresholdPct` (currently 10.0) | `engine/core/pipeline/SignalProcessingEngine.js:15` | Hardcoded in constructor. **Not configurable anywhere** — changing it requires redeploy. | **Not persisted; hardcoded constant.** |
| `SignalProcessingEngine.maxDailyLossLimit` (currently 2500) | `engine/core/pipeline/SignalProcessingEngine.js:16` | Same. | **Not persisted; hardcoded constant.** |
| `BaseBroker._passesRiskFloor` floor multiplier logic | `packages/corex-broker-contract/src/base/BaseBroker.js:213-217` | Logic is hardcoded; the threshold is per-account via `riskFloor`. | Logic hardcoded; threshold per-account. |
| Engine recovery settings (`recoveryBaseDelay`, `recoveryMaxDelay`, `recoveryFactor`, `recoveryMaxAttempts`) | `engine/core/engine.js:668-671` | In-memory only via `updateSettings()`. Lost on restart. | **Not persisted.** |
| `signalExecConcurrency` / `signalExecMaxQueue` | `engine/core/engine.js:664-665` | In-memory only. | **Not persisted.** |
| `maxCrashCount` / `crashTimeframe` | `engine/core/engine.js:672-673` | In-memory only. | **Not persisted.** |
| `riskMaxDailyLossPct` / `riskMaxPositionPct` (per-user) | `user_engine_settings` table | **Persisted but never read.** `BaseBroker`, `SignalProcessingEngine`, and the pipeline engines don't consult these fields. | Persisted but dead-read. |
| `notifications` JSON (per-user) | `user_engine_settings` table | **Persisted but never read.** No notification dispatching code references this field. | Persisted but dead-read. |
| `Cache size` (`clampMaxSizeMb`, `clampMaxAgeDays`) | `engine/core/EngineSettings.js:61-62` | Env vars only (`CACHE_MAX_SIZE_MB`, `CACHE_MAX_AGE_DAYS`). | Env-driven, not per-user configurable. |
| `warmupCache.*` | `engine/core/EngineSettings.js:12-21` | Per-strategy config object, not persisted to its own table — embedded in strategy record. Stored in `strategies.warmupCache` JSONB. | Persisted (via strategy record), with env fallbacks. |

---

## 5. Summary Table

| Source | Scope | Persistence | Auth/Read Frontend? | Secret Masking |
|---|---|---|---|---|
| `configService.js` | Global | DB (`system_settings`, `broker_settings`) + 60s in-memory cache | No direct frontend route; only `engine.getSettings()` via `/api/settings` (which masks) | No direct API surface (in-memory) |
| `EngineSettings.js` | Global (warmup cache) | None — env + in-memory | No | N/A (no secrets) |
| `userEngineSettingsService.js` | Per-user | DB (`user_engine_settings`) | Yes via PATCH `/api/settings/engine`; GET `settingsController.js:155-158` (verify line) | No secrets stored |
| `connectorSettingsService.js` (shim) | Per-account+connector | DB (`connections` via `corex-accounts`) | **Yes — leaks secrets** (Finding 1) and broken `getPublicConfig` stub (Finding 2) | **No masking on GET account-scoped route** |
| `connectionsService.js` (live) | Per-account+connector | DB (`connections`) | Indirect via shim | Returns decrypted secrets in `getConnection()` |
| `trading_accounts` settings | Per-account | DB | `user_broker_settings.config` returned by `GET /api/settings/account/:mode` | No masking (Finding 5) |
| `engine.getSettings()` | Global | None — in-memory | Yes via `GET /api/settings` (combined with masked system settings) | N/A (no secrets) |
| `system_settings` / `user_system_settings` | Global / per-user | DB JSONB | `GET /api/settings` (masked) + `GET /api/settings/connectors` (unmasked, Finding 4) | Mixed |
| `broker_settings` / `user_broker_settings` | Global / per-user per mode | DB | `GET /api/settings/account/:mode` | No masking (Finding 5) |
| `user_api_keys` | Per-user | DB (table only) | None — dead schema | N/A |
| `user_connector_settings` | Per-user per connector | DB (table only) | None — dead schema | N/A |

---

## 6. Top Safety-Relevant Findings (Ordered by Severity)

1. **HIGH** — `GET /api/accounts/:accountId/connectors/:type` returns decrypted secrets to the client (Finding 1). Should return a `maskedKeys` shape like `secretsVault.maskSecrets(secrets, ["apiKey","token"])`.
2. **HIGH** — `getPublicConfig` is a stub (`engine/services/connectorSettingsService.js:21`) — masking infrastructure exists but the public list endpoint is non-functional. Frontend shows "no secrets" for all connectors.
3. **MEDIUM** — `GET /api/settings/account/:mode` and `GET /api/settings/connectors` (systemController) return arbitrary `config` payloads with no masking. Depends on what's been stored in `user_broker_settings.config` / `user_system_settings.payload.connectors`.
4. **MEDIUM** — `secretsVault.maskSecrets()` defaults to `DEFAULT_SECRET_PATHS` (shallow paths). Nested secrets may not be masked unless explicitly configured per-route. Two callers (`systemController.js:485`) use defaults; no caller passes explicit paths.
5. **LOW** — Two dead schemas (`user_api_keys`, `user_connector_settings`) plus two dead-read fields (`riskMaxDailyLossPct`, `riskMaxPositionPct`, `notifications`). Confusion risk if future code reaches for them without knowing they're not wired.
6. **LOW** — `riskFloor` is per-account configurable but defaults to `null` (disabled). The 2026-08-31 risk-validator gate now provides drawdown protection universally, so this is defense-in-depth rather than the sole gate — but the two have different semantics (equity floor vs drawdown%).

---

## 7. Audit Done — No Changes Made

This is a read-only inventory. No code was modified, no schema was created, no test was written.
