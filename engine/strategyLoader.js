"use strict";

/**
 * StrategyLoader - Dynamic Bootloader for Strategy Instances
 * 
 * This module acts as a clear, dynamic bootloader that orchestrates the complete
 * lifecycle of strategy instances from database to runtime execution.
 * 
 * Boot Phases:
 * 1. DISCOVERY  - Find and enumerate strategies from database
 * 2. VALIDATION - Security and integrity checks
 * 3. COMPILATION - Transform source code into executable instances
 * 4. LINKING    - Inject dependencies and setup execution context
 * 5. INITIALIZATION - Apply runtime configuration and prepare for execution
 * 6. REGISTRATION - Register with engine for market data routing
 * 
 * @module engine/strategyLoader
 */

const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');
const stateManager = require('@utils/stateController');
const { verifyStrategyFile } = require('@core/services/hashVerifier');
const db = require('@core/services/postgres');
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const { ComponentLifecycle, STATES } = require("@core/core/lifecycle/ComponentLifecycle");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const { validateStrategyInterface } = require("@utils/strategy/StrategyValidator");
const RuleChain = require("@utils/strategy/RuleChain");
const strategyRuntime = require("@core/modules/strategyRuntime");
const { parseScopedId } = require("@core/services/userScope");

const log = logger.createModuleLogger("STRATEGY_BOOTLOADER", {
    category: "strategy",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});

/**
 * Boot phases for strategy initialization
 */
const BOOT_PHASES = {
    DISCOVERY: 'DISCOVERY',
    VALIDATION: 'VALIDATION',
    COMPILATION: 'COMPILATION',
    LINKING: 'LINKING',
    INITIALIZATION: 'INITIALIZATION',
    REGISTRATION: 'REGISTRATION'
};

/**
 * StrategyBootloader - Orchestrates strategy instance lifecycle
 */
class StrategyBootloader {
    constructor(options = {}) {
        this.engine = null;
        this.options = options;
        this.lifecycle = new ComponentLifecycle("STRATEGY_BOOTLOADER", { category: "strategy" });
        
        // Strategy registry: id -> BootedStrategy
        this.registry = new Map();
        this._startInFlight = new Set();
        
        // Compiler instance
        this.compiler = new StrategyCompiler();
        
        // Boot statistics
        this.bootStats = {
            totalBoots: 0,
            successfulBoots: 0,
            failedBoots: 0,
            reboots: 0,
            averageBootTimeMs: 0,
            bootTimes: [],
            phaseMetrics: new Map() // phase -> { count, totalMs, avgMs }
        };
        
        // Phase handlers
        this.phaseHandlers = this._initializePhaseHandlers();
        
        log.info(`StrategyBootloader initialized`);
        this.lifecycle.transition(STATES.READY, { reason: "initialized" });
        
        // Listen for runtime parameter updates
        bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, e => {
            log.debug(`EVENT: SETTINGS_UPDATED for ${e.id}`);
            this._handleRuntimeUpdate(e.id, e.params);
        });

        // Listen for logs forwarded from the sandboxed strategy runtime worker.
        // This provides crucial visibility into the execution of isolated strategy code.
        // NOTE: Using a string literal here because `constants.js` is not in context.
        // Ideally, this would be `EVENTS.STRATEGY.REMOTE_LOG`.
        bus.on('strategy:remote_log', ({ strategyId, level, message, meta } = {}) => {
            if (!strategyId || !level || typeof message === 'undefined') return;

            // Re-constitute a logger with the correct module name to ensure logs are
            // properly tagged and routed to the console and UI.
            const remoteLogger = logger.createModuleLogger(`STRATEGY:${strategyId}`, {
                category: "strategy",
                ui: true
            });
            if (typeof remoteLogger[level] === 'function') {
                // Correctly call the logger function with the message and meta.
                // The original code had a typo here.
                remoteLogger[level](message, meta);
            }
        });
    }

    /**
     * Initialize phase handlers for the boot pipeline
     * @private
     */
    _initializePhaseHandlers() {
        return {
            [BOOT_PHASES.DISCOVERY]: this._phaseDiscovery.bind(this),
            [BOOT_PHASES.VALIDATION]: this._phaseValidation.bind(this),
            [BOOT_PHASES.COMPILATION]: this._phaseCompilation.bind(this),
            [BOOT_PHASES.LINKING]: this._phaseLinking.bind(this),
            [BOOT_PHASES.INITIALIZATION]: this._phaseInitialization.bind(this),
            [BOOT_PHASES.REGISTRATION]: this._phaseRegistration.bind(this)
        };
    }

    /**
     * Initialize the bootloader and boot all strategies from database
     * @param {object} engine - The core trading engine instance
     * @returns {Promise<string[]>} Array of active symbols from booted strategies
     */
    async init(engine) {
        if (!engine) {
            throw new Error('StrategyBootloader requires an engine instance for initialization.');
        }
        
        this.engine = engine;
        log.info('StrategyBootloader init starting');
        this.lifecycle.transition(STATES.INITIALIZING, { reason: "init" });

        if (strategyRuntime.isEnabled()) {
            await strategyRuntime.start();
            log.info("Strategy runtime worker enabled.");
        } else {
            log.warn("Strategy runtime worker disabled; strategies will run in-process (not safe for untrusted code).");
        }
        
        const bootStart = process.hrtime.bigint();
        
        // Boot all strategies from database
        await this._discoverAll();
        await this._restoreDesiredRuntimeStates();
        
        const bootEnd = process.hrtime.bigint();
        const bootTimeMs = Number(bootEnd - bootStart) / 1e6;
        
        log.info(`StrategyBootloader init completed in ${bootTimeMs.toFixed(2)}ms`);
        log.info(`Booted ${this.registry.size} strategies (${this.bootStats.successfulBoots} successful, ${this.bootStats.failedBoots} failed)`);
        this.lifecycle.transition(STATES.RUNNING, {
            registry: this.registry.size,
            successfulBoots: this.bootStats.successfulBoots,
            failedBoots: this.bootStats.failedBoots
        });
        
        this._logBootDiagnostics();
        
        return this.getActiveSymbols();
    }

    /**
     * Boot all strategies from database
     * @private
     */
    async _discoverAll() {
        const discoveryStart = Date.now();
        
        let strategies = [];
        try {
            const res = await db.query(
                `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_state, runtime_updated_at
                 FROM strategies
                 WHERE script_body IS NOT NULL
                 ORDER BY name ASC`
            );
            strategies = res.rows || [];
        } catch (err) {
            log.error(`[DISCOVERY] Failed to read strategies from database: ${err.message}`);
            return;
        }

        const discoveryEnd = Date.now();
        log.info(`[DISCOVERY] Found ${strategies.length} strategies in ${discoveryEnd - discoveryStart}ms`);

        // Just register placeholders for on-demand booting
        for (const strategyRecord of strategies) {
            const id = strategyRecord.name;
            if (!this.registry.has(id)) {
                this.registry.set(id, {
                    id,
                    instance: null,
                    bootedAt: null,
                    status: 'DISCOVERED',
                    record: strategyRecord,
                });
            }
        }

        if (strategies.length > 0) {
            log.info(`Discovered ${strategies.length} strategies, which will be compiled and booted on-demand.`);
        }
    }

    /**
     * Boot a single strategy through the complete boot pipeline
     * @param {object} record - Strategy record from database
     * @returns {Promise<BootedStrategy|null>}
     */
    async bootStrategy(record, options = {}) {
        const bootStart = process.hrtime.bigint();
        const id = String(record?.name || '').trim();
        
        if (!id) {
            log.warn(`[BOOT] Skipping invalid strategy record: missing name`);
            this.bootStats.failedBoots++;
            return null;
        }
        
        this.bootStats.totalBoots++;
        
        // Check if this is a reboot
        const existing = this.registry.get(id);
        const isReboot = !!existing?.instance;
        if (isReboot) {
            this.bootStats.reboots++;
            log.info(`[BOOT] Rebooting strategy: ${id}`);
        } else {
            log.info(`[BOOT] Booting strategy: ${id}`);
        }
        
        // Create boot context
        const bootContext = {
            id,
            record,
            isReboot,
            existing,
            startTime: bootStart,
            phaseResults: new Map(),
            instance: null,
            compiledStrategy: null,
            error: null,
            preBootStatus: stateManager.getStatus(id)
        };
        
        // Execute boot pipeline
        const phases = Object.values(BOOT_PHASES);
        for (const phase of phases) {
            const phaseStart = process.hrtime.bigint();
            
            try {
                const handler = this.phaseHandlers[phase];
                const result = await handler(bootContext);
                
                const phaseEnd = process.hrtime.bigint();
                const phaseTimeMs = Number(phaseEnd - phaseStart) / 1e6;
                
                bootContext.phaseResults.set(phase, {
                    success: result.success,
                    timeMs: phaseTimeMs,
                    data: result.data,
                    error: result.error
                });
                
                // Update phase metrics
                this._updatePhaseMetrics(phase, phaseTimeMs);
                
                if (!result.success) {
                    log.error(`[${phase}] Failed for strategy ${id}: ${result.error}`);
                    this.lifecycle.transition(STATES.ERROR, { strategyId: id, phase, reason: result.error });
                    bootContext.error = result.error;
                    this.bootStats.failedBoots++;
                    stateManager.commit(id, 'ERROR', { 
                        reason: `${phase} failed: ${result.error}`,
                        phase 
                    });
                    return null;
                }
                
                log.debug(`[${phase}] Completed for ${id} in ${phaseTimeMs.toFixed(2)}ms`);

                // Discovery can short-circuit when strategy source is unchanged.
                if (phase === BOOT_PHASES.DISCOVERY && result?.data?.skipBoot) {
                    log.debug(`[BOOT] Strategy ${id} unchanged. Keeping existing runtime instance.`);
                    return existing || this.registry.get(id) || null;
                }
                
            } catch (err) {
                log.error(`[${phase}] Exception for strategy ${id}: ${err.message}`);
                this.lifecycle.fail(err, { strategyId: id, phase });
                bootContext.error = err.message;
                this.bootStats.failedBoots++;
                stateManager.commit(id, 'ERROR', { 
                    reason: `${phase} exception: ${err.message}`,
                    phase 
                });
                return null;
            }
        }
        
        // Boot successful
        const bootEnd = process.hrtime.bigint();
        const bootTimeMs = Number(bootEnd - bootStart) / 1e6;
        
        this.bootStats.successfulBoots++;
        this.bootStats.bootTimes.push(bootTimeMs);
        this._updateAverageBootTime();
        
        log.info(`[BOOT] Strategy ${id} booted successfully in ${bootTimeMs.toFixed(2)}ms`);
        this.lifecycle.transition(STATES.RUNNING, { strategyId: id, bootTimeMs: Number(bootTimeMs.toFixed(2)) });
        
        // Emit boot event
        bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, {
            id,
            bootTimeMs,
            isReboot
        }, {
            userId: parseScopedId(id).userId || null
        });
        
        // Auto-restart if it was ACTIVE before reboot
        const shouldAutoRestart =
            !options.skipAutoRestart &&
            isReboot &&
            (bootContext.preBootStatus === "ACTIVE" || bootContext.record?.runtime_state === "RUNNING");
        if (shouldAutoRestart && this.engine) {
            log.info(`[BOOT] Strategy ${id} should be running, attempting auto-restart`);
            this.startStrategy(id);
        } else if (!isReboot) {
            stateManager.commit(id, 'STAGED', { reason: 'booted' });
        }
        
        return this.registry.get(id);
    }

    // ═══════════════════════════════════════════════════════════════
    // BOOT PHASE HANDLERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Phase 1: Discovery - Validate record structure
     * @private
     */
    async _phaseDiscovery(context) {
        const { id, record } = context;
        
        if (!record.script_body || typeof record.script_body !== 'string') {
            return { 
                success: false, 
                error: 'Missing or invalid script_body' 
            };
        }
        
        const updatedAt = record.updated_at ? new Date(record.updated_at).getTime() : Date.now();
        
        // Check if unchanged (skip reboot if not needed)
        if (context.existing && context.existing.updatedAt >= updatedAt) {
            log.debug(`[DISCOVERY] Strategy ${id} unchanged, skipping reboot`);
            return { 
                success: true,
                data: {
                    code: record.script_body,
                    updatedAt,
                    runtimeMode: record.runtime_mode,
                    runtimeParams: record.runtime_params,
                    runtimeState: record.runtime_state || "STOPPED",
                    runtimeUpdatedAt: record.runtime_updated_at ? new Date(record.runtime_updated_at).getTime() : 0,
                    skipBoot: true
                }
            };
        }
        
        return { 
            success: true, 
            data: { 
                code: record.script_body,
                updatedAt,
                runtimeMode: record.runtime_mode,
                runtimeParams: record.runtime_params,
                runtimeState: record.runtime_state || "STOPPED",
                runtimeUpdatedAt: record.runtime_updated_at ? new Date(record.runtime_updated_at).getTime() : 0
            } 
        };
    }

    /**
     * Phase 2: Validation - Security and integrity checks
     * @private
     */
    async _phaseValidation(context) {
        const { id } = context;
        const { code } = context.phaseResults.get(BOOT_PHASES.DISCOVERY).data;
        
        // Hash verification
        const hashVerify = await verifyStrategyFile({
            strategyName: id,
            filePath: null,
            code
        });
        
        if (!hashVerify.ok) {
            return { 
                success: false, 
                error: `Hash verification failed: ${hashVerify.reason}` 
            };
        }
        
        // Security validation
        if (!validateStrategyCode(code)) {
            return { 
                success: false, 
                error: 'Security validation failed: code contains forbidden patterns' 
            };
        }
        
        return { 
            success: true, 
            data: { validated: true } 
        };
    }

    /**
     * Phase 3: Compilation - Transform source code into executable instance
     * @private
     */
    async _phaseCompilation(context) {
        const { id } = context;
        const { code } = context.phaseResults.get(BOOT_PHASES.DISCOVERY).data;

        if (strategyRuntime.isEnabled()) {
            const discovery = context.phaseResults.get(BOOT_PHASES.DISCOVERY).data || {};
            const runtimeParams = discovery.runtimeParams && typeof discovery.runtimeParams === "object" ? discovery.runtimeParams : null;
            const loaded = await strategyRuntime.loadStrategy({ strategyId: id, code, runtimeParams });
            const meta = loaded?.meta || {};
            const stub = {
                __remote: true,
                id,
                name: id,
                symbols: Array.isArray(meta.symbols) ? meta.symbols : [],
                timeframe: meta.timeframe || "1m",
                lookback: Number(meta.lookback || 0),
                max_data_history: Number(meta.max_data_history || 0),
                schema: meta.schema || {},
                params: meta.params || {},
                enabled: true
            };
            context.instance = stub;
            context.compiledStrategy = { success: true, metadata: meta };
            return { success: true, data: { remote: true, meta } };
        }

        // Fallback: compile strategy in-process (not safe for untrusted code).
        const compilationResult = await this.compiler.compile(code, id);
        if (!compilationResult.success) {
            return { success: false, error: compilationResult.error };
        }
        context.instance = compilationResult.instance;
        context.compiledStrategy = compilationResult;
        return { success: true, data: compilationResult };
    }

    /**
     * Phase 4: Linking - Inject dependencies and setup execution context
     * @private
     */
    async _phaseLinking(context) {
        const { id, instance } = context;
        
        if (!instance) {
            return { 
                success: false, 
                error: 'No instance available for linking' 
            };
        }

        if (instance.__remote) {
            // For remote strategies, the `generateSignal` method on the stub
            // becomes the dispatcher to the worker process. This allows the engine
            // to treat remote and in-process strategies identically in its dispatch loop.
            instance.generateSignal = (packet, meta) => {
                strategyRuntime.dispatchMarketData(id, packet, meta);
                // Remote signals are handled asynchronously via the event bus, so we return null here.
                return null;
            };

            // Remote strategies run in a separate worker process. Only attach execution context in the main process.
            if (this.engine && typeof this.engine._setupExecutionContext === "function") {
                try {
                    this.engine._setupExecutionContext(instance);
                } catch (err) {
                    log.warn(`[LINKING] Failed to setup execution context for ${id}: ${err.message}`);
                }
            }
            return { success: true, data: { linked: true, remote: true } };
        }
        
        // Ensure instance has required properties
        instance.id = instance.name = id;
        
        // Standardize interface (ensure _processData exists)
        this._standardizeInterface(instance);
        
        // Setup execution context if engine is available
        if (this.engine && typeof this.engine._setupExecutionContext === 'function') {
            try {
                this.engine._setupExecutionContext(instance);
            } catch (err) {
                log.warn(`[LINKING] Failed to setup execution context for ${id}: ${err.message}`);
            }
        }
        
        return { 
            success: true, 
            data: { linked: true } 
        };
    }

    /**
     * Phase 5: Initialization - Apply runtime configuration
     * @private
     */
    async _phaseInitialization(context) {
        const { id, instance, record } = context;
        const discoveryData = context.phaseResults.get(BOOT_PHASES.DISCOVERY).data;
        
        // Apply runtime mode
        if (discoveryData.runtimeMode) {
            instance.mode = String(discoveryData.runtimeMode).toUpperCase();
        }
        
        // Apply runtime parameters
        if (discoveryData.runtimeParams && typeof discoveryData.runtimeParams === 'object') {
            const params = discoveryData.runtimeParams;
            if (Object.keys(params).length > 0) {
                if (instance.__remote) {
                    await strategyRuntime.updateParams({ strategyId: id, params }).catch(() => {});
                    instance.params = { ...(instance.params || {}), ...(params || {}) };
                } else if (typeof instance.updateParams === 'function') {
                    instance.updateParams(params);
                }
            }
        }
        
        // Apply internal defaults
        if (!instance.__remote && typeof instance._applyDefaults === 'function') {
            instance._applyDefaults();
        }
        
        return { 
            success: true, 
            data: { initialized: true } 
        };
    }

    /**
     * Phase 6: Registration - Register strategy in bootloader registry
     * @private
     */
    async _phaseRegistration(context) {
        const { id, instance, isReboot, existing } = context;
        const discoveryData = context.phaseResults.get(BOOT_PHASES.DISCOVERY).data;
        const compilationData = context.phaseResults.get(BOOT_PHASES.COMPILATION).data;
        
        // Prepare for reboot if needed
        if (isReboot && existing?.instance && this.engine) {
            log.debug(`[REGISTRATION] Unregistering existing instance for ${id}`);
            this.engine.unregisterStrategy(id);
            // For remote runtimes, the new worker is already loaded in COMPILATION.
            // Unloading here would kill the fresh worker and break warmup/start.
            if (strategyRuntime.isEnabled() && !compilationData?.remote) {
                strategyRuntime.unloadStrategy({ strategyId: id }).catch(() => {});
            }
        }
        
        // Create booted strategy entry
        const bootedStrategy = {
            id,
            instance,
            source: discoveryData.code,
            updatedAt: discoveryData.updatedAt,
            runtimeUpdatedAt: discoveryData.runtimeUpdatedAt,
            lastRuntimeSync: 0,
            compilationResult: compilationData,
            bootedAt: Date.now(),
            bootPhases: Array.from(context.phaseResults.entries()).map(([phase, result]) => ({
                phase,
                success: result.success,
                timeMs: result.timeMs
            }))
        };
        
        // Validate strategy interface
        const interfaceVerify = StrategyContract.validate(instance);
        if (!interfaceVerify.ok) {
            log.error(`[REGISTRATION] Interface validation failed: ${interfaceVerify.reason}`);
            bootedStrategy.interfaceError = interfaceVerify.reason;
            this.lifecycle.transition(STATES.ERROR, { strategyId: id, phase: 'REGISTRATION', reason: interfaceVerify.reason });
        }
        
        // Register in bootloader registry
        this.registry.set(id, bootedStrategy);
        
        return { 
            success: true, 
            data: { registered: true } 
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERFACE STANDARDIZATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Standardize strategy interface to ensure _processData exists
     * @private
     */
    _standardizeInterface(instance) {
        if (!instance || instance.__corexStandardized) return;
        StrategyContract.adapt(instance);

        if (typeof instance.rule !== "function") {
            instance.rule = function rule(packet) {
                const ctx = packet && packet.time ? { barTime: packet.time } : {};
                return new RuleChain(this, ctx);
            };
        }
        if (typeof instance.chain !== "function") {
            instance.chain = function chain(packet) {
                return this.rule(packet);
            };
        }
        
        const hasProcess = typeof instance._processData === 'function';
        if (!hasProcess) {
            const originalOnTick = typeof instance.onTick === 'function' ? instance.onTick.bind(instance) : null;
            const originalOnBar = typeof instance.onBar === 'function' ? instance.onBar.bind(instance) : null;
            
            instance._processData = (packet, meta = {}) => {
                const source = meta.source || meta.type;
                if (source === "bar" && originalOnBar) return originalOnBar(packet);
                if (source === "tick" && originalOnTick) return originalOnTick(packet);
                if (originalOnBar && packet && packet.open != null && packet.close != null) return originalOnBar(packet);
                if (originalOnTick) return originalOnTick(packet);
                return null;
            };
            
            instance.onTick = (packet) => instance._processData(packet, { source: "tick" });
            instance.onBar = (packet) => instance._processData(packet, { source: "bar" });
        }

        // Lightweight error boundary to isolate strategy runtime exceptions.
        if (typeof instance._processData === "function" && !instance.__corexProcessWrapped) {
            const original = instance._processData.bind(instance);
            instance._processData = (packet, meta = {}) => {
                try {
                    return original(packet, meta);
                } catch (err) {
                    const sid = instance.id || instance.name || "unknown";
                    log.warn(`[RUNTIME_GUARD] _processData failed for ${sid}: ${err.message}`);
                    return null;
                }
            };
            instance.__corexProcessWrapped = true;
        }
        
        instance.__corexStandardized = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // RUNTIME MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Start a strategy by registering it with the trading engine
     * @param {string} id - Strategy ID
     * @param {object} options - Runtime options
     * @returns {object|null} Booted strategy entry or null
     */
    async startStrategy(id, options = {}) {
        log.info(`[START] Starting strategy ${id} with options=${JSON.stringify(options)}`);
        if (this._startInFlight.has(id)) {
            log.warn(`[START] Strategy ${id} start already in progress. Ignoring duplicate request.`);
            return this.registry.get(id) || null;
        }
        this._startInFlight.add(id);
        
        try {
            let booted = this.registry.get(id);
            if (!booted || !booted.instance) {
                log.info(`[START] Strategy ${id} is not booted. Attempting to boot now...`);
                const record = booted ? booted.record : null;
                if (!record) {
                    // If not even discovered, try to load its record from DB
                    const { rows } = await db.query('SELECT * FROM strategies WHERE name = $1 LIMIT 1', [id]);
                    if (!rows || !rows.length) {
                        log.error(`[START] Strategy ${id} not found in registry or database.`);
                        return null;
                    }
                    booted = await this.bootStrategy(rows[0], { skipAutoRestart: true });
                } else {
                    booted = await this.bootStrategy(record, { skipAutoRestart: true });
                }

                if (!booted || !booted.instance) {
                    log.error(`[START] Failed to boot strategy ${id}. Cannot start.`);
                    return null;
                }
            }
            
            if (!this.engine) {
                log.error(`[START] No engine available to start strategy ${id}`);
                return null;
            }
            
            const { instance } = booted;
            const currentStatus = stateManager.getStatus(id);
            const transitionableStates = new Set(["STAGED", "PAUSED", "ERROR", "OFFLINE"]);

            if (currentStatus === "ACTIVE") {
                if (this._isStrategyRegisteredInEngine(instance)) {
                    log.info(`[START] Strategy ${id} already ACTIVE in engine. No action taken.`);
                    return booted;
                }
                stateManager.commit(id, "STOPPING", { reason: "Reset stale ACTIVE state before restart" });
                stateManager.commit(id, "OFFLINE", { reason: "Reset stale ACTIVE state before restart" });
            } else if (currentStatus === "DISABLED") {
                stateManager.commit(id, "STAGED", { reason: "Manual restart from DISABLED" });
            } else if (!transitionableStates.has(currentStatus)) {
                log.warn(`[START] Strategy ${id} currently ${currentStatus}. Ignoring start request.`);
                return booted;
            }
            
            // Apply runtime options
            if (options.mode) {
                instance.mode = String(options.mode).toUpperCase();
            }

            if (options.timeframe) {
                const normalizedTf = this.engine._normalizeTimeframe?.(options.timeframe);
                if (!normalizedTf) {
                    log.error(`[START] Invalid timeframe for ${id}: ${options.timeframe}`);
                    stateManager.commit(id, "ERROR", { reason: "Invalid timeframe" });
                    return booted;
                }
                instance.timeframe = normalizedTf;
            }

            if (options.strategyParams && typeof options.strategyParams === "object") {
                if (typeof instance.updateParams === "function") instance.updateParams(options.strategyParams);
                else instance.params = { ...(instance.params || {}), ...options.strategyParams };
            }

            instance.enabled = true;
            instance.startTime = Date.now();
            
            // Setup execution context
            if (typeof this.engine._setupExecutionContext === 'function') {
                this.engine._setupExecutionContext(instance);
            }

            this._updateRuntimeStateInDb(id, {
                mode: instance.mode || "PAPER",
                params: instance.params || {},
                state: "RUNNING"
            }).catch((err) => {
                log.warn(`[START] Failed to persist runtime state for ${id}: ${err.message}`);
            });
            
            // Register with engine
            Promise.resolve(this.engine.registerStrategy(instance))
                .then((ok) => {
                    if (!ok) {
                        stateManager.commit(id, 'ERROR', { reason: 'Engine registration failed' });
                    }
                })
                .catch((err) => {
                    stateManager.commit(id, 'ERROR', { reason: `Engine registration exception: ${err.message}` });
                    log.error(`[START] Engine registration failed for ${id}: ${err.message}`);
                });

            log.info(`[START] Strategy ${id} started successfully`);
            
            return booted;
        } finally {
            this._startInFlight.delete(id);
        }
    }

    /**
     * Stop a strategy by unregistering it from the engine
     * @param {string} id - Strategy ID
     * @returns {boolean} Success status
     */
    stopStrategy(id) {
        log.info(`[STOP] Stopping strategy ${id}`);
        
        const booted = this.registry.get(id);
        if (!booted) {
            log.warn(`[STOP] Strategy ${id} not found in registry`);
            return false;
        }
        
        if (!this.engine) {
            log.error(`[STOP] No engine available to stop strategy ${id}`);
            return false;
        }
        
        this.engine.unregisterStrategy(id);
        stateManager.commit(id, 'STAGED', { stoppedAt: new Date().toISOString() });
        this._updateRuntimeStateInDb(id, { state: "STOPPED" }).catch((err) => {
            log.warn(`[STOP] Failed to persist runtime state for ${id}: ${err.message}`);
        });
        
        log.info(`[STOP] Strategy ${id} stopped successfully`);
        return true;
    }

    _isStrategyRegisteredInEngine(instance) {
        if (!instance || !this.engine || !(this.engine.subscriptions instanceof Map)) return false;
        const symbols = Array.isArray(instance.symbols) ? instance.symbols : [];
        for (const symbol of symbols) {
            const subs = this.engine.subscriptions.get(symbol);
            if (subs && subs.has(instance)) return true;
        }
        return false;
    }

    /**
     * Reload a strategy by name from database
     * @param {string} id - Strategy ID
     * @returns {Promise<boolean>} Success status
     */
    async reloadStrategy(id) {
        log.info(`[RELOAD] Reloading strategy ${id}`);
        
        const name = String(id || '').trim();
        if (!name) return false;
        
        try {
            const { rows } = await db.query(
                `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_state, runtime_updated_at
                 FROM strategies
                 WHERE name = $1
                 LIMIT 1`,
                [name]
            );
            
            if (!rows[0]) {
                log.warn(`[RELOAD] Strategy ${id} not found in database`);
                return false;
            }
            
            await this.bootStrategy(rows[0]);
            return true;
        } catch (err) {
            log.error(`[RELOAD] Failed to reload strategy ${id}: ${err.message}`);
            return false;
        }
    }

    /**
     * Backward-compatible alias used by legacy routes/controllers.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async _loadByName(id) {
        return this.reloadStrategy(id);
    }

    /**
     * Backward-compatible strategy list used by execution + broadcaster layers.
     * @returns {Array<object>}
     */
    listStrategies() {
        const now = Date.now();
        const rows = [];
        for (const [id, booted] of this.registry.entries()) {
            const inst = booted?.instance || {};
            const status = stateManager.getStatus(id);
            const uptime = Number(inst.uptime || 0);
            const symbols = Array.isArray(inst.symbols) ? inst.symbols : [];

            let dataPoints = 0;
            let historyPoints = 0;
            if (inst?.dataManager?.data && typeof inst.dataManager.data.values === "function") {
                for (const store of inst.dataManager.data.values()) {
                    const historical = Array.isArray(store?.historical) ? store.historical.length : 0;
                    dataPoints += historical;
                    historyPoints += historical;
                    if (store?.activeCandle) dataPoints += 1;
                }
            }

            const lookback = Number(inst.lookback || 0);
            const lookbackCoveragePct = lookback > 0 ? Math.min(100, (historyPoints / lookback) * 100) : 0;

            rows.push({
                id,
                name: id,
                status,
                active: status === "ACTIVE" || status === "WARMING_UP",
                mode: String(inst.mode || "PAPER").toUpperCase(),
                timeframe: inst.timeframe || "1m",
                symbols,
                params: inst.params || {},
                schema: inst.schema || {},
                reason: null,
                uptime,
                startedAt: uptime > 0 ? now - uptime : null,
                dataPoints,
                historyPoints,
                lookback,
                lookbackCoveragePct
            });
        }
        return rows.sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * Persist params for compatibility with existing controllers.
     * @param {string} id
     * @param {object} params
     */
    _saveParams(id, params = {}) {
        const booted = this.registry.get(id);
        if (booted?.instance) {
            booted.instance.params = { ...(booted.instance.params || {}), ...(params || {}) };
        }
        this._updateRuntimeStateInDb(id, { params }).catch((err) => {
            log.warn(`[PARAMS] Persist failed for ${id}: ${err.message}`);
        });
    }

    /**
     * Legacy helper used by reset routes. Keep non-throwing behavior.
     * @returns {null}
     */
    _instantiateStrategy() {
        return null;
    }

    /**
     * Sync runtime state from database
     * @param {string} id - Strategy ID
     */
    async syncRuntimeState(id) {
        const booted = this.registry.get(id);
        if (!booted) return;
        if (!db.hasDbConfig()) return;
        
        try {
            const { rows } = await db.query(
                `SELECT runtime_mode, runtime_params, runtime_state, runtime_updated_at
                 FROM strategies
                 WHERE name = $1
                 LIMIT 1`,
                [String(id || "").trim()]
            );
            
            const row = rows[0];
            if (!row) return;
            
            const updatedAt = row.runtime_updated_at ? new Date(row.runtime_updated_at).getTime() : 0;
            if (updatedAt && booted.runtimeUpdatedAt && updatedAt <= booted.runtimeUpdatedAt) return;
            
            // Update runtime mode
            if (row.runtime_mode) {
                booted.instance.mode = String(row.runtime_mode).toUpperCase();
                if (this.engine && typeof this.engine._setupExecutionContext === 'function') {
                    this.engine._setupExecutionContext(booted.instance);
                }
            }
            
            // Update runtime params
            const params = row.runtime_params && typeof row.runtime_params === 'object' ? row.runtime_params : null;
            if (params && Object.keys(params).length > 0) {
                if (booted.instance?.__remote) {
                    await strategyRuntime.updateParams({ strategyId: id, params }).catch(() => {});
                    booted.instance.params = { ...(booted.instance.params || {}), ...(params || {}) };
                } else if (typeof booted.instance.updateParams === 'function') {
                    booted.instance.updateParams(params);
                }
            }
            
            booted.runtimeUpdatedAt = updatedAt || Date.now();
            booted.lastRuntimeSync = Date.now();
            
            log.debug(`[SYNC] Runtime state synced for ${id}`);
        } catch (err) {
            log.warn(`[SYNC] Runtime sync failed for ${id}: ${err.message}`);
        }
    }

    /**
     * Handle runtime parameter updates
     * @private
     */
    async _handleRuntimeUpdate(id, params) {
        if (!params || typeof params !== 'object') {
            log.debug(`[RUNTIME] Invalid params for ${id}, skipping update`);
            return;
        }

        const booted = this.registry.get(String(id || "").trim());
        if (booted?.instance?.__remote) {
            await strategyRuntime.updateParams({ strategyId: id, params }).catch(() => {});
            booted.instance.params = { ...(booted.instance.params || {}), ...(params || {}) };
        } else if (booted?.instance && typeof booted.instance.updateParams === "function") {
            try { booted.instance.updateParams(params); } catch { /* ignore */ }
        }
        
        await this._updateRuntimeStateInDb(id, { params }).catch(err => {
            log.warn(`[RUNTIME] DB param save failed for ${id}: ${err.message}`);
        });
    }

    /**
     * Update runtime state in database
     * @private
     */
    async _updateRuntimeStateInDb(id, { mode, params, state } = {}) {
        if (!db.hasDbConfig()) return false;
        
        const name = String(id || "").trim();
        if (!name) return false;
        
        const m = mode ? String(mode).toUpperCase() : null;
        const p = params && typeof params === "object" ? params : null;
        const s = state ? String(state).toUpperCase() : null;
        
        const sql = `
            UPDATE strategies
            SET runtime_mode = COALESCE($2, runtime_mode),
                runtime_params = CASE WHEN $3::jsonb IS NULL THEN runtime_params ELSE $3::jsonb END,
                runtime_state = COALESCE($4, runtime_state),
                runtime_updated_at = NOW()
            WHERE name = $1
        `;
        
        const payload = p ? JSON.stringify(p) : null;
        await db.query(sql, [name, m, payload, s]);
        
        return true;
    }

    async _restoreDesiredRuntimeStates() {
        if (!db.hasDbConfig()) return;
        try {
            const { rows } = await db.query(
                `SELECT name
                 FROM strategies
                 WHERE runtime_state = 'RUNNING'
                 ORDER BY name ASC`
            );
            for (const row of rows || []) {
                const id = String(row?.name || "").trim();
                if (!id || !this.registry.has(id)) continue;
                await this.startStrategy(id);
            }
            if ((rows || []).length > 0) {
                log.info(`[RESTORE] Requested resume for ${(rows || []).length} strategies marked RUNNING`);
            }
        } catch (err) {
            log.warn(`[RESTORE] Failed to restore runtime states: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERY & DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get all booted strategies
     * @returns {Map<string, BootedStrategy>}
     */
    getAllStrategies() {
        return this.registry;
    }

    /**
     * Get a specific booted strategy
     * @param {string} id - Strategy ID
     * @returns {BootedStrategy|null}
     */
    getStrategy(id) {
        return this.registry.get(id) || null;
    }

    /**
     * Get active symbols from all booted strategies
     * @returns {string[]}
     */
    getActiveSymbols() {
        const symbols = new Set();
        for (const [, booted] of this.registry) {
            if (booted.instance) {
                const strategySymbols = booted.instance.symbols || [];
                strategySymbols.forEach(s => symbols.add(s));
            }
        }
        return Array.from(symbols);
    }

    /**
     * Get boot statistics
     * @returns {object}
     */
    getBootStats() {
        return {
            ...this.bootStats,
            lifecycle: this.lifecycle.snapshot(),
            phaseMetrics: Array.from(this.bootStats.phaseMetrics.entries()).map(([phase, metrics]) => ({
                phase,
                ...metrics
            }))
        };
    }

    /**
     * Update phase metrics
     * @private
     */
    _updatePhaseMetrics(phase, timeMs) {
        const metrics = this.bootStats.phaseMetrics.get(phase) || { count: 0, totalMs: 0, avgMs: 0 };
        metrics.count++;
        metrics.totalMs += timeMs;
        metrics.avgMs = metrics.totalMs / metrics.count;
        this.bootStats.phaseMetrics.set(phase, metrics);
    }

    /**
     * Update average boot time
     * @private
     */
    _updateAverageBootTime() {
        const times = this.bootStats.bootTimes;
        if (times.length === 0) return;
        
        const sum = times.reduce((acc, t) => acc + t, 0);
        this.bootStats.averageBootTimeMs = sum / times.length;
        
        // Keep only last 100 boot times to prevent memory growth
        if (times.length > 100) {
            this.bootStats.bootTimes = times.slice(-100);
        }
    }

    /**
     * Log boot diagnostics
     * @private
     */
    _logBootDiagnostics() {
        const mem = process.memoryUsage();
        const stats = this.getBootStats();
        
        log.info(`Boot Diagnostics:`);
        log.info(`  Registry: ${this.registry.size} strategies`);
        log.info(`  Success Rate: ${stats.successfulBoots}/${stats.totalBoots} (${((stats.successfulBoots/stats.totalBoots)*100).toFixed(1)}%)`);
        log.info(`  Average Boot Time: ${stats.averageBootTimeMs.toFixed(2)}ms`);
        log.info(`  Memory: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}MB`);
        
        if (stats.phaseMetrics.length > 0) {
            log.info(`  Phase Metrics:`);
            stats.phaseMetrics.forEach(({ phase, count, avgMs }) => {
                log.info(`    ${phase}: ${count} executions, avg ${avgMs.toFixed(2)}ms`);
            });
        }
    }
}

// Export singleton instance
module.exports = new StrategyBootloader();
