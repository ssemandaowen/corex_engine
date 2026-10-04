"use strict";

const { ConnectionsService, CONNECTOR_SCHEMAS } = require("./src/connectionsService");
const { createBrokerPersistence } = require("./src/brokerPersistenceService");

/**
 * Factory: wire the corex-accounts services with their real
 * dependencies. The engine calls this once at boot with the
 * pg store, the secrets vault, the logger, and the event bus,
 * so the package itself never requires @core / @utils / @events.
 *
 * @param {object} deps
 * @param {object} deps.db         - pg store ({ upsertBrokerSettingsForUser }) or a pg Pool.
 * @param {object} deps.secretsVault - { encryptString, decryptString, isEncryptedString }.
 * @param {object} deps.logger     - logger with .error/.warn/.info.
 * @param {object} [deps.bus]      - event bus (optional; enables the STATE_CHANGED hook).
 * @returns {{ connectionsService: ConnectionsService, persistBrokerSettings: Function, CONNECTOR_SCHEMAS: object }}
 */
function createAccounts({ db, secretsVault, logger, bus } = {}) {
    if (!db) throw new Error("createAccounts requires db (pg store or Pool)");
    if (!secretsVault) throw new Error("createAccounts requires secretsVault");
    if (!logger) throw new Error("createAccounts requires logger");

    // The broker persistence service needs the pg store's
    // upsertBrokerSettingsForUser; the connections service needs a
    // pg Pool. Accept either shape: a pg Pool (has .query) or a pg
    // store (has .upsertBrokerSettingsForUser and .query).
    const isPool = typeof db.query === "function" && typeof db.upsertBrokerSettingsForUser !== "function";
    const pool = isPool ? db : (db.pool || db);
    const pgStore = isPool ? { upsertBrokerSettingsForUser: (...args) => db.query(...args) } : db;

    const connectionsService = new ConnectionsService({
        pool,
        secretsVault,
        logger,
    });

    const { persistBrokerSettings } = createBrokerPersistence({
        pgStore,
        logger,
        bus,
    });

    return {
        connectionsService,
        persistBrokerSettings,
        CONNECTOR_SCHEMAS,
    };
}

module.exports = {
    createAccounts,
    ConnectionsService,
    createBrokerPersistence,
    CONNECTOR_SCHEMAS,
};
