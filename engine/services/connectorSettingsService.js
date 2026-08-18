"use strict";

const db = require("@core/services/postgres");
const secretsVault = require("@core/services/secretsVault");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("CONNECTOR_SETTINGS");

const CONNECTOR_SCHEMAS = {
    twelvedata: {
        config: {
            wsEnabled: { type: "boolean", default: true },
            restFallback: { type: "boolean", default: true },
            rateLimit: { type: "number", default: 8 }
        },
        secrets: ["apiKey"]
    },
    metaapi: {
        config: {
            accountId: { type: "string", required: true },
            region: { type: "string", default: "mt4-us-01" }
        },
        secrets: ["token"]
    },
    mt5_bridge: {
        config: {
            host: { type: "string", default: "localhost" },
            port: { type: "number", default: 5599 },
            heartbeatMs: { type: "number", default: 5000 },
            autoReconnect: { type: "boolean", default: true }
        },
        secrets: ["bridgeToken", "httpToken"]
    },
    oanda: {
        config: {
            environment: { type: "string", enum: ["practice", "live"], default: "practice" },
            accountId: { type: "string", required: true }
        },
        secrets: ["apiKey"]
    }
};

class ConnectorSettingsService {
    async getConnectorConfig(userId, connectorType) {
        if (!userId || !connectorType) {
            throw new Error("userId and connectorType are required");
        }

        const { rows } = await db.query(
            `SELECT config_json, encrypted_secrets
             FROM user_connector_settings
             WHERE user_id = $1 AND connector_type = $2
             LIMIT 1`,
            [userId, connectorType]
        );

        if (!rows?.[0]) {
            return null;
        }

        const row = rows[0];
        let secrets = {};
        try {
            secrets = row.encrypted_secrets && typeof row.encrypted_secrets === "object"
                ? this._decryptSecrets(row.encrypted_secrets)
                : {};
        } catch (err) {
            log.warn(`Failed to decrypt secrets for ${userId}/${connectorType}: ${err.message}`);
        }

        return {
            config: row.config_json && typeof row.config_json === "object" ? row.config_json : {},
            secrets
        };
    }

    async saveConnectorConfig(userId, connectorType, config, secrets = {}) {
        if (!userId || !connectorType) {
            throw new Error("userId and connectorType are required");
        }

        const schema = CONNECTOR_SCHEMAS[connectorType];
        if (!schema) {
            throw new Error(`Unknown connector type: ${connectorType}`);
        }

        const validatedConfig = this._validateConfig(config, schema.config);

        let encryptedSecrets = null;
        if (secrets && typeof secrets === "object" && Object.keys(secrets).length > 0) {
            encryptedSecrets = this._encryptSecrets(secrets);
        }

        const result = await db.query(
            `INSERT INTO user_connector_settings (user_id, connector_type, config_json, encrypted_secrets, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id, connector_type) DO UPDATE
             SET config_json = EXCLUDED.config_json,
                 encrypted_secrets = EXCLUDED.encrypted_secrets,
                 updated_at = NOW()
             RETURNING id, is_active, created_at, updated_at`,
            [userId, connectorType, validatedConfig, encryptedSecrets]
        );

        return result.rows?.[0] || null;
    }

    async getPublicConfig(userId, connectorType) {
        if (!userId || !connectorType) {
            throw new Error("userId and connectorType are required");
        }

        const { rows } = await db.query(
            `SELECT config_json, encrypted_secrets
             FROM user_connector_settings
             WHERE user_id = $1 AND connector_type = $2
             LIMIT 1`,
            [userId, connectorType]
        );

        if (!rows?.[0]) {
            return null;
        }

        const row = rows[0];
        const hasSecrets = !!(row.encrypted_secrets && Object.keys(row.encrypted_secrets).length > 0);
        const maskedKeys = this._maskSecrets(row.encrypted_secrets);

        return {
            config: row.config_json && typeof row.config_json === "object" ? row.config_json : {},
            hasSecrets,
            maskedKeys
        };
    }

