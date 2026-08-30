"use strict";

const { connectionsService, CONNECTOR_SCHEMAS } = require("corex-accounts");

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

    // Pass-through methods for remaining API
    async getPublicConfig(accountId, connectorType) { /* ... */ }
    async testConnector(accountId, connectorType) { /* ... */ }
    listForUser() { return Object.keys(CONNECTOR_SCHEMAS).map(type => ({ connectorType: type, schema: CONNECTOR_SCHEMAS[type] })); }
    getSchema(connectorType) { return CONNECTOR_SCHEMAS[connectorType] || null; }
    getAllSchemas() { return { ...CONNECTOR_SCHEMAS }; }
}

module.exports = new Shim();
module.exports.CONNECTOR_SCHEMAS = CONNECTOR_SCHEMAS;
