"use strict";

const accounts = require("corex-accounts");
const pgStore = require("@core/services/pgStore");
const secretsVault = require("@core/services/secretsVault");
const logger = require("@utils/logger");
const { bus } = require("@events/bus");

// Wire the corex-accounts services with the engine's real dependencies
// (pg store, secrets vault, logger, event bus). This is the single
// wiring spot for the accounts package — the package itself carries no
// @core / @utils / @events requires.
const wired = accounts.createAccounts({
    db: pgStore,
    secretsVault,
    logger,
    bus,
});

const connectionsService = wired.connectionsService;
const CONNECTOR_SCHEMAS = wired.CONNECTOR_SCHEMAS;

// Shim class to maintain backward compatibility with original ConnectorSettingsService.
// All functions take accountId directly — no userId-based resolution or fallback logic.
class Shim {
    constructor() {
        this.CONNECTOR_SCHEMAS = CONNECTOR_SCHEMAS;
    }

    async getConnectorConfig(accountId, connectorType) {
        return await connectionsService.getConnection(accountId, connectorType);
    }

    async saveConnectorConfig(accountId, connectorType, config, secrets) {
        return await connectionsService.saveConnection(accountId, connectorType, secrets);
    }

    async getPublicConfig(accountId, connectorType) {
        const raw = await connectionsService.getConnection(accountId, connectorType);
        const schema = CONNECTOR_SCHEMAS[connectorType];
        if (!schema) {
            return { hasSecrets: false, maskedKeys: {}, config: {} };
        }
        const secretFields = Array.isArray(schema.secrets) ? schema.secrets : [];
        if (!raw || !raw.secrets || Object.keys(raw.secrets).length === 0) {
            return { hasSecrets: false, maskedKeys: {}, config: {} };
        }
        const maskedKeys = secretsVault.maskSecrets(raw.secrets, secretFields);
        const configFields = schema.config && typeof schema.config === "object" ? Object.keys(schema.config) : [];
        const publicConfig = {};
        for (const f of configFields) {
            if (Object.prototype.hasOwnProperty.call(raw, "config") && raw.config && Object.prototype.hasOwnProperty.call(raw.config, f)) {
                publicConfig[f] = raw.config[f];
            }
        }
        return {
            hasSecrets: true,
            maskedKeys,
            config: publicConfig
        };
    }

    listForUser() { return Object.keys(CONNECTOR_SCHEMAS).map(type => ({ connectorType: type, schema: CONNECTOR_SCHEMAS[type] })); }
    getSchema(connectorType) { return CONNECTOR_SCHEMAS[connectorType] || null; }
    getAllSchemas() { return { ...CONNECTOR_SCHEMAS }; }
}

module.exports = new Shim();
module.exports.CONNECTOR_SCHEMAS = CONNECTOR_SCHEMAS;