    async testConnector(userId, connectorType) {
        const fullConfig = await this.getConnectorConfig(userId, connectorType);
        if (!fullConfig) {
            return { ok: false, message: "CONNECTOR_NOT_CONFIGURED" };
        }

        const schema = CONNECTOR_SCHEMAS[connectorType];
        if (!schema) {
            return { ok: false, message: "UNKNOWN_CONNECTOR_TYPE" };
        }

        try {
            const ConnectorClass = this._resolveConnectorClass(connectorType);
            if (!ConnectorClass) {
                return { ok: false, message: "CONNECTOR_CLASS_NOT_FOUND" };
            }

            const instance = new ConnectorClass({
                ...fullConfig.config,
                secrets: fullConfig.secrets,
                userId,
                mode: "PAPER"
            });

            if (typeof instance.testConnection === "function") {
                const start = Date.now();
                const result = await instance.testConnection();
                const latencyMs = Date.now() - start;
                return {
                    ok: result === true || result === "ok",
                    message: typeof result === "string" ? result : (result === true ? "Connection successful" : "Connection failed"),
                    latencyMs
                };
            }

            return { ok: true, message: "Connector loaded (no testConnection method)", latencyMs: 0 };
        } catch (err) {
            log.warn(`Connector test failed for ${userId}/${connectorType}: ${err.message}`);
            return { ok: false, message: err.message };
        }
    }

    listForUser(userId) {
        if (!userId) return [];
        const types = Object.keys(CONNECTOR_SCHEMAS);
        return types.map((type) => ({
            connectorType: type,
            schema: CONNECTOR_SCHEMAS[type]
        }));
    }

    getSchema(connectorType) {
        return CONNECTOR_SCHEMAS[connectorType] || null;
    }

    getAllSchemas() {
        return { ...CONNECTOR_SCHEMAS };
    }

    _encryptSecrets(secrets = {}) {
        const out = {};
        for (const [key, value] of Object.entries(secrets)) {
            if (value === undefined || value === null || value === "") continue;
            const strVal = String(value);
            out[key] = secretsVault.encryptString(strVal);
        }
        return out;
    }

    _decryptSecrets(encryptedObj = {}) {
        const out = {};
        for (const [key, value] of Object.entries(encryptedObj)) {
            if (!value || typeof value !== "string") continue;
            if (!secretsVault.isEncryptedString(value)) {
                out[key] = value;
                continue;
            }
            try {
                out[key] = secretsVault.decryptString(value);
            } catch (err) {
                log.warn(`Decryption failed for ${key}: ${err.message}`);
            }
        }
        return out;
    }

    _maskSecrets(encryptedObj = {}) {
        const masked = {};
        for (const key of Object.keys(encryptedObj)) {
            const val = encryptedObj[key];
            if (typeof val === "string" && val.length >= 4) {
                masked[key] = "****" + val.slice(-4);
            } else {
                masked[key] = "****";
            }
        }
        return masked;
    }

    _validateConfig(config = {}, schema = {}) {
        const out = {};
        for (const [key, rule] of Object.entries(schema)) {
            const val = config[key];
            if (rule.required && (val === undefined || val === null || val === "")) {
                throw new Error(`Connector config missing required field: ${key}`);
            }
            if (val !== undefined && val !== null) {
                if (rule.type === "number") {
                    out[key] = Number(val);
                    if (!Number.isFinite(out[key])) throw new Error(`Config field ${key} must be a number`);
                } else if (rule.type === "boolean") {
                    out[key] = Boolean(val);
                } else {
                    out[key] = String(val);
                }
            } else if (rule.default !== undefined) {
                out[key] = rule.default;
            }
        }
        return out;
    }

    _resolveConnectorClass(connectorType) {
        const map = {
            twelvedata: () => require("@broker/twelvedata"),
            metaapi: () => require("@broker/connectors/MetaApiConnector"),
            mt5_bridge: () => require("@broker/connectors/MT5MQL5Connector"),
            oanda: () => require("@broker/connectors/RestConnector")
        };
        const fn = map[connectorType];
        if (!fn) return null;
        try {
            return fn();
        } catch {
            return null;
        }
    }
}

module.exports = new ConnectorSettingsService();
module.exports.CONNECTOR_SCHEMAS = CONNECTOR_SCHEMAS;
