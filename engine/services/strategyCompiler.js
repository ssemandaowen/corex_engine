"use strict";

/**
 * CoreX Strategy Compiler
 *
 * Two distinct operations:
 *
 * 1. validateAndExtractClass(code, id)
 *    Used at BOOT TIME by strategyLoader.
 *    Compiles code → extracts StrategyClass constructor + schema + metadata.
 *    Destroys the temporary instance immediately. Nothing kept in memory.
 *    Returns: { ok, StrategyClass, schema, metadata, error }
 *
 * 2. compile(code, id)   [KEPT for backwards compat / legacy path]
 *    Full 6-phase pipeline that returns a live instance.
 *    Used ONLY at RUN TIME when instantiation is intentional.
 *    Caller is responsible for calling instance.destroy() when done.
 *
 * The security scan (validateStrategyCode) MUST run before either operation.
 * strategyLoader handles this in its Phase 2 (VALIDATION) — the compiler
 * trusts that security scan has already passed when called.
 */

const Module  = require("module");
const { bus, EVENTS } = require("@events/bus");
const logger  = require("@utils/logger");
const { getStrategyApi } = require("@utils/strategy/StrategyIntrospection");
const { TIME } = require("@config/constants");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");

const log = logger.createModuleLogger("STRATEGY_COMPILER", {
    category: "strategy",
    ui:       true,
    uiLevels: ["warn", "error"],
});

const REQUIRED_FIELDS   = ["symbols"];
const METHOD_CANDIDATES = ["next", "onBar", "onTick", "_processData"];

// ─────────────────────────────────────────────────────────────────────────────
// Internal: load a JS module from a string (no filesystem)
// ─────────────────────────────────────────────────────────────────────────────

function _loadModuleFromString(code, id) {
    const filename = `db://strategies/${id}.js`;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths    = Module._nodeModulePaths(process.cwd());
    mod._compile(code, filename);
    return mod.exports;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

class CompilationResult {
    constructor(success, instance = null, error = null, metadata = {}) {
        this.success   = success;
        this.instance  = instance;
        this.error     = error;
        this.metadata  = metadata;
        this.timestamp = Date.now();
    }

    static success(instance, metadata = {}) {
        return new CompilationResult(true, instance, null, metadata);
    }

    static failure(error, metadata = {}) {
        return new CompilationResult(false, null, error, metadata);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyCompiler
// ─────────────────────────────────────────────────────────────────────────────

class StrategyCompiler {
    constructor() {
        this.stats = {
            totalCompilations:     0,
            successfulCompilations: 0,
            failedCompilations:    0,
            averageCompileTimeMs:  0,
            compileTimes:          [],
        };
        log.info("StrategyCompiler initialized");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIMARY: Boot-time class extraction — NO persistent instance
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Load strategy code, extract the constructor function and schema.
     * Creates a TEMPORARY instance to read schema/metadata, then destroys it.
     * The StrategyClass constructor is returned for later use by startStrategy().
     *
    /**
     * @deprecated Use StrategyCompiler.compile() instead.
     * This method creates a throwaway instance which triggers the BaseStrategy
     * constructor fully (including StrategyStateStore init) and was never
     * called by any internal code path after Round 6. Kept for API compat only.
     *
     * @param {string} code - Strategy source (already security-scanned)
     * @param {string} id   - Strategy identifier
     * @returns {{ ok, StrategyClass, schema, metadata, error }}
     */
    async validateAndExtractClass(code, id) {
        try {
            // Load module → get the constructor
            const StrategyClass = _loadModuleFromString(code, id);

            if (typeof StrategyClass !== "function") {
                return { ok: false, error: "Strategy must export a class or constructor function" };
            }
            if (!StrategyClass.prototype) {
                return { ok: false, error: "Strategy export must be a class with a prototype" };
            }

            // Create a TEMPORARY instance to extract metadata
            const tmp = new StrategyClass();
            StrategyContract.adapt(tmp);

            // Validate contract on temp instance
            const contractCheck = StrategyContract.validate(tmp);
            if (!contractCheck.ok) {
                return { ok: false, error: `Contract failed: ${contractCheck.reason}` };
            }

            // Validate required fields
            const symbols = Array.isArray(tmp.symbols) ? tmp.symbols :
                (typeof tmp.symbol === "string" ? [tmp.symbol] : []);
            if (symbols.length === 0) {
                return { ok: false, error: "Strategy must define symbols" };
            }

            const hasMethod = METHOD_CANDIDATES.some(m => typeof tmp[m] === "function");
            if (!hasMethod) {
                return {
                    ok:    false,
                    error: `Strategy must implement one of: ${METHOD_CANDIDATES.join(", ")}`
                };
            }

            // Extract schema
            let schema = {};
            try {
                if (typeof tmp.defineSchema === "function") {
                    schema = tmp.defineSchema() || {};
                } else if (tmp.schema && typeof tmp.schema === "object") {
                    schema = { ...tmp.schema };
                }
            } catch (e) {
                log.warn(`[${id}] Schema extraction failed: ${e.message}`);
            }

            // Collect metadata
            const metadata = {
                symbols:          symbols,
                timeframe:        tmp.timeframe || "1m",
                lookback:         Number(tmp.lookback || 0),
                max_data_history: Number(tmp.max_data_history || 500),
                className:        StrategyClass.name || id,
                compiledAt:       Date.now(),
                codeLength:       code.length,
            };

            // ── Destroy temporary instance now ────────────────────────────────
            if (typeof tmp.destroy === "function") {
                try { tmp.destroy(); } catch (_) {}
            }
            // Explicitly null any refs the tmp held
            // (GC will handle the rest, but this signals intent)

            return { ok: true, StrategyClass, schema, metadata };

        } catch (err) {
            return { ok: false, error: `Class extraction failed: ${err.message}` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECONDARY: Full pipeline compile — returns a live instance
    // Used by strategyLoader.startStrategy() internally via _compileToClass,
    // and kept here for any caller that needs a live instance directly.
    // ─────────────────────────────────────────────────────────────────────────

    async compile(code, id) {
        const start = process.hrtime.bigint();
        this.stats.totalCompilations++;

        try {
            const StrategyClass = _loadModuleFromString(code, id);

            if (typeof StrategyClass !== "function") {
                this.stats.failedCompilations++;
                return CompilationResult.failure("Strategy must export a class");
            }

            const instance = new StrategyClass();
            StrategyContract.adapt(instance);

            const contractCheck = StrategyContract.validate(instance);
            if (!contractCheck.ok) {
                if (typeof instance.destroy === "function") instance.destroy();
                this.stats.failedCompilations++;
                return CompilationResult.failure(`Contract: ${contractCheck.reason}`);
            }

            // Normalise legacy symbol → symbols
            if (
                (!instance.symbols || !Array.isArray(instance.symbols) || instance.symbols.length === 0) &&
                typeof instance.symbol === "string"
            ) {
                instance.symbols = [instance.symbol];
            }

            // Extract schema during full compile to unblock loader persistence
            let schema = {};
            try {
                if (typeof instance.defineSchema === "function") {
                    schema = instance.defineSchema() || {};
                } else if (instance.schema && typeof instance.schema === "object") {
                    schema = { ...instance.schema };
                }
            } catch (e) {
                log.warn(`[${id}] schema extraction failed during compile: ${e.message}`);
            }

            if (!Array.isArray(instance.symbols) || instance.symbols.length === 0) {
                if (typeof instance.destroy === "function") instance.destroy();
                this.stats.failedCompilations++;
                return CompilationResult.failure("symbols must be a non-empty array");
            }

            const hasMethod = METHOD_CANDIDATES.some(m => typeof instance[m] === "function");
            if (!hasMethod) {
                if (typeof instance.destroy === "function") instance.destroy();
                this.stats.failedCompilations++;
                return CompilationResult.failure(
                    `Must implement one of: ${METHOD_CANDIDATES.join(", ")}`
                );
            }

            if (!instance.timeframe) instance.timeframe = TIME.DEFAULT_TIMEFRAMES?.[0] || "1m";

            const methods = getStrategyApi(instance);
            instance.__corexApi      = Object.freeze(methods);
            instance.__corexCompiled = true;
            instance.__corexCompiledAt = Date.now();

            const end    = process.hrtime.bigint();
            const timeMs = Number(end - start) / 1e6;

            this.stats.successfulCompilations++;
            this.stats.compileTimes.push(timeMs);
            if (this.stats.compileTimes.length > 100) this.stats.compileTimes.shift();
            this.stats.averageCompileTimeMs =
                this.stats.compileTimes.reduce((a, b) => a + b, 0) / this.stats.compileTimes.length;

            log.info(`[COMPILE] ${id} OK in ${timeMs.toFixed(2)}ms`);

            return CompilationResult.success(instance, {
                id,
                className:  StrategyClass.name || id,
                methods:    methods,
                symbols:    instance.symbols,
                timeframe:  instance.timeframe,
                schema,
                compiledAt: Date.now(),
                compileTimeMs: timeMs,
            });

        } catch (err) {
            this.stats.failedCompilations++;
            log.error(`[COMPILE] ${id} failed: ${err.message}`);
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source:     "strategy_compiler",
                strategyId: id,
                message:    err.message,
            });
            return CompilationResult.failure(err.message, { id, exception: err.stack });
        }
    }

    getStats() {
        return { ...this.stats };
    }
}

module.exports = {
    StrategyCompiler,
};