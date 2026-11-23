# P0 — Provider, Credential, Runtime and Running-App Integration Verification

**Status:** READY FOR KILO CODE EXECUTION — verification only; no implementation authorized  
**Owner / approval authority:** Owen Ssemanda  
**Prepared:** 2026-11-22  
**Repository:** `C:\\Users\\SBUM\\Desktop\\corex`  
**Branch baseline:** `main` tracking `origin/main`; checkout has existing uncommitted work that must be preserved  
**Context handoff:** `plans/architecture/PROVIDER_INTEGRATION_VERIFICATION_HANDOFF.md`  
**Related design:** `plans/architecture/BACKTEST_SPEC_SYMBOL_AND_RUNTIME_BINDING_DESIGN.md`  
**Roadmap:** `plans/ROADMAP.md`; do not change the active phase sequence without Owen's approval.

---

## 1. Kilo Code execution prompt

### ROLE

You are the **CoreX Integration Verification Engineer**. You are responsible for verifying the real, current integration behavior of the existing CoreX checkout and already-running services.

You are not the implementation agent for this task. Your deliverable is a reproducible verification report, an evidence-backed provider/configuration inventory, and a bounded defect register. Do not repair application code.

### MISSION

Verify that CoreX's configured data providers and related integrations are discoverable, correctly configured, and behave as their contracts claim. Verify the running application and PostgreSQL-backed worker path without disturbing the user's running services or existing data.

Do not focus exclusively on Twelve Data. First discover every provider, broker connector, bridge, external API and credential source that is actually represented in the current repository, local `.env`, DB-backed settings and account connector configuration. Then determine which are genuinely implemented and safe to test.

The main outcomes are:

1. A dynamic provider / integration / credential-source inventory.
2. Real provider request evidence where credentials and supported capabilities exist.
3. Confirmed provider-specific symbol compatibility, not guessed mappings.
4. Database + worker verification that equivalent `BTC/USD` and `BTCUSD` requests resolve to the same existing runtime identity under the current canonical identity rules.
5. A safe running-app verification record.
6. A prioritized defect/follow-up register with no unapproved code changes.

### HARD BOUNDARIES

- **Do not implement.** No application source edits, fixes, refactors, provider registrations, symbol overrides, new abstractions, migrations or config changes.
- Do not stage, commit, push, merge, rebase, reset, clean, stash or switch branches.
- Do not overwrite or revert existing dirty files. Start with `git status --short --branch` and preserve the complete baseline.
- Do not read secret values into terminal output. Do not echo, print, log, paste, screenshot, export, hash for display, or write secrets into reports.
- You may inspect environment variable names and whether values are present using a secret-safe presence-only check. Never output values or lengths.
- Do not decrypt DB connector secrets for reporting. You may inspect connector type, account association, active status and whether expected secret fields exist, without exposing their contents.
- Do not run any live order placement, trade execution, broker mutation, account reset, deposit, withdrawal or other financial side effect.
- No LIVE execution. Runtime identity tests must use PAPER or an isolated test mode only.
- Do not stop or restart the already-running engine or PostgreSQL. Do not start a duplicate engine on port 3000.
- Do not run migrations, destructive SQL, truncation, table resets or cleanup of user-owned data.
- Do not test a provider by sending credentials to an unrelated endpoint or third-party validation site.
- No invented provider support. If a provider is only a stub, mock, package dependency or unregistered class, report that fact and do not call it a working provider.
- If a check is unsafe, unavailable, rate-limited or ambiguous, mark it BLOCKED / INCONCLUSIVE with evidence and move on.
- Any source defect discovered becomes a separate implementation recommendation requiring Owen's approval. Do not patch it.

### WORKING CHECKOUT AND SERVICE STATE

The prior inspection observed:
- Engine listener: `127.0.0.1:3000` answered with HTTP 404 at `/` (listener only; not health proof).
- PostgreSQL listener: TCP `5432` reachable.
- Frontend `5173`: not listening.
- MCP-managed process list empty; existing processes appear externally managed.

Re-check these observations before acting. A changed state is possible. Do not infer process ownership from the MCP process list alone. Do not stop or restart processes that were not started by you.

### 2. Phase 0 — Baseline and repository safety

1. Record:
   - `git status --short --branch`
   - current branch and HEAD SHA
   - `git diff --stat` and staged-diff summary
   - current managed-process list
   - TCP/HTTP reachability for engine, DB and frontend ports, without exposing credentials.
2. Record every pre-existing dirty/untracked path as **pre-existing user work**. Do not include its full diff unless needed for a specific read-only review.
3. Confirm `.env` is ignored by Git and is not tracked. Do not print the file.
4. Read the handoff and the current authoritative roadmap/task docs.
5. Establish which API routes provide health, provider status, worker status and system connectivity. Probe only read-only endpoints.
6. If a server is already running, use it. Do not start another engine. If the frontend is needed for an end-to-end check, start it only if its port is free, using the existing npm script, and record the process you started. Stop only that task-owned frontend process when finished.

**Gate:** If the repository baseline is changed unexpectedly or the working tree cannot be safely preserved, stop and report before running any stateful check.

### 3. Phase 1 — Dynamic provider and credential discovery

This phase is mandatory and must happen before provider requests.

#### 3.1 Discover provider/integration implementations

Search the whole current repository (excluding dependencies, generated artifacts and secrets) for:
- classes/factories implementing `DataProviderContract`;
- calls to `DataProviderFactory.register`, `setActive`, provider selection and config wiring;
- broker drivers/connectors, bridge providers and external service clients;
- direct HTTP/WebSocket clients that may fetch market data;
- provider-related environment reads and DB settings paths;
- legacy provider wrappers, shims and unused dependencies.

Do not assume the provider list is limited to the names in the handoff. Build the inventory from actual code and runtime registration.

For each discovered integration, classify it as one of:
- active market-data provider;
- implemented but not registered/selected;
- broker/execution connector (not a market-data provider);
- local/file/replay source;
- test/mock/stub only;
- dependency or credential with no application consumer found;
- unknown pending evidence.

Record:
- name and category;
- owning package/module;
- concrete implementation path;
- contract/interface;
- registration and activation path;
- historical-data capability;
- streaming capability;
- broker/execution capability (if relevant);
- supported symbol/timeframe metadata;
- credential source(s);
- configuration precedence and refresh lifecycle;
- whether safe live verification is possible;
- evidence and gaps.

#### 3.2 Dynamically inventory the local environment

Read only the local `.env` variable names. Do not output values.

Use a broad secret-name classifier, not a fixed allow-list. Include keys whose names suggest API keys, tokens, secrets, passwords, credentials, private keys, signing keys, connection strings, auth or provider-specific access. Also inventory non-secret runtime/config keys that affect provider/worker/DB behavior.

For each variable record:
- variable name;
- present / empty / absent;
- likely category;
- code readers and exact paths;
- whether the key is actually consumed;
- whether it is documented in `.env.example` / README;
- whether it is stale, duplicate, conflicting or undocumented.

Never record value, length, prefix, suffix, hash or a copy of the secret.

Known names seen during the prior scan include `TWELVE_DATA_KEY`, `YAHOO_API_KEY`, `OANDA_API_KEY`, `MT5_BRIDGE_TOKEN`, `ADMIN_SECRET`, `JWT_SECRET`, `AUTH_ADMIN_PASSWORD`, `CorexToken`, and PostgreSQL variables. This is only a starting point; discover all current names dynamically.

#### 3.3 Discover DB-backed credentials and runtime config

Inspect the configuration and connector paths:
- `engine/services/configService.js`
- `engine/services/integrationRuntime.js`
- `engine/services/connectorSettingsService.js`
- `packages/corex-accounts/src/connectionsService.js`
- `packages/corex-auth/src/SecretsVault.js`
- relevant settings controllers/routes and migrations.

Using read-only queries, determine:
- which integration/connector types are represented;
- whether active account connector records exist;
- which records have the expected secret fields present (boolean only);
- whether settings are global, account-scoped or user-scoped;
- precedence between process environment, DB settings and account connector secrets;
- whether `integrationRuntime.refresh()` actually applies the current configuration to the active provider/bridge;
- whether an already-running process has refreshed after settings changes.

Do not query or display raw credential JSON. Do not decrypt secrets. Do not mutate settings.

#### 3.4 Classify special cases rather than assuming

At minimum, explicitly investigate:
- Twelve Data REST and WebSocket key sources.
- Yahoo Finance provider and optional key behavior.
- OANDA key: verify whether any current application code consumes it; a package dependency alone is not proof of integration.
- MetaApi: distinguish broker/execution connector from market-data provider; check whether the implementation is real or stubbed.
- MT5 bridge tokens: classify as bridge authentication, not market-data credentials.
- Any other discovered key/provider/integration in `.env`, DB-backed settings or source.

Also inspect any credential-like hardcoded frontend default. Report only file/line and risk description; never reproduce the literal. Determine whether it is a placeholder, demo default or potentially usable credential. Do not use it to authenticate.

**Deliverable:** Provider and credential inventory table, including discovered-but-unused keys and stubs.

### 4. Phase 2 — Running-app and DB health verification

1. Verify the current engine listener using its existing process. Identify a real read-only health endpoint from source; do not treat HTTP 404 at `/` as healthy.
2. Check database connectivity through the application's actual PostgreSQL service/pool and independently with a read-only DB connection if appropriate.
3. Record:
   - engine health response;
   - DB connection success/failure;
   - DB pool status (total/idle/waiting) if safely available;
   - worker supervisor / job-worker status;
   - provider active name, connection state, authorization state, capabilities and last heartbeat;
   - runtime registry state for the target test identity.
4. Inspect worker launch ownership. Do not launch a duplicate worker if one is already running and consuming the same queue.
5. If the worker is not running and the application requires it, determine whether starting a single task-owned worker is safe. Do not start one until confirming no existing worker owns the queue. Do not change queue settings.
6. Do not run schema migrations. Do not print DB URLs, host/user/password values or sensitive account identifiers.

**Deliverable:** A running-app health matrix with timestamp, method, status, and evidence.

### 5. Phase 3 — Real provider verification

Only test implementations that Phase 1 proves exist and that have safe credentials/configuration. Use the existing provider contracts/adapters, not ad hoc code that bypasses CoreX.

#### 5.1 Twelve Data

If the active runtime credential is available:
- verify a real REST historical request using the adapter/factory path;
- verify actual provider response shape, timestamp units, OHLCV validity and symbol identity;
- verify WebSocket connection/authentication;
- subscribe to one liquid, known-supported control instrument;
- confirm a real inbound tick with symbol, timestamp and price;
- confirm unsubscribe and clean connection lifecycle;
- verify that no API key appears in URL logs, exceptions, output or reports;
- classify rate limits, permission limits, unsupported intervals and symbol failures accurately.

Use conservative request volume and avoid a broad symbol scan. Respect provider rate limits and account entitlements.

#### 5.2 Yahoo Finance

If available and safe:
- verify historical chart data through `YahooFinanceProvider`;
- check whether the optional `YAHOO_API_KEY` is actually used by the library/transport or merely stored;
- record returned data quality and symbol mapping;
- mark streaming as **not supported by this provider implementation** unless source changes are independently present and verified.

Do not call this a REST API-key success merely because a chart request works; identify the actual authentication/transport mechanism.

#### 5.3 Other discovered providers

For every additional provider discovered:
- verify only if there is a real implementation, a supported contract and an authorized credential source;
- if it is an execution connector, do a non-trading connectivity/auth check only if the connector supports one;
- if it is a stub, dependency-only or unconsumed key, mark NOT IMPLEMENTED / NOT CONSUMED and do not fabricate a request test;
- do not test MT5 by sending orders or starting a terminal trade session.

#### 5.4 Error and cleanup discipline

For each request record:
- provider and operation;
- canonical symbol;
- provider-formatted symbol;
- timeframe / requested bar count;
- response status or typed error code;
- data count and timestamp range;
- whether returned instrument identity was validated;
- duration and request correlation marker (never the secret);
- cleanup result.

Do not include full response bodies if they may contain account details or tokens.

### 6. Phase 4 — Symbol compatibility verification

This phase must use actual provider responses, not inferred naming rules.

#### 6.1 Test set

Use a small representative matrix:
- ordinary FX control (e.g. EUR/USD);
- ordinary crypto control (e.g. BTC/USD);
- metals: gold and silver;
- indices: select only representative indices supported or discoverable from provider metadata;
- USDT pairs: test only if provider support and account entitlements permit;
- optional equity control if Yahoo is part of the discovered provider set.

Do not assume every instrument is available from every provider. Do not over-query.

#### 6.2 For each symbol, record

| Field | Meaning |
|---|---|
| CoreX input | Original request string, e.g. `BTC/USD` or `BTCUSD` |
| Canonical symbol | Result from current CoreX instrument/symbol resolver |
| Instrument classification | FX / crypto / metal / index / equity / other |
| Provider wire symbol | Exact symbol sent by the adapter |
| Provider response | Accepted / rejected / empty / rate-limited / inconclusive |
| Returned identity | Provider's instrument identity/name/metadata |
| Correctness | Confirmed / rejected / ambiguous |
| Evidence | Sanitized response fields and test reference |

Validate that a successful response is for the intended instrument. A generic HTTP 200 or non-empty array is insufficient.

#### 6.3 Metals, indices and USDT safeguards

- The current Twelve Data override table is intentionally empty because these names are unverified.
- Do not add overrides or edit symbol rules.
- Try documented/provider-discoverable names only; record exact provider evidence.
- If the provider has no symbol-search endpoint accessible under current entitlements, report that limitation and mark unresolved.
- Distinguish unsupported instrument from malformed symbol, permission restriction, market closure and quota/rate limit.
- Do not treat a pass-through USDT symbol as confirmed support.

**Deliverable:** Provider-specific compatibility matrix with confirmed mappings, rejections and unresolved cases.

### 7. Phase 5 — Database / worker runtime identity verification

Target behavior: an existing PAPER runtime identity associated with `BTC/USD` must be reused when the equivalent request is submitted as `BTCUSD`, after canonicalization. The exact complete identity format must be read from current `plans/ROADMAP.md`, `AGENTS.md`, runtime identity builder and existing DB/runtime records; do not invent or hardcode a different identity shape.

The previously stated target included an existing key ending in `::BTC/USD::PAPER`. Treat the **existing DB/runtime value** as authoritative. Preserve any strategy/user identity components.

#### Procedure

1. Inspect current runtime identity builder, `RuntimeRegistry`, loader, job worker, strategy runtime lifecycle and relevant DB schema/queries.
2. Read existing target runtime records in a read-only manner. Determine whether a matching `BTC/USD` PAPER runtime already exists and whether it is active, paused, stale or stopped.
3. Do not stop or mutate a pre-existing runtime merely to make the test convenient. If it is active or conflicts with the test, report BLOCKED and propose an isolated test identity.
4. Use a safe test strategy/account/user that has no external execution connector and cannot place orders. Use PAPER only.
5. Exercise the normal API/request → queue → worker → runtime binding path once with `BTC/USD`.
6. Exercise the equivalent path with `BTCUSD`, preserving all other request fields.
7. Compare:
   - resolved canonical instrument;
   - runtime ID / registry key;
   - persisted runtime state and symbol fields;
   - worker job payload / result;
   - duplicate-instance behavior.
8. Confirm both forms resolve to the same expected identity and do not create duplicate runtimes or conflicting DB rows.
9. If the request path is asynchronous, wait using bounded polling and existing status APIs; do not spin aggressively.
10. Clean up only the disposable test runtime/job/records created by this task, using normal application lifecycle APIs. Preserve any pre-existing runtime or records. Record before/after counts for the affected test-owned records.

If a test-owned DB record cannot be safely removed through normal application APIs, leave it clearly marked as a test artifact and report it. Never issue broad deletes.

#### Acceptance

- Same logical user/strategy/mode and equivalent symbol representations resolve to the same canonical symbol.
- The exact existing runtime identity is reused where the product contract says it should be.
- No duplicate runtime or accidental LIVE execution is created.
- Worker, registry and persisted DB state agree.
- Cleanup is limited to resources created by this test.

### 8. Phase 6 — Provider discoverability and dynamic configuration assessment

The user's requirement is that providers and credentials be **discoverable, flexible and dynamic throughout the system**, not hardcoded around one provider.

This phase is an assessment only. Do not implement changes.

Evaluate:
- whether the registry can enumerate all registered providers and their capabilities;
- whether exported-but-unregistered providers are discoverable to the engine/settings/UI;
- whether active provider selection is genuinely config-driven or hardcoded at package import;
- whether provider-specific credentials are loaded through one coherent config path;
- whether environment keys, DB settings and account-scoped connector secrets have clear precedence;
- whether configuration refresh reaches the actual active provider instance without restart or stale singleton state;
- whether health/status surfaces identify the selected provider and capability set;
- whether symbol metadata is provider-specific and inspectable rather than scattered hardcoded aliases;
- whether adding a new provider requires editing unrelated engine files;
- whether the single-active-provider constraint remains deliberate and correctly represented;
- whether historical-only providers are clearly distinguished from streaming providers;
- whether tests cover provider registration, activation, credential availability, runtime config refresh, provider switch and cleanup.

Report gaps as design/implementation follow-ups. Do not create a generic plugin framework or change architecture.

### 9. Phase 7 — Regression verification

