"use strict";

/**
 * Centralised broker persistence service.
 *
 * Factory: createBrokerPersistence({ pgStore, logger, bus }) returns
 * { persistBrokerSettings }. The caller supplies the pg store, the
 * logger, and the event bus, so this module has no @core / @utils /
 * @events requires of its own.
 *
 * - Exposes persistBrokerSettings(userId, mode, payload)
 * - Listens for EVENTS.BROKER.STATE_CHANGED and persists automatically
 */

function createBrokerPersistence({ pgStore, logger, bus }) {
    if (!pgStore) {
        throw new Error("createBrokerPersistence requires a pgStore ({ upsertBrokerSettingsForUser })");
    }
    if (!logger) {
        throw new Error("createBrokerPersistence requires a logger");
    }

    async function persistBrokerSettings(userId, mode, payload = {}) {
        try {
            if (!userId || !mode) {
                throw new Error("Invalid arguments: userId and mode are required");
            }
            return await pgStore.upsertBrokerSettingsForUser(userId, mode, payload);
        } catch (err) {
            logger.error(`[brokerPersistence] persistBrokerSettings failed for user=${userId} mode=${mode} message=${err.message}`);
            throw err;
        }
    }

    // Event-driven persistence hook. Brokers (or other producers) can emit
    // EVENTS.BROKER.STATE_CHANGED with payload: { userId, mode, payload }.
    // The bus is optional: when omitted, only the direct call is available.
    if (bus && bus.on) {
        try {
            bus.on("broker:state_changed", (evt) => {
                try {
                    const { userId, mode, payload } = evt || {};
                    if (!userId || !mode) return;
                    // Persist asynchronously and log failures (do not throw inside the bus handler)
                    persistBrokerSettings(userId, mode, payload).catch((err) => {
                        logger.error(`[brokerPersistence] EVENT persist failed for user=${userId} mode=${mode} err=${err.message}`);
                    });
                } catch (err) {
                    logger.error(`[brokerPersistence] bus handler unexpected error: ${err.message}`);
                }
            });
        } catch (err) {
            logger.error(`[brokerPersistence] failed to register bus listener: ${err.message}`);
        }
    }

    return { persistBrokerSettings };
}

module.exports = { createBrokerPersistence };
