"use strict";

const bootloader = require("@core/strategyLoader");

/**
 * Facade for the bootloader with a stable contract for future split-phase loaders.
 * Keeps existing routes/services compatible while exposing explicit pipeline methods.
 */
class StrategyLoaderFacade {
    async init(engine) {
        return bootloader.init(engine);
    }

    async load(record) {
        return bootloader.bootStrategy(record);
    }

    async reload(id) {
        return bootloader.reloadStrategy(id);
    }

    start(id, options = {}) {
        return bootloader.startStrategy(id, options);
    }

    stop(id) {
        return bootloader.stopStrategy(id);
    }

    list() {
        return typeof bootloader.listStrategies === "function" ? bootloader.listStrategies() : [];
    }

    get(id) {
        return bootloader.getStrategy(id);
    }

    getBootStats() {
        return bootloader.getBootStats();
    }
}

module.exports = new StrategyLoaderFacade();