Run focused existing tests relevant to:
- market-data contract and factory;
- Twelve Data adapter and legacy singleton;
- Yahoo provider;
- symbol normalization/instrument rules;
- MarketFeed subscription lifecycle;
- backtest data resolver and pagination;
- runtime symbol binding;
- worker and persistence lifecycle;
- connector settings / SecretsVault / integration runtime.

Then run the full repository test suite if the running services and available time permit. Tests must not reset the user's DB or write to production data.

Record exact commands, test counts, failures, skipped tests, warnings and whether they are pre-existing. Do not alter test snapshots or source to get a green result.

### 10. Required deliverables

Create the following new task-owned documents only. Do not overwrite existing files:

1. `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_RESULTS.md`
   - executive result (PASS / PARTIAL / BLOCKED);
   - baseline and service health;
   - provider / credential / integration inventory;
   - credential presence-only matrix;
   - configuration precedence and refresh findings;
   - real provider request evidence;
   - symbol compatibility matrix;
   - DB / worker runtime identity evidence;
   - tests and commands;
   - failures, limitations and cleanup;
   - prioritized follow-up defects.

2. `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_EVIDENCE.md`
   - sanitized command transcript excerpts;
   - timestamps and correlation IDs;
   - safe response metadata;
   - DB query intent and sanitized result counts;
   - no secret values, connection strings, personal account IDs or raw credential records.

3. Update `plans/KNOWN_ISSUES.md` only if a new defect is confirmed and can be stated precisely. Do not remove or rewrite existing entries.

4. Do not update `plans/ROADMAP.md` unless Owen has approved a roadmap change. A verification report does not automatically create a new active workstream.

### 11. Required final response format

Return a concise summary with:

- **Overall:** PASS / PARTIAL / BLOCKED.
- **Services:** engine, PostgreSQL, worker, frontend status.
- **Providers discovered:** list with classifications.
- **Credentials:** variable/connector names and SET / EMPTY / NOT FOUND only.
- **Real requests:** provider + operation + result.
- **Symbols:** confirmed / rejected / unresolved counts and key examples.
- **Runtime identity:** existing identity reused? yes/no/inconclusive, with sanitized evidence.
- **Tests:** exact suite/test counts.
- **Defects:** severity, evidence, recommended separate task.
- **Artifacts:** exact paths created.
- **Safety:** confirm no source changes, no secrets exposed, no LIVE trades, no migrations, and no pre-existing user work overwritten.
- **Unresolved blockers:** list exactly what needs Owen.

### 12. Acceptance criteria

This task is complete only when:

1. Dynamic provider and credential inventory is grounded in current source and runtime configuration.
2. Every discovered integration is correctly classified; no dependency or credential is misrepresented as a working provider.
3. Every attempted external request has sanitized evidence and a clear outcome.
4. Metals, indices and USDT symbol spellings are classified from actual provider evidence or explicitly marked unresolved.
5. The DB/worker test compares the two symbol forms through the real CoreX path and checks the existing runtime identity without creating a LIVE side effect.
6. Running-app status is checked through actual health/status paths, not merely an open TCP port.
7. Focused tests and, where safe, the full test suite are recorded.
8. Two report artifacts are created, and any confirmed issues are recorded without implementing fixes.
9. No pre-existing working-tree changes are lost or modified by the task.
10. No secret values or user financial actions are exposed or triggered.

---

## 2. Initial facts Kilo must independently re-check

- The package is `packages/corex-market-data`; current source has Twelve Data, Yahoo Finance and File provider implementations.
- Package entrypoint auto-registers Twelve Data as the active provider. Yahoo and File are exported but were not found registered in production code.
- Twelve Data is an adapter around the legacy singleton; it owns REST/WS transport and symbol boundary conversion.
- Yahoo provider is historical-only in its declared capabilities; it is not a streaming substitute.
- File provider supports local historical data and replay.
- OANDA key exists in local `.env`, but no current app code consumer was found; `@oanda/v20` appears unused in prior decision notes.
- MetaApi is a broker/execution connector path and its connector is described as a structural skeleton in README; it is not a confirmed live market-data provider.
- MT5 bridge credentials are for bridge authentication, not market-data API access.
- Twelve Data, MetaApi and MT5 config may be sourced from DB-backed settings, not only `.env`.
- The prior running-app probe found engine port 3000 and DB port 5432 reachable, frontend port 5173 not listening. Re-check.
- The local checkout has substantial pre-existing uncommitted work. Preserve it all.

**Important:** These are starting observations, not substitutes for Kilo's fresh verification. If the current checkout differs, report the difference and follow current code plus the safety rules.
