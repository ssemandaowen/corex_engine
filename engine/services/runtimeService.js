"use strict";

const loader = require("@core/core/loader/StrategyLoader");
const stateManager = require("@utils/stateController");
const eventBus = require("@events/bus");
const { EVENTS } = require("@events/bus");
const logger = require("@utils/logger");
const analytics = require("@utils/analytics");

const log = logger.createModuleLogger("RUNTIME_SERVICE");

class RuntimeService {
    /**
     * Start (or attach to) a strategy runtime.
     * @param {string} strategyId - scoped id "userId::strategyName"
     * @param {object} options - { mode, symbol, userId, params, initialCash, connectorType }
     * @returns {Promise<{ ok: boolean, runtimeId?: string, alreadyRunning?: boolean }>}
     */
    async startStrategy(strategyId, options = {}) {
        log.info(`runtimeService.startStrategy ${strategyId}`);
        const result = await loader.start(strategyId, options);
        if (!result || !result.ok) {
            throw new Error(`Strategy ${strategyId} not found or failed to start: ${result?.reason || "unknown error"}`);
        }
        return result;
    }

    /**
     * Stop a strategy runtime.
     * @param {string} strategyId - scoped id
     * @param {object} [options] - optionally { runtimeId, userId } to target a specific runtime
     */
    async stopStrategy(strategyId, options = {}) {
        log.info(`runtimeService.stopStrategy ${strategyId}`);
        const ok = await loader.stop(strategyId, options);
        return ok;
    }

    /**
     * Restart a strategy: recompile from latest source, then re-start any
     * runtimes that were active before reload.
     */
    async restartStrategy(strategyId, options = {}) {
        log.info(`runtimeService.restartStrategy ${strategyId}`);

        const userId = options.userId || strategyId.split("::")[0] || "system";
        const activeRuntimes = loader.getRuntimes(strategyId, userId);

        const reloaded = await loader.reload(strategyId);
        if (!reloaded) throw new Error(`Strategy ${strategyId} restart failed: reload failed`);

        if (!activeRuntimes.length) {
            return { success: true, message: "Strategy recompiled. No active runtimes to restart." };
        }

        const restarted = [];
        for (const runtime of activeRuntimes) {
            await loader.stop(strategyId, { runtimeId: runtime.runtimeId, userId });
            const result = await loader.start(strategyId, {
                mode: runtime.mode,
                symbol: runtime.symbol,
                userId,
                params: runtime.params,
            });
            if (result?.ok) restarted.push(result.runtimeId);
        }

        return { success: true, restarted, message: "Strategy reloaded and runtimes restarted." };
    }

    /**
     * Patch params on a strategy. If the strategy has active runtimes, the
     * patch is hot-applied to each running instance via the param-update
     * event; otherwise it is just persisted for the next start.
     */
    async patchParams(strategyId, patch) {
        if (!patch || typeof patch !== "object") {
            throw new Error("patch must be an object");
        }
        const meta = loader.getMeta(strategyId);
        if (!meta) throw new Error(`Strategy ${strategyId} not found in registry`);

        const userId = strategyId.split("::")[0] || "system";
        const activeRuntimes = loader.getRuntimes(strategyId, userId);

        await loader.saveParams(strategyId, patch);

        if (activeRuntimes.length) {
            eventBus.bus.emit(EVENTS.SYSTEM.SETTINGS_UPDATED, {
                id: strategyId,
                params: patch,
            });

            eventBus.bus.emit(EVENTS.STRATEGY.PARAMS_UPDATED, {
                strategyId,
                changed: patch,
                ts: Date.now(),
            });

            return { success: true, message: "Parameters hot-swapped and persisted." };
        }

        return { success: true, message: "Parameters saved for next start." };
    }

    /**
     * Reset a strategy's params back to its schema defaults.
     */
    async resetParams(strategyId) {
        const meta = loader.getMeta(strategyId);
        if (!meta) throw new Error(`Strategy ${strategyId} not found in registry`);

        let defaults = {};
        if (meta.schema && typeof meta.schema === "object") {
            defaults = Object.fromEntries(
                Object.entries(meta.schema).map(([key, def]) => [key, def?.default])
            );
        }

        if (!Object.keys(defaults).length && meta.source) {
            try {
                const fresh = await loader.instantiateFromSource(meta.source, strategyId);
                if (fresh && typeof fresh._applyDefaults === "function") {
                    fresh._applyDefaults();
                }
                defaults = fresh?.params || {};
                if (fresh && typeof fresh.destroy === "function") {
                    try { fresh.destroy(); } catch (_) { /* best effort */ }
                }
            } catch (e) {
                log.warn(`[RESET_PARAMS:${strategyId}] fresh instantiate failed: ${e.message}`);
            }
        }

        await this.patchParams(strategyId, defaults || {});

        return { success: true, payload: defaults || {}, message: "Defaults restored and persisted." };
    }

    /**
     * Status for a single strategy (metadata + runtime status of its
     * first active runtime, if any).
     */
    getStatus(strategyId) {
        const meta = loader.getMeta(strategyId);
        if (!meta) return null;

        const status = stateManager.getStatus(strategyId);
        const userId = strategyId.split("::")[0] || "system";
        const runtimes = loader.getRuntimes(strategyId, userId);
        const primary = runtimes[0] || null;
        const instance = primary?.instance || null;

        return {
            id: strategyId,
            status,
            mode: String(primary?.mode || meta.runtimeMode || "PAPER").toUpperCase(),
            params: instance?.params || meta.runtimeParams || {},
            schema: meta.schema || {},
            uptime: primary ? Math.floor((Date.now() - primary.startedAt) / 1000) : 0,
            runtimeId: primary?.runtimeId || null,
            symbols: runtimes.map((r) => r.symbol),
        };
    }

    /**
     * Status for every strategy currently known to the metadata registry
     * (compiled or cached), merged with live runtime info where present.
     */
    getAllStatus() {
        const strategies = loader.listStrategies();
        const out = {};
        for (const meta of strategies) {
            const id = meta.id;
            const status = stateManager.getStatus(id);
            const userId = id.split("::")[0] || "system";
            const runtimes = loader.getRuntimes(id, userId);
            const primary = runtimes[0] || null;
            const instance = primary?.instance || null;

            out[id] = {
                id,
                name: id,
                status,
                mode: String(primary?.mode || meta.runtimeMode || "PAPER").toUpperCase(),
                params: instance?.params || meta.runtimeParams || {},
                schema: meta.schema || {},
                uptime: primary ? Math.floor((Date.now() - primary.startedAt) / 1000) : 0,
                startedAt: primary?.startedAt || null,
                symbols: runtimes.map((r) => r.symbol),
            };
        }
        return out;
    }

    /**
     * Performance metrics for a strategy's primary active runtime.
     * @param {string} strategyId
     * @param {object} [options] - optionally { runtimeId } to target a specific runtime
     */
    getMetrics(strategyId, options = {}) {
        const userId = strategyId.split("::")[0] || "system";
        const instance = loader.getActiveInstance(strategyId, options.runtimeId);
        if (!instance) return null;

        const runtimes = loader.getRuntimes(strategyId, userId);
        const entry = options.runtimeId
            ? runtimes.find((r) => r.runtimeId === options.runtimeId)
            : runtimes[0];

        const broker = entry?.broker;
        if (broker && typeof broker.getPerformanceMetrics === "function") {
            return broker.getPerformanceMetrics();
        }
        return { trades: [], finalEquity: 0 };
    }

    /**
     * Telemetry (status + metrics + position + params/schema) for a
     * strategy's primary active runtime.
     * @param {string} strategyId
     * @param {object} [options] - optionally { runtimeId }
     */
    getTelemetry(strategyId, options = {}) {
        const userId = strategyId.split("::")[0] || "system";
        const instance = loader.getActiveInstance(strategyId, options.runtimeId);
        if (!instance) return null;

        const runtimes = loader.getRuntimes(strategyId, userId);
        const entry = options.runtimeId
            ? runtimes.find((r) => r.runtimeId === options.runtimeId)
            : runtimes[0];

        const broker = entry?.broker;
        const metrics = (broker && typeof broker.getPerformanceMetrics === "function")
            ? broker.getPerformanceMetrics()
            : { trades: [], finalEquity: 0 };

        const position = (broker && typeof broker.getPositionSnapshot === "function")
            ? broker.getPositionSnapshot()
            : { positions: {}, openCount: 0, totalUnrealized: 0 };

        return {
            status: stateManager.getStatus(strategyId),
            runtimeId: entry?.runtimeId || null,
            mode: entry?.mode || null,
            symbol: entry?.symbol || null,
            metrics,
            position,
            uptime: entry ? Math.floor((Date.now() - entry.startedAt) / 1000) : 0,
            params: instance.params || {},
            schema: instance.schema || {},
        };
    }
}

module.exports = new RuntimeService();