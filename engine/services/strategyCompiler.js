"use strict";

/**
 * StrategyCompiler - Enhanced Strategy Compilation Pipeline
 * 
 * This module provides a structured, multi-phase compilation pipeline for
 * transforming strategy source code into executable instances with full
 * validation, dependency injection, and runtime preparation.
 * 
 * Compilation Phases:
 * 1. PRE_COMPILE   - Parse and validate source code structure
 * 2. INSTANTIATE   - Create strategy class instance from source
 * 3. VALIDATE      - Validate required fields and methods
 * 4. NORMALIZE     - Normalize legacy patterns and apply defaults
 * 5. INTROSPECT    - Extract strategy API and metadata
 * 6. POST_COMPILE  - Final preparation and optimization
 * 
 * @module engine/services/strategyCompiler
 */

const Module = require('module');
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");
const { getStrategyApi } = require("@utils/strategy/StrategyIntrospection");
const { TIME } = require("@config/constants");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");

const log = logger.createModuleLogger("STRATEGY_COMPILER", {
    category: "strategy",
    ui: true,
    uiLevels: ["warn", "error"]
});

/**
 * Compilation phases
 */
const COMPILE_PHASES = {
    PRE_COMPILE: 'PRE_COMPILE',
    INSTANTIATE: 'INSTANTIATE',
    VALIDATE: 'VALIDATE',
    NORMALIZE: 'NORMALIZE',
    INTROSPECT: 'INTROSPECT',
    POST_COMPILE: 'POST_COMPILE'
};

/**
 * Required fields for a valid strategy
 */
const REQUIRED_FIELDS = ["symbols"];

/**
 * Method candidates - at least one must be present
 */
const METHOD_CANDIDATES = ["next", "onBar", "onTick", "_processData"];

/**
 * Compilation result structure
 */
class CompilationResult {
    constructor(success, instance = null, error = null, metadata = {}) {
        this.success = success;
        this.instance = instance;
        this.error = error;
        this.metadata = metadata;
        this.timestamp = Date.now();
    }

    static success(instance, metadata = {}) {
        return new CompilationResult(true, instance, null, metadata);
    }

    static failure(error, metadata = {}) {
        return new CompilationResult(false, null, error, metadata);
    }
}

/**
 * StrategyCompiler - Compiles strategy source code into executable instances
 */
class StrategyCompiler {
    constructor() {
        this.stats = {
            totalCompilations: 0,
            successfulCompilations: 0,
            failedCompilations: 0,
            averageCompileTimeMs: 0,
            compileTimes: [],
            phaseMetrics: new Map() // phase -> { count, totalMs, avgMs, failures }
        };

        log.info("StrategyCompiler initialized");
    }

    /**
     * Compile strategy source code into an executable instance
     * @param {string} code - Strategy source code
     * @param {string} id - Strategy identifier
     * @returns {Promise<CompilationResult>}
     */
    async compile(code, id) {
        const compileStart = process.hrtime.bigint();
        this.stats.totalCompilations++;

        log.debug(`[COMPILE] Starting compilation for strategy: ${id}`);

        // Create compilation context
        const context = {
            id,
            code,
            startTime: compileStart,
            instance: null,
            phaseResults: new Map(),
            metadata: {
                id,
                compiledAt: Date.now()
            }
        };

        // Execute compilation pipeline
        const phases = [
            { name: COMPILE_PHASES.PRE_COMPILE, handler: this._phasePreCompile.bind(this) },
            { name: COMPILE_PHASES.INSTANTIATE, handler: this._phaseInstantiate.bind(this) },
            { name: COMPILE_PHASES.VALIDATE, handler: this._phaseValidate.bind(this) },
            { name: COMPILE_PHASES.NORMALIZE, handler: this._phaseNormalize.bind(this) },
            { name: COMPILE_PHASES.INTROSPECT, handler: this._phaseIntrospect.bind(this) },
            { name: COMPILE_PHASES.POST_COMPILE, handler: this._phasePostCompile.bind(this) }
        ];

        for (const { name, handler } of phases) {
            const phaseStart = process.hrtime.bigint();

            try {
                const result = await handler(context);

                const phaseEnd = process.hrtime.bigint();
                const phaseTimeMs = Number(phaseEnd - phaseStart) / 1e6;

                context.phaseResults.set(name, {
                    success: result.success,
                    timeMs: phaseTimeMs,
                    data: result.data,
                    error: result.error
                });

                // Update phase metrics
                this._updatePhaseMetrics(name, phaseTimeMs, !result.success);

                if (!result.success) {
                    log.error(`[${name}] Failed for strategy ${id}: ${result.error}`);
                    this.stats.failedCompilations++;
                    this._emitError(id, `${name}_FAILED`, result.error);
                    
                    return CompilationResult.failure(result.error, {
                        ...context.metadata,
                        failedPhase: name,
                        phaseResults: this._serializePhaseResults(context.phaseResults)
                    });
                }

                log.debug(`[${name}] Completed for ${id} in ${phaseTimeMs.toFixed(2)}ms`);

            } catch (err) {
                log.error(`[${name}] Exception for strategy ${id}: ${err.message}`);
                this.stats.failedCompilations++;
                this._emitError(id, `${name}_EXCEPTION`, err.message);
                
                return CompilationResult.failure(`${name} exception: ${err.message}`, {
                    ...context.metadata,
                    failedPhase: name,
                    exception: err.stack
                });
            }
        }

        // Compilation successful
        const compileEnd = process.hrtime.bigint();
        const compileTimeMs = Number(compileEnd - compileStart) / 1e6;

        this.stats.successfulCompilations++;
        this.stats.compileTimes.push(compileTimeMs);
        this._updateAverageCompileTime();

        context.metadata.compileTimeMs = compileTimeMs;
        context.metadata.phaseResults = this._serializePhaseResults(context.phaseResults);

        log.info(`[COMPILE] Strategy ${id} compiled successfully in ${compileTimeMs.toFixed(2)}ms`);

        return CompilationResult.success(context.instance, context.metadata);
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPILATION PHASE HANDLERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Phase 1: Pre-Compile - Parse and validate source code structure
     * @private
     */
    async _phasePreCompile(context) {
        const { code, id } = context;

        // Basic code validation
        if (!code || typeof code !== 'string') {
            return {
                success: false,
                error: 'Invalid source code: must be a non-empty string'
            };
        }

        if (code.trim().length === 0) {
            return {
                success: false,
                error: 'Invalid source code: empty or whitespace only'
            };
        }

        // Check for basic class/module structure
        const hasClassExport = /class\s+\w+/.test(code) || /module\.exports\s*=/.test(code);
        if (!hasClassExport) {
            return {
                success: false,
                error: 'Invalid source code: must export a class or module'
            };
        }

        context.metadata.codeLength = code.length;
        context.metadata.codeLines = code.split('\n').length;

        return {
            success: true,
            data: { validated: true }
        };
    }

    /**
     * Phase 2: Instantiate - Create strategy class instance from source
     * @private
     */
    async _phaseInstantiate(context) {
        const { code, id } = context;

        try {
            // Create virtual module for strategy
            const filename = `db://strategies/${id}.js`;
            const mod = new Module(filename, module);
            mod.filename = filename;
            mod.paths = Module._nodeModulePaths(process.cwd());

            // Compile the module
            mod._compile(code, filename);

            const StrategyClass = mod.exports;

            // Validate export is a class/constructor
            if (typeof StrategyClass !== 'function') {
                return {
                    success: false,
                    error: 'Strategy must export a class or constructor function'
                };
            }

            // Check if it has a prototype (is a class)
            if (!StrategyClass.prototype) {
                return {
                    success: false,
                    error: 'Strategy export must be a class with a prototype'
                };
            }

            // Instantiate the strategy
            const instance = new StrategyClass();

            // Store instance in context
            context.instance = instance;
            context.metadata.className = StrategyClass.name || 'AnonymousStrategy';

            return {
                success: true,
                data: { instance }
            };

        } catch (err) {
            return {
                success: false,
                error: `Instantiation failed: ${err.message}`
            };
        }
    }

    /**
     * Phase 3: Validate - Validate required fields and methods
     * @private
     */
    async _phaseValidate(context) {
        const { id } = context;
        let { instance } = context;

        if (!instance || typeof instance !== 'object') {
            return {
                success: false,
                error: 'No instance available for validation'
            };
        }

        instance = StrategyContract.adapt(instance);
        context.instance = instance;

        const contractValidation = StrategyContract.validate(instance);
        if (!contractValidation.ok) {
            return {
                success: false,
                error: `Strategy contract validation failed: ${contractValidation.reason}`
            };
        }

        // Validate required fields
        const missingFields = [];
        for (const field of REQUIRED_FIELDS) {
            // Allow legacy 'symbol' (string) instead of 'symbols' (array)
            if (field === 'symbols') {
                const hasSymbols = instance.symbols && Array.isArray(instance.symbols) && instance.symbols.length > 0;
                const hasSymbol = typeof instance.symbol === 'string' && instance.symbol.length > 0;
                
                if (!hasSymbols && !hasSymbol) {
                    missingFields.push(field);
                }
            } else {
                if (instance[field] == null || instance[field] === "") {
                    missingFields.push(field);
                }
            }
        }

        if (missingFields.length > 0) {
            return {
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            };
        }

        // Validate at least one method exists
        const availableMethods = METHOD_CANDIDATES.filter(m => typeof instance[m] === 'function');
        if (availableMethods.length === 0) {
            return {
                success: false,
                error: `Missing required method: one of ${METHOD_CANDIDATES.map(m => `${m}()`).join(', ')}`
            };
        }

        // Warn if _processData is missing (BaseStrategy wrapper expected)
        if (typeof instance._processData !== 'function') {
            log.warn(`[VALIDATE] Strategy ${id} missing _processData; BaseStrategy wrapper expected`);
        }

        context.metadata.availableMethods = availableMethods;
        context.metadata.contractCapabilities = contractValidation.capabilities;

        return {
            success: true,
            data: {
                validated: true,
                availableMethods,
                contract: contractValidation.capabilities
            }
        };
    }

    /**
     * Phase 4: Normalize - Normalize legacy patterns and apply defaults
     * @private
     */
    async _phaseNormalize(context) {
        const { instance, id } = context;

        // Normalize legacy 'symbol' to 'symbols' array
        if ((!instance.symbols || !Array.isArray(instance.symbols) || instance.symbols.length === 0) 
            && typeof instance.symbol === 'string') {
            instance.symbols = [instance.symbol];
            log.debug(`[NORMALIZE] Converted legacy 'symbol' to 'symbols' array for ${id}`);
        }

        // Validate symbols is a non-empty array
        if (!Array.isArray(instance.symbols) || instance.symbols.length === 0) {
            return {
                success: false,
                error: 'symbols must be a non-empty array after normalization'
            };
        }

        // Apply default timeframe if missing
        if (!instance.timeframe || typeof instance.timeframe !== 'string') {
            instance.timeframe = TIME.DEFAULT_TIMEFRAMES[0] || "1m";
            log.debug(`[NORMALIZE] Applied default timeframe '${instance.timeframe}' for ${id}`);
        }

        // Ensure mode is set
        if (!instance.mode) {
            instance.mode = 'PAPER'; // Default to paper trading
            log.debug(`[NORMALIZE] Applied default mode 'PAPER' for ${id}`);
        }

        context.metadata.symbols = instance.symbols;
        context.metadata.timeframe = instance.timeframe;
        context.metadata.mode = instance.mode;

        return {
            success: true,
            data: {
                normalized: true,
                symbols: instance.symbols,
                timeframe: instance.timeframe,
                mode: instance.mode
            }
        };
    }

    /**
     * Phase 5: Introspect - Extract strategy API and metadata
     * @private
     */
    async _phaseIntrospect(context) {
        const { instance, id } = context;

        try {
            // Extract strategy API using introspection utility
            const methods = getStrategyApi(instance);

            // Attach API metadata to instance
            instance.__corexApi = methods;

            // Extract parameters if available
            const params = instance.params || instance.parameters || {};
            const paramKeys = Object.keys(params);

            context.metadata.apiMethods = methods;
            context.metadata.methodCount = methods.length;
            context.metadata.parameterCount = paramKeys.length;
            context.metadata.parameters = paramKeys;

            log.debug(`[INTROSPECT] Strategy ${id} has ${methods.length} API methods and ${paramKeys.length} parameters`);

            return {
                success: true,
                data: {
                    methods,
                    methodCount: methods.length,
                    parameters: paramKeys
                }
            };

        } catch (err) {
            return {
                success: false,
                error: `Introspection failed: ${err.message}`
            };
        }
    }

    /**
     * Phase 6: Post-Compile - Final preparation and optimization
     * @private
     */
    async _phasePostCompile(context) {
        const { instance, id } = context;

        // Mark instance as compiled
        instance.__corexCompiled = true;
        instance.__corexCompiledAt = Date.now();
        instance.__corexCompilerId = id;

        // Freeze certain properties to prevent accidental modification
        if (instance.__corexApi) {
            Object.freeze(instance.__corexApi);
        }

        // Add compilation metadata
        context.metadata.compiled = true;

        return {
            success: true,
            data: {
                compiled: true
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // LEGACY COMPATIBILITY
    // ═══════════════════════════════════════════════════════════════

    /**
     * Legacy compile method for backward compatibility
     * @param {object} instance - Pre-instantiated strategy instance
     * @returns {object} Legacy result format { ok, reason, methods }
     * @deprecated Use compile(code, id) instead
     */
    compileLegacy(instance) {
        if (!instance || typeof instance !== "object") {
            const msg = "Strategy instance is invalid";
            log.error(msg);
            this._emitError(null, "INVALID_INSTANCE", msg);
            return { ok: false, reason: msg };
        }

        const id = instance.id || instance.name || "unknown";
        StrategyContract.adapt(instance);
        const contractValidation = StrategyContract.validate(instance);
        if (!contractValidation.ok) {
            const msg = `Strategy contract validation failed: ${contractValidation.reason}`;
            log.error(`[${id}] ${msg}`);
            this._emitError(id, "CONTRACT_VALIDATION_FAILED", msg);
            return { ok: false, reason: msg };
        }

        // Allow legacy strategies that define `symbol` (string) instead of `symbols` (array)
        if ((!instance.symbols || !Array.isArray(instance.symbols) || instance.symbols.length === 0) 
            && typeof instance.symbol === "string") {
            instance.symbols = [instance.symbol];
        }

        for (const field of REQUIRED_FIELDS) {
            if (instance[field] == null || instance[field] === "") {
                const msg = `Missing required field: ${field}`;
                log.error(`[${id}] ${msg}`);
                this._emitError(id, "MISSING_FIELD", msg);
                return { ok: false, reason: msg };
            }
        }

        if (!Array.isArray(instance.symbols) || instance.symbols.length === 0) {
            const msg = "symbols must be a non-empty array";
            log.error(`[${id}] ${msg}`);
            this._emitError(id, "INVALID_SYMBOLS", msg);
            return { ok: false, reason: msg };
        }

        const hasAnyMethod = METHOD_CANDIDATES.some((m) => typeof instance[m] === "function");
        if (!hasAnyMethod) {
            const msg = `Missing required method: one of ${METHOD_CANDIDATES.map(m => `${m}()`).join(", ")}`;
            log.error(`[${id}] ${msg}`);
            this._emitError(id, "MISSING_METHOD", msg);
            return { ok: false, reason: msg };
        }

        if (typeof instance._processData !== "function") {
            log.warn(`[${id}] _processData not found; BaseStrategy wrapper expected.`);
        }

        if (!instance.timeframe || typeof instance.timeframe !== "string") {
            instance.timeframe = TIME.DEFAULT_TIMEFRAMES[0] || "1m";
        }

        const methods = getStrategyApi(instance);
        instance.__corexApi = methods;
        
        log.info(`[${id}] Strategy compiled (legacy)`, {
            methodCount: methods.length,
            methods
        });
        
        return { ok: true, methods };
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Emit compilation error event
     * @private
     */
    _emitError(id, code, message, meta = {}) {
        bus.emit(EVENTS.SYSTEM.ERROR, {
            source: "strategy_compiler",
            strategyId: id || null,
            code,
            message,
            meta,
            at: new Date().toISOString()
        });
    }

    /**
     * Update phase metrics
     * @private
     */
    _updatePhaseMetrics(phase, timeMs, failed = false) {
        const metrics = this.stats.phaseMetrics.get(phase) || { 
            count: 0, 
            totalMs: 0, 
            avgMs: 0, 
            failures: 0 
        };
        
        metrics.count++;
        metrics.totalMs += timeMs;
        metrics.avgMs = metrics.totalMs / metrics.count;
        
        if (failed) {
            metrics.failures++;
        }
        
        this.stats.phaseMetrics.set(phase, metrics);
    }

    /**
     * Update average compile time
     * @private
     */
    _updateAverageCompileTime() {
        const times = this.stats.compileTimes;
        if (times.length === 0) return;

        const sum = times.reduce((acc, t) => acc + t, 0);
        this.stats.averageCompileTimeMs = sum / times.length;

        // Keep only last 100 compile times to prevent memory growth
        if (times.length > 100) {
            this.stats.compileTimes = times.slice(-100);
        }
    }

    /**
     * Serialize phase results for metadata
     * @private
     */
    _serializePhaseResults(phaseResults) {
        return Array.from(phaseResults.entries()).map(([phase, result]) => ({
            phase,
            success: result.success,
            timeMs: result.timeMs,
            error: result.error || null
        }));
    }

    /**
     * Get compilation statistics
     * @returns {object}
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalCompilations > 0 
                ? (this.stats.successfulCompilations / this.stats.totalCompilations * 100).toFixed(1) + '%'
                : 'N/A',
            phaseMetrics: Array.from(this.stats.phaseMetrics.entries()).map(([phase, metrics]) => ({
                phase,
                ...metrics,
                failureRate: metrics.count > 0 
                    ? (metrics.failures / metrics.count * 100).toFixed(1) + '%'
                    : '0%'
            }))
        };
    }

    /**
     * Reset compilation statistics
     */
    resetStats() {
        this.stats = {
            totalCompilations: 0,
            successfulCompilations: 0,
            failedCompilations: 0,
            averageCompileTimeMs: 0,
            compileTimes: [],
            phaseMetrics: new Map()
        };
        log.info("Compilation statistics reset");
    }
}

// Export both the class and a singleton instance for backward compatibility
module.exports = {
    StrategyCompiler,
    compile: (instance) => new StrategyCompiler().compileLegacy(instance)
};
