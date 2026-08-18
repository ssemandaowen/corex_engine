"use strict";

const db = require("@core/services/postgres");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("JOB:backtestRun");

module.exports = {
    type: "backtest.run",

    async run(job, ctx) {
        const backtestManager = require("@core/backtestManager");

        const payload = job?.payload || {};
        const userId = job.userId || payload.userId;
        const strategyId = payload.strategyId;

        if (!userId || !strategyId) {
            throw new Error("MISSING_REQUIRED_FIELDS: userId and strategyId are required.");
        }

        try {
            await ctx.emitProgress({ stage: "LOADING", message: `Loading strategy ${strategyId}...`, pct: 5 });

            const { rows } = await db.query(
                "SELECT script_body, runtime_params FROM strategies WHERE name = $1 LIMIT 1",
                [strategyId]
            );
            const record = rows[0];

            if (!record || !record.script_body) {
                throw new Error(`STRATEGY_NOT_FOUND: ${strategyId}`);
            }

            await ctx.emitProgress({ stage: "COMPILING", message: "Compiling source code...", pct: 15 });
            const loaderFacade = require("@core/core/loader/StrategyLoader");
            const instance = await loaderFacade.instantiateFromSource(record.script_body, strategyId);
            
            if (!instance) {
                throw new Error(`COMPILE_FAILED: unable to instantiate ${strategyId}`);
            }

            const params = payload.params || record.runtime_params || {};
            if (typeof instance.updateParams === "function") {
                instance.updateParams(params);
            };

            const options = {
                ...(payload.options || {}),
                userId,
                onProgress: (evt) => ctx.emitProgress(evt).catch(() => {}),
                shouldAbort: () => ctx.isAbortRequested()
            };

            const report = await backtestManager.run(instance, options);

            return {
                report: {
                    meta: report.meta,
                    performance: report.performance
                }
            };

        } catch (err) {
            if (err.code === "JOB_CANCELLED" || err.message === "JOB_CANCELLED") {
                throw err;
            }
            log.error(`Backtest job failed: ${err.message}`, { strategyId, userId });
            await ctx.emitProgress({ stage: "FAILED", message: err.message, pct: 100 }).catch(() => {});
            throw err;
        }
    }
};