"use strict";

const db = require("@core/services/postgres");
const pgStore = require("@core/services/pgStore");
const connectorSettingsService = require("@core/services/connectorSettingsService");
const userEngineSettingsService = require("@core/services/userEngineSettingsService");
const historicalCache = require("@core/services/historicalCache");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("SETTINGS_CONTROLLER");

function sanitizeUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        lastLoginAt: user.last_login_at || user.lastLoginAt || null,
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

// Connector settings
router.get("/connectors", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const types = connectorSettingsService.listForUser(userId);
        const out = [];
        for (const t of types) {
            const pub = await connectorSettingsService.getPublicConfig(userId, t.connectorType);
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

router.put("/connectors/:type", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const type = String(req.params.type || "").toLowerCase();
        const schema = connectorSettingsService.getSchema(type);
        if (!schema) return res.status(404).json({ success: false, error: "UNKNOWN_CONNECTOR_TYPE" });

        const config = req.body?.config || {};
        const secrets = req.body?.secrets || {};
        await connectorSettingsService.saveConnectorConfig(userId, type, config, secrets);
        res.json({ success: true, message: "Connector config saved" });
    } catch (err) {
        const status = err.message.includes("missing required field") ? 400 : 500;
        res.status(status).json({ success: false, error: "CONNECTOR_SAVE_FAILED", message: err.message });
    }
});

router.post("/connectors/:type/test", async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        const type = String(req.params.type || "").toLowerCase();
        const result = await connectorSettingsService.testConnector(userId, type);
        res.json({ success: true, payload: result });
    } catch (err) {
        res.status(500).json({ success: false, error: "CONNECTOR_TEST_FAILED", message: err.message });
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

module.exports = router;