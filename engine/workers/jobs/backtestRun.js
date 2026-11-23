"use strict";

const db = require("@core/services/postgres");
const logger = require("@utils/logger");
const { bindSymbol, rescopeStrategy } = require("@core/core/runtime/SymbolBinder");
const { resolveParams, ParamResolutionError } = require("corex-strategy-engine");
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

            // ── Parameters: defaults < saved runtime_params < request params ──
            // Same resolver as live start, so an identical request produces an
            // identical effective parameter set in both modes.
            const resolution = resolveParams(instance.schema, record.runtime_params, payload.params);
            if (resolution.errors.length) {
                throw new ParamResolutionError(resolution.errors);
            }
            for (const warning of resolution.warnings) {
                log.warn(`Strategy ${strategyId}: ${warning.message}`);
            }
            instance.params = resolution.params;
            if (typeof instance.updateParams === "function") {
                instance.updateParams(resolution.params);
            }

            const options = {
                ...(payload.options || {}),
                userId,
                onProgress: (evt) => ctx.emitProgress(evt).catch(() => {}),
                shouldAbort: () => ctx.isAbortRequested()
            };

            // ── Bind the requested chart symbol to the strategy's universe ────
            // Same contract as live start: the request must be a symbol the
            // strategy declares, unless the caller explicitly allowed running
            // outside it. Binding also re-scopes symbols/dataManager, so default
            // helpers (series(), getLookbackWindow()) read the requested data.
            const allowOutsideUniverse =
                options.allowOutsideUniverse === true || payload.allowOutsideUniverse === true;
            const requestedSymbol = options.symbol;
            const binding = bindSymbol(instance.symbols || [], requestedSymbol, {
                allowOutsideUniverse
            });
            rescopeStrategy(instance, binding, { mode: "BACKTEST" });
            // Data is loaded under the canonical identity; the provider adapter
            // formats it for the upstream source.
            options.symbol = binding.canonical;

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