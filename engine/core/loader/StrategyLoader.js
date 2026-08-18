"use strict";

/**
 * engine/core/loader/StrategyLoader.js
 *
 * Public facade for the strategy bootloader.
 * This is what controllers, runtimeService, and tests should import.
 * Never import engine/strategyLoader.js directly from outside engine/.
 */

const bootloader = require("@core/strategyLoader");

class StrategyLoader {
    /**
     * Initialise: compile all strategies from DB, restore running states.
     * @param {object} engine
     */
    async init(engine) {
        return bootloader.init(engine);
    }

    /**
     * Compile a strategy record to metadata (class + schema). No instance created.
     * @param {object} record - { name, script_body, updated_at, ... }
     */
    async load(record) {
        return bootloader.bootStrategy(record);
    }

    /**
     * Re-compile a strategy from DB after code change.
     * @param {string} id
     */
    async reload(id) {
        return bootloader.reloadStrategy(id);
    }

    /**
     * Instantiate and start a strategy runtime.
     * @param {string} id
     * @param {object} options - { mode, symbol, userId, initialCash, params, connectorType }
     */
    async start(id, options = {}) {
        return bootloader.startStrategy(id, options);
    }

    /**
     * Stop a running strategy and destroy its instance.
     * @param {string} id
     * @param {object} options - optionally { runtimeId }
     */
    async stop(id, options = {}) {
        return bootloader.stopStrategy(id, options);
    }

    /**
     * Get metadata entry for a strategy (schema, metadata, status).
     * Returns null if not compiled. Does NOT return a live instance.
     * @param {string} id
     */
    get(id) {
        return bootloader.getStrategy(id);
    }

    /**
     * Alias of get() — explicit naming for metadata-only lookups.
     */
    getMeta(id) {
        return bootloader.getMeta(id);
    }

    /**
     * Drop a cached metadata entry (e.g. after rename/delete) so a stale
     * compile result under the old id isn't served again.
     * @param {string} id
     */
    invalidate(id) {
        return bootloader.invalidateMeta(id);
    }

    /**
     * Get the live strategy instance for a strategy.
     * If runtimeId is provided, returns that specific runtime's instance.
     * Otherwise returns the first active runtime's instance for the strategy.
     * @param {string} id
     * @param {string} [runtimeId]
     */
    getActiveInstance(id, runtimeId = null) {
        return bootloader.getActiveInstance(id, runtimeId);
    }

    /**
     * All live runtimes for a strategy, optionally scoped to a user.
     * @param {string} id
     * @param {string} [userId]
     */
    getRuntimes(id, userId = null) {
        return bootloader.getRuntimesForStrategy(id, userId);
    }

    /**
     * Persist a params patch to the metadata registry and DB.
     * @param {string} id
     * @param {object} patch
     */
    async saveParams(id, patch) {
        return bootloader.saveParams(id, patch);
    }

    /**
     * Instantiate a fresh strategy instance from raw source code,
     * without registering it. Used to extract schema defaults.
     * @param {string} source
     * @param {string} id
     */
    async instantiateFromSource(source, id) {
        return bootloader.instantiateFromSource(source, id);
    }



    /**
     * List all strategies with their live runtime status.
     */
    listStrategies() {
        return bootloader.listStrategies();
    }

    /**
     * Get symbols tracked across all compiled strategies.
     */
    getActiveSymbols() {
        return bootloader.getActiveSymbols();
    }

    getBootStats() {
        return bootloader.getBootStats();
    }
}

module.exports = new StrategyLoader();