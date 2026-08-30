"use strict";

const { bus, EVENTS } = require("@events/bus");
const pgStore = require("@core/services/pgStore");
const logger = require("@utils/logger");

/**
 * Centralised broker persistence service.
 * - Exposes persistBrokerSettings(userId, mode, payload)
 * - Listens for EVENTS.BROKER.STATE_CHANGED and persists automatically
 */

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

// Event-driven persistence hook. Brokers (or other producers) can emit EVENTS.BROKER.STATE_CHANGED
// with payload: { userId, mode, payload }
try {
    bus.on(EVENTS.BROKER.STATE_CHANGED, (evt) => {
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

module.exports = { persistBrokerSettings };
