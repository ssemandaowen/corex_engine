const { validate: validateSchema, getExposedSchema, SCHEMA } = require("../services/settingsSchemaRegistry");
const broadcaster = require("../services/broadcaster");
"use strict";

const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const connectorSettingsService = require("@core/services/connectorSettingsService");
const userEngineSettingsService = require("@core/services/userEngineSettingsService");
const historicalCache = require("@core/services/historicalCache");
const { TradingAccountRepository } = require("../../packages/corex-gateway/src/account/TradingAccountRepository");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("SETTINGS_CONTROLLER");

const accountRepository = new TradingAccountRepository();

function sanitizeUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        lastLoginAt: user.last_login_at || userLoginAt || null,
        createdAt: user.created_at || user.createdAt || null,
        updatedAt: user.updated_at || user.updatedAt || null
    };
}

const validateBody = (schema) => (req, res, next) => {
    const errors = [];
    const body = req.body || {};
    for (const [key, rule] of Object.entries(schema)) {
        const val = body[key];
        if (rule.required && (val === undefined || val === null || val === "")) {
            errors.push(`${key} is required`);
        }
        if (val !== undefined && val !== null && rule.type && typeof val !== rule.type) {
            errors.push(`${key} must be of type ${rule.type}`);
        }
    }
    if (errors.length) return res.status(400).json({ success: false, error: "VALIDATION_ERROR", details: errors });
    next();
};

const router = require("express").Router();
const accountConnectorRouter = require("express").Router();

// Health / public
router.get("/health", (req, res) => {
    res.json({
        success: true,
        payload: {
            ok: true,
            uptime: process.uptime ? Math.floor(process.uptime()) : 0,
            version: process.env.COREX_VERSION || "0.1.0"
        }
    });
});

// Account-scoped connector settings (new addressing scheme).
// PUT requires accountId explicitly — no fallback.
accountConnectorRouter.put("/:accountId/connectors/:type", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const accountId = String(req.params.accountId || "");
        if (!accountId) return res.status(400).json({ success: false, error: "ACCOUNT_ID_REQUIRED" });

        const type = String(req.params.type || "").toLowerCase();
        const schema = connectorSettingsService.getSchema(type);
        if (!schema) return res.status(404).json({ success: false, error: "UNKNOWN_CONNECTOR_TYPE" });

        const config = req.body?.config || {};
        const secrets = req.body?.secrets || {};
        await connectorSettingsService.saveConnectorConfig(accountId, type, config, secrets);
        res.json({ success: true, message: "Connector config saved" });
    } catch (err) {
        const status = err.message.includes("missing required field") ? 400 : 500;
        res.status(status).json({ success: false, error: "CONNECTOR_SAVE_FAILED", message: err.message });
    }
});

accountConnectorRouter.get("/:accountId/connectors/:type", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const accountId = String(req.params.accountId || "");
        if (!accountId) return res.status(400).json({ success: false, error: "ACCOUNT_ID_REQUIRED" });

        const type = String(req.params.type || "").toLowerCase();
        const result = await connectorSettingsService.getPublicConfig(accountId, type);
        res.json({ success: true, payload: result });
    } catch (err) {
        res.status(500).json({ success: false, error: "CONNECTOR_READ_FAILED", message: err.message });
    }
});

// Convenience read-only route: GET /api/settings/connectors/:type resolves via default account.
// Requires ?mode=paper|live. No PUT fallback exists — writes must always specify accountId explicitly.
router.get("/connectors/:type", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const type = String(req.params.type || "").toLowerCase();
        const mode = String(req.query.mode || "").toLowerCase();
        if (!mode || !["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "mode query param required (paper|live)" });
        }

        const defaultAccount = await accountRepository.getDefaultForUser(userId, mode);
        if (!defaultAccount) return res.status(404).json({ success: false, error: "NO_DEFAULT_ACCOUNT" });

        const result = await connectorSettingsService.getPublicConfig(defaultAccount.accountId, type);
        res.json({ success: true, payload: result });
    } catch (err) {
        res.status(500).json({ success: false, error: "CONNECTOR_READ_FAILED", message: err.message });
    }
});

router.get("/connectors", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = String(req.query.mode || "").toLowerCase();
        if (!mode || !["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "mode query param required (paper|live)" });
        }

        const defaultAccount = await accountRepository.getDefaultForUser(userId, mode);
        if (!defaultAccount) return res.json({ success: true, payload: [] });

        const types = connectorSettingsService.listForUser();
        const out = [];
        for (const t of types) {
            const pub = await connectorSettingsService.getPublicConfig(defaultAccount.accountId, t.connectorType);
            out.push({
                connectorType: t.connectorType,
                schema: t.schema,
                isActive: pub?.hasSecrets ? true : false,
                hasSecrets: pub?.hasSecrets || false,
                maskedKeys: pub?.maskedKeys || {},
                config: pub?.config || {}
            });
        }
        res.json({ success: true, payload: out });
    } catch (err) {
        res.status(500).json({ success: false, error: "CONNECTORS_READ_FAILED", message: err.message });
    }
});

// Engine settings
router.get("/engine", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const settings = await userEngineSettingsService.get(userId);
        res.json({ success: true, payload: settings });
    } catch (err) {
        res.status(500).json({ success: false, error: "ENGINE_SETTINGS_READ_FAILED", message: err.message });
    }
});

router.patch("/engine", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const patch = req.body?.settings || req.body || {};
        const result = await userEngineSettingsService.update(userId, patch);
        res.json({ success: true, payload: result });
    } catch (err) {
        res.status(500).json({ success: false, error: "ENGINE_SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

// Account settings
// NOTE: this reads/writes user_broker_settings directly (via pgStore), NOT a
// live broker instance — settings persist regardless of whether a strategy is
// currently running in this mode, and get picked up by RuntimeLifecycle.boot()
// the next time a runtime starts in this mode (see engine/core/runtime/RuntimeLifecycle.js).
const getAccountDefaults = (mode) => ({
    mode,
    balance: 100000,
    initialCash: 100000,
    currency: "USD",
    riskFloor: null,
    // Simulation-only fields (Paper); Live ignores these since real fills are real.
    commissionPct: 0,
    slippageBps: mode === "paper" ? 5 : undefined,
    spreadBps: mode === "paper" ? 2 : undefined,
    executionLatency: 0,
    fillPolicy: "instant",
    // Risk guardrails (both modes).
    leverage: 1,
    marginCall: null,
    stopOut: null,
    baseCurrency: "USD"
});

router.get("/account/:mode", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = String(req.params.mode || "paper").toLowerCase();
        if (!["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "INVALID_MODE" });
        }
        const defaults = getAccountDefaults(mode);
        const persisted = await pgStore.getBrokerSettingsForUser(userId, mode);
        if (!persisted) {
            return res.json({ success: true, payload: defaults });
        }
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
    } catch (err) {
        res.status(500).json({ success: false, error: "ACCOUNT_READ_FAILED", message: err.message });
    }
});

router.patch("/account/:mode", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = String(req.params.mode || "paper").toLowerCase();
        if (!["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "INVALID_MODE" });
        }
        const patch = req.body || {};
        const existing = await pgStore.getBrokerSettingsForUser(userId, mode);
        const initialCash = patch.initialCapital ?? patch.initialCash ?? existing?.initialCash ?? getAccountDefaults(mode).initialCash;
        // Everything except cash/initialCash is freeform broker config —
        // merged and read live by PaperBroker/LiveBroker's config getters.
        const { initialCapital, initialCash: _ic, cash, ...configPatch } = patch;
        const nextConfig = { ...(existing?.config || {}), ...configPatch };

        const result = await pgStore.upsertBrokerSettingsForUser(userId, mode, {
            cash: cash ?? existing?.cash ?? initialCash,
            initialCash,
            config: nextConfig
        });
        res.json({
            success: true,
            payload: {
                ...getAccountDefaults(mode),
                ...result.config,
                mode,
                balance: result.cash,
                initialCash: result.initialCash,
                initialCapital: result.initialCash
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "ACCOUNT_UPDATE_FAILED", message: err.message });
    }
});

router.post("/account/:mode/reset", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const mode = String(req.params.mode || "paper").toLowerCase();
        if (!["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "INVALID_MODE" });
        }
        const defaults = getAccountDefaults(mode);
        const result = await pgStore.upsertBrokerSettingsForUser(userId, mode, {
            cash: defaults.initialCash,
            initialCash: defaults.initialCash,
            config: {}
        });
        res.json({
            success: true,
            message: "Account reset to defaults",
            payload: {
                ...defaults,
                mode,
                balance: result.cash,
                initialCash: result.initialCash,
                initialCapital: result.initialCash
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "ACCOUNT_RESET_FAILED", message: err.message });
    }
});



// GET /api/settings/schema
router.get("/schema", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const mode = String(req.query.mode || "").toLowerCase();
        if (!mode || !["paper", "live"].includes(mode)) {
            return res.status(400).json({ success: false, error: "MODE_REQUIRED", message: "mode query param required (paper|live)" });
        }

        const exposedSchema = getExposedSchema();
        const userSys = await pgStore.getSystemSettingsForUser(userId);
        const userEngine = await userEngineSettingsService.get(userId);
        const brokerSettings = await pgStore.getBrokerSettingsForUser(userId, mode);

        const sysPayload = userSys?.payload || {};
        const uiSettings = sysPayload.ui || {};
        const settingsVersion = Number(sysPayload.settingsVersion || 1);

        // F7: Format ETag quoted (e.g. "3") and accept If-None-Match in quoted, unquoted, or W/ forms
        const etagQuoted = `"${settingsVersion}"`;
        res.setHeader("ETag", etagQuoted);

        const clientEtag = String(req.headers["if-none-match"] || "").trim();
        if (clientEtag) {
            const cleanClientEtag = clientEtag.replace(/^W\//i, "").replace(/"/g, "");
            if (cleanClientEtag === String(settingsVersion)) {
                return res.status(304).end();
            }
        }

        const values = {};
        for (const [key, publicMeta] of Object.entries(exposedSchema)) {
            const meta = SCHEMA[key];
            if (!meta) continue;

            if (meta.storage?.table === "user_system_settings") {
                values[key] = uiSettings[key] !== undefined ? uiSettings[key] : meta.default;
            } else if (meta.storage?.table === "user_engine_settings") {
                values[key] = userEngine?.[key] !== undefined ? userEngine[key] : meta.default;
            } else if (meta.storage?.table === "user_broker_settings") {
                if (key === "initialCash") {
                    values[key] = brokerSettings?.initialCash !== undefined ? brokerSettings.initialCash : meta.default;
                } else {
                    const configPath = meta.storage.path ? meta.storage.path.replace("config.", "") : null;
                    const val = configPath ? brokerSettings?.config?.[configPath] : brokerSettings?.[meta.storage.column];
                    values[key] = val !== undefined && val !== null ? val : meta.default;
                }
            } else {
                values[key] = meta.default;
            }
        }

        res.json({
            success: true,
            payload: {
                schema: exposedSchema,
                values,
                settingsVersion
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "SCHEMA_READ_FAILED", message: err.message });
    }
});

// PATCH /api/settings/key
router.patch("/key", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });

        const { key, value, mode } = req.body || {};
        if (!key) return res.status(400).json({ success: false, error: "KEY_REQUIRED" });

        // Validate via schema registry (F2: validates mode if broker setting)
        const validation = validateSchema(key, value, mode);
        if (!validation.ok) {
            const status = validation.error === "MODE_REQUIRED" ? 400 : 400;
            return res.status(status).json({
                success: false,
                error: validation.error === "MODE_REQUIRED" ? "MODE_REQUIRED" : "SETTINGS_VALIDATION_FAILED",
                key,
                bounds: validation.bounds
            });
        }

        const entry = SCHEMA[key];
        const valToSave = validation.value;
        const cleanMode = String(mode || "").toLowerCase();
        let result;

        if (entry.storage.table === "user_system_settings") {
            result = await pgStore.updateUISettingAtomic(userId, key, valToSave);
        } else if (entry.storage.table === "user_engine_settings") {
            result = await pgStore.patchEngineSettingAtomic(userId, key, valToSave);
        } else if (entry.storage.table === "user_broker_settings") {
            if (key === "initialCash") {
                result = await pgStore.patchBrokerInitialCashAtomic(userId, cleanMode, valToSave);
            } else {
                const configPath = entry.storage.path ? entry.storage.path.replace("config.", "") : null;
                result = await pgStore.patchBrokerConfigKeyAtomic(userId, cleanMode, configPath || key, valToSave);
            }
        } else {
            return res.status(400).json({ success: false, error: "CANNOT_EDIT_SETTING" });
        }

        if (!result || !result.version) {
            return res.status(500).json({ success: false, error: "SETTINGS_UPDATE_FAILED" });
        }

        // F5 & WS: Send WS delta ONLY after successful DB commit
        broadcaster.sendSettingsDelta(userId, key, valToSave, result.version);

        res.json({
            success: true,
            payload: {
                key,
                value: valToSave,
                version: result.version
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "SETTINGS_UPDATE_FAILED", message: err.message });
    }
});

module.exports = router;
module.exports.accountConnectorRouter = accountConnectorRouter;
