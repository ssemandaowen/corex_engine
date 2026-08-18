"use strict";

const workerPool = require("./workerPool");

/**
 * Service layer for strategy execution.
 * Standardizes the API for the rest of the application.
 */
class StrategyRuntimeService {
  
    isEnabled() {
        return workerPool.isEnabled();
    }

    async start() {
        return workerPool.start();
    }

    async stop() {
        return workerPool.stop();
    }

    /**
   * Required for the future setup: Loading specific strategies.
   */
    async loadStrategy({ strategyId, code, runtimeParams = null } = {}) {
        if (!strategyId || !code) throw new Error("INVALID_LOAD_REQUEST: Missing strategyId or code");
        return workerPool.request("LOAD_STRATEGY", { strategyId, code, runtimeParams });
    }

    async unloadStrategy({ strategyId } = {}) {
        if (!strategyId) throw new Error("INVALID_UNLOAD_REQUEST: Missing strategyId");
        return workerPool.request("UNLOAD_STRATEGY", { strategyId });
    }

    async updateParams({ strategyId, params } = {}) {
        return workerPool.request("UPDATE_PARAMS", { strategyId, params });
    }

    async execTick({ strategyId, tick, context = {} } = {}) {
        return workerPool.request("EXEC_TICK", { strategyId, tick, context });
    }

    async execBar({ strategyId, bar, context = {} } = {}) {
        return workerPool.request("EXEC_BAR", { strategyId, bar, context });
    }

    async warmupBar({ strategyId, bar } = {}) {
        return workerPool.request("WARMUP_BAR", { strategyId, bar });
    }
}

module.exports = new StrategyRuntimeService();