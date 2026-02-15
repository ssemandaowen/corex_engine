"use strict";

const Module = require('module');
const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');
const stateManager = require('@utils/stateController');
const { verifyStrategyFile } = require('@core/services/hashVerifier');
const db = require('@core/services/postgres');
const { compile } = require("@core/services/strategyCompiler");

const MODULE = "STRATEGY_LOADER";
const log = {
    info: (message, meta) => logger.info(`[${MODULE}][INFO] ${message}`, meta),
    warn: (message, meta) => logger.warn(`[${MODULE}][WARN] ${message}`, meta),
    error: (message, meta) => logger.error(`[${MODULE}][ERROR] ${message}`, meta),
    debug: (message, meta) => logger.debug(`[${MODULE}][DEBUG] ${message}`, meta)
};

/**
 * Manages loading, reloading, starting, and stopping trading strategies.
 * It loads strategies from the database and handles their lifecycle.
 */
class StrategyLoader {
    constructor(options = {}) {
        this.engine = null;
        this.options = options;

        // Main storage: id -> { instance, source, updatedAt }
        this.registry = new Map();

        // Simple stats for diagnostics
        this.stats = {
            loads: 0,
            reloads: 0,
            loadTimesMs: [] // Could be used for average/max load time
        };

        log.info(`StrategyLoader initialized`);

        // Auto-save params when strategy requests it
        bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, e => {
            log.debug(`EVENT: SETTINGS_UPDATED for ${e.id}`);
            this._saveParams(e.id, e.params);
        });
    }

    /**
     * Helper: log memory and registry snapshot for diagnostics.
     * @param {string} [context=''] - Additional context for the log message.
     * @private
     */
    _logDiagnostics(context = '') {
        try {
            const mem = process.memoryUsage();
            log.info(`Diagnostics${context ? ' - ' + context : ''}: registry=${this.registry.size}, rss=${Math.round(mem.rss/1024/1024)}MB, heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB`);
        } catch (e) {
            log.debug(`Diagnostics logging failed: ${e.message}`);
        }
    }

    /**
     * Initializes the StrategyLoader and loads all DB strategies.
     * @param {object} engine - The core trading engine instance.
     * @returns {string[]} An array of active symbols from currently loaded strategies.
     */
    async init(engine) {
        if (!engine) {
            throw new Error('StrategyLoader requires an engine instance for initialization.');
        }
        this.engine = engine;
        log.info('StrategyLoader init starting');
        const t0 = process.hrtime.bigint();

        await this._loadAll();

        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        log.info(`StrategyLoader init completed in ${ms.toFixed(2)}ms, loaded=${this.registry.size} strategies`);
        this._logDiagnostics('init');

        return this.getActiveSymbols();
    }

    // ─── Fast & safe loading ───────────────────────────────────────

    /**
     * Loads all strategies from the database.
     * @private
     */
    async _loadAll() {
        const t0 = Date.now();
        let rows = [];
        try {
            const res = await db.query(
                `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_updated_at
                 FROM strategies
                 WHERE script_body IS NOT NULL
                 ORDER BY name ASC`
            );
            rows = res.rows || [];
        } catch (err) {
            log.error(`[DB] Failed to read strategies: ${err.message}`);
            return;
        }

        log.info(`Found ${rows.length} strategies in DB, attempting to load...`);

        for (const row of rows) {
            await this._loadOne(row);
        }

        const t1 = Date.now();
        log.info(`Loaded ${this.registry.size} strategies in ${t1 - t0}ms (total found: ${rows.length})`);
        this._logDiagnostics('_loadAll');
    }

    /**
     * Loads or reloads a single strategy from a DB record.
     * @param {object} record
     * @param {string} record.name
     * @param {string} record.script_body
     * @param {string|Date} [record.updated_at]
     * @private
     */
    async _loadOne(record) {
        const start = process.hrtime.bigint();
        const id = String(record?.name || '').trim();
        const code = String(record?.script_body || '');
        const updatedAt = record?.updated_at ? new Date(record.updated_at).getTime() : Date.now();

        if (!id || !code) {
            log.warn(`[DB] Skipping invalid strategy record: ${id || 'unknown'}`);
            return;
        }

        log.debug(`Attempting to load/reload strategy: ${id} from DB`);

        try {
            const existing = this.registry.get(id);

            // 1. Skip if unchanged
            if (existing && existing.updatedAt >= updatedAt) {
                log.debug(`Strategy ${id} unchanged, skipping reload.`);
                return;
            }

            // 2. Hash Verification (optional, DB-backed)
            const verify = await verifyStrategyFile({
                strategyName: id,
                filePath: null,
                code
            });
            if (!verify.ok) {
                log.error(`Hash verification failed for strategy -> ${id}. Reason: ${verify.reason}`);
                stateManager.commit(id, 'ERROR', { reason: `hash check failed: ${verify.reason}` });
                return;
            }

            // 3. Security Validation
            if (!validateStrategyCode(code)) {
                log.error(`Security validation failed for strategy -> ${id}.`);
                stateManager.commit(id, 'ERROR', { reason: 'security check failed' });
                return;
            }

            // 4. Prepare for reload (cleanup existing instance if any)
            this._prepareForReload(id, existing);

            // 5. Initialize Strategy Instance
            const instance = this._instantiateStrategy(code, id);
            if (!instance) {
                stateManager.commit(id, 'ERROR', { reason: 'instantiation failed' });
                return;
            }

            const compiled = compile(instance);
            if (!compiled.ok) {
                stateManager.commit(id, 'ERROR', { reason: compiled.reason });
                return;
            }

            // 6. Apply saved parameters and defaults
            this._applyStrategySettings(instance, id, record);

            // 7. Update Registry
            this.registry.set(id, {
                instance,
                source: code,
                updatedAt,
                runtimeUpdatedAt: record?.runtime_updated_at ? new Date(record.runtime_updated_at).getTime() : 0,
                lastRuntimeSync: 0
            });

            // 8. State Management & Post-load actions
            this._handlePostLoadActions(id, existing, start);

        } catch (err) {
            log.error(`Failed to load strategy [${id}]: ${err.message}`);
            stateManager.commit(id, 'ERROR', { reason: err.message.slice(0, 120) });
        }
    }

    async _loadByName(id) {
        const name = String(id || '').trim();
        if (!name) return false;
        const { rows } = await db.query(
            `SELECT name, script_body, updated_at
             FROM strategies
             WHERE name = $1
             LIMIT 1`,
            [name]
        );
        if (!rows[0]) return false;
        await this._loadOne(rows[0]);
        return true;
    }

    /**
     * Prepares the environment for a strategy reload by unregistering from the engine
     * 
     * @param {string} id - The ID of the strategy.
     * @param {object} existing - The existing strategy entry from the registry, if any.
     * @private
     */
    _prepareForReload(id, existing) {
        if (existing && this.engine) {
            log.info(`Purging existing engine instance for ${id} before reload`);
            this.engine.unregisterStrategy(id);
        }
    }

    /**
     * Instantiates the strategy class from the provided source code.
     * @param {string} code - Strategy source code.
     * @param {string} id - The ID of the strategy.
     * @returns {BaseStrategy|null} The instantiated strategy object, or null if an error occurred.
     * @private
     */
    _instantiateStrategy(code, id) {
        try {
            const filename = `db://strategies/${id}.js`;
            const mod = new Module(filename, module);
            mod.filename = filename;
            mod.paths = Module._nodeModulePaths(process.cwd());
            mod._compile(code, filename);
            const StrategyClass = mod.exports;
            if (typeof StrategyClass !== 'function' || !StrategyClass.prototype) {
                log.error(`Strategy [${id}] does not export a class.`);
                return null;
            }

            const instance = new StrategyClass();
            instance.id = instance.name = id;
            this._standardizeInterface(instance);
            return instance;
        } catch (err) {
            log.error(`Failed to instantiate strategy [${id}] from DB: ${err.message}`);
            return null;
        }
    }

    _standardizeInterface(instance) {
        if (!instance || instance.__corexStandardized) return;
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

        instance.__corexStandardized = true;
    }

    /**
     * Loads and applies saved parameters and default settings to the strategy instance.
     * @param {object} instance - The strategy instance.
     * @param {string} id - The ID of the strategy.
     * @private
     */
    _applyStrategySettings(instance, id, record = null) {
        if (record?.runtime_params && typeof record.runtime_params === "object") {
            const params = record.runtime_params;
            if (Object.keys(params).length > 0) {
                instance.updateParams?.(params);
            }
        }
        if (record?.runtime_mode) {
            instance.mode = String(record.runtime_mode).toUpperCase();
        }
        instance._applyDefaults?.(); // Apply internal defaults if method exists
    }

    async _updateRuntimeStateInDb(id, { mode, params } = {}) {
        if (!db.hasDbConfig()) return false;
        const name = String(id || "").trim();
        if (!name) return false;
        const m = mode ? String(mode).toUpperCase() : null;
        const p = params && typeof params === "object" ? params : null;

        const sql = `
            UPDATE strategies
            SET runtime_mode = COALESCE($2, runtime_mode),
                runtime_params = CASE WHEN $3::jsonb IS NULL THEN runtime_params ELSE $3::jsonb END,
                runtime_updated_at = NOW()
            WHERE name = $1
        `;
        const payload = p ? JSON.stringify(p) : null;
        await db.query(sql, [name, m, payload]);
        return true;
    }

    async syncRuntimeState(id) {
        const entry = this.registry.get(id);
        if (!entry) return;
        if (!db.hasDbConfig()) return;

        try {
            const { rows } = await db.query(
                `SELECT runtime_mode, runtime_params, runtime_updated_at
                 FROM strategies
                 WHERE name = $1
                 LIMIT 1`,
                [String(id || "").trim()]
            );
            const row = rows[0];
            if (!row) return;

            const updatedAt = row.runtime_updated_at ? new Date(row.runtime_updated_at).getTime() : 0;
            if (updatedAt && entry.runtimeUpdatedAt && updatedAt <= entry.runtimeUpdatedAt) return;

            if (row.runtime_mode) {
                entry.instance.mode = String(row.runtime_mode).toUpperCase();
                if (this.engine && typeof this.engine._setupExecutionContext === "function") {
                    this.engine._setupExecutionContext(entry.instance);
                }
            }

            const params = row.runtime_params && typeof row.runtime_params === "object" ? row.runtime_params : null;
            if (params && Object.keys(params).length > 0) {
                entry.instance.updateParams?.(params);
            }

            entry.runtimeUpdatedAt = updatedAt || Date.now();
            entry.lastRuntimeSync = Date.now();
        } catch (err) {
            log.warn(`Runtime sync failed for ${id}: ${err.message}`);
        }
    }

    /**
     * Handles state management, logging, metrics, and auto-restart after a strategy is loaded.
     * @param {string} id - The ID of the strategy.
     * @param {object|undefined} existing - The existing strategy entry from the registry, if any.
     * @param {bigint} loadStartTime - The `process.hrtime.bigint()` timestamp when loading started.
     * @private
     */
    _handlePostLoadActions(id, existing, loadStartTime) {
        const currentStatus = stateManager.getStatus(id);
        if (!currentStatus || currentStatus === 'OFFLINE' || currentStatus === 'ERROR') {
            stateManager.commit(id, 'STAGED', { reason: 'loaded' });
        }

        this.stats.loads += 1;
        if (existing) this.stats.reloads += 1;
        const msTotal = Number(process.hrtime.bigint() - loadStartTime) / 1e6;
        this.stats.loadTimesMs.push(msTotal); // Store for potential average/max calculation

        log.info(`Strategy ${existing ? 're' : ''}loaded: ${id} (${msTotal.toFixed(2)}ms)`);

        // Auto-restart if it was ACTIVE before reload
        if (currentStatus === 'ACTIVE' && this.engine) {
            log.info(`Strategy ${id} was ACTIVE, attempting auto-restart.`);
            this.startStrategy(id); // This will re-register with the engine
        }

        bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id });
    }

    // File watcher (disabled for DB strategies)

    /**
     * File watcher disabled (strategies are DB-backed).
     * @private
     */
    _startWatcher() {
        log.info('StrategyLoader watcher disabled (DB-backed).');
    }

    // Persistence (only when needed) ───────────────────────────

    /**
     * Saves strategy parameters to a JSON file.
     * @param {string} id - The ID of the strategy.
     * @param {object} params - The parameters to save.
     * @private
     */
    _saveParams(id, params) {
        if (!params || typeof params !== 'object') {
            log.debug(`_saveParams called with invalid params for ${id}, skipping save.`);
            return;
        }
        this._updateRuntimeStateInDb(id, { params }).catch((err) => {
            log.warn(`DB param save failed for ${id}: ${err.message}`);
        });
    }

    /**
     * Loads strategy parameters from a JSON file.
     * @param {string} id - The ID of the strategy.
     * @returns {object|null} The loaded parameters, or null if not found or an error occurred.
     * @private
     */
    _loadParams(id) {
        if (!db.hasDbConfig()) return null;
        try {
            const name = String(id || '').trim();
            if (!name) return null;
            return db.query(
                `SELECT runtime_params FROM strategies WHERE name = $1 LIMIT 1`,
                [name]
            ).then(({ rows }) => rows[0]?.runtime_params || null)
                .catch(() => null);
        } catch {
            return null;
        }
    }

    // ─── Control methods ──────────────────────────────────────────

    /**
     * Starts a strategy by registering it with the trading engine.
     * @param {string} id - The ID of the strategy to start.
     * @param {object} [options={}] - Runtime options for the strategy (e.g., mode, timeframe).
     * @returns {object|null} The strategy entry from the registry, or null if not found.
     */
    startStrategy(id, options = {}) {
        log.info(`startStrategy requested for ${id} with options=${JSON.stringify(options)}`);
        const entry = this.registry.get(id);
        
        if (!entry) {
            log.warn(`startStrategy: Strategy [${id}] not found in registry.`);
            return null;
        }

        const currentStatus = stateManager.getStatus(id);
        
        // Define states from which a strategy can transition to 'WARMING_UP'/'ACTIVE'
        const transitionableStates = ['STAGED', 'PAUSED', 'ERROR', 'OFFLINE'];
        
        if (!transitionableStates.includes(currentStatus)) {
            log.warn(`startStrategy: Strategy [${id}] is currently ${currentStatus}. Ignoring start request.`);
            return entry;
        }

        // Apply Runtime Configuration
        entry.instance.mode = (options.mode || entry.instance.mode || 'PAPER').toUpperCase();
        entry.instance.timeframe = options.timeframe || entry.instance.timeframe || '1m';
        entry.instance.enabled = true;
        entry.instance.startTime = Date.now(); // Record start time for uptime calculation

        // 1. Initial State update to inform UI we are working on it
        stateManager.commit(id, 'WARMING_UP', { reason: 'Loader passing control to Engine' });

        this._updateRuntimeStateInDb(id, {
            mode: entry.instance.mode,
            params: options.strategyParams || entry.instance.params || {}
        }).catch(() => {});

        // 2. Hand over to Engine for Market Connection
        if (this.engine) {
            // We don't await this here to keep the UI responsive; 
            // the Engine will update the state to ACTIVE/ERROR when done.
            this.engine.registerStrategy(entry.instance, options)
                .then(success => {
                    if (success) {
                        log.info(`🚀 [${id}] Strategy successfully deployed to engine.`);
                        bus.emit(EVENTS.SYSTEM.STRATEGY_START, { id, mode: entry.instance.mode });
                    } else {
                        log.error(`[${id}] Engine registration failed (returned false).`);
                        stateManager.commit(id, 'ERROR', { reason: 'Engine registration failed' });
                    }
                })
                .catch(err => {
                    log.error(`[${id}] Engine handover failed: ${err.message}`);
                    stateManager.commit(id, 'ERROR', { reason: `Engine handover failed: ${err.message.slice(0, 100)}` });
                });
        } else {
            log.error(`[${id}] Failed to start: Engine instance not found in Loader.`);
            stateManager.commit(id, 'ERROR', { reason: 'Core Engine Missing' });
        }

        this._logDiagnostics(`start_attempt:${id}`);
        return entry;
    }

    /**
     * Stops a running strategy and unregisters it from the trading engine.
     * @param {string} id - The ID of the strategy to stop.
     * @returns {object|null} The strategy entry from the registry, or null if not found.
     */
    stopStrategy(id) {
        log.info(`stopStrategy requested for ${id}`);
        const entry = this.registry.get(id);
        if (!entry) {
            log.warn(`stopStrategy: No entry found for strategy [${id}] in registry.`);
            return null;
        }

        const currentStatus = stateManager.getStatus(id);
        if (currentStatus === 'OFFLINE' || currentStatus === 'STOPPING') {
            log.debug(`stopStrategy: Strategy [${id}] is already ${currentStatus}. Ignoring request.`);
            return entry;
        }

        stateManager.commit(id, 'STOPPING', { reason: 'User requested stop' });

        entry.instance.enabled = false; // Signal strategy to stop internal operations
        const t0 = process.hrtime.bigint();
        this.engine?.unregisterStrategy(id); // Optional chaining for robustness
        const t1 = process.hrtime.bigint();
        stateManager.commit(id, 'OFFLINE', { reason: 'Stopped by user/system' });

        const unregisterTimeMs = Number(t1 - t0) / 1e6;
        log.info(`Unregistered strategy ${id} (engine unregister took ${unregisterTimeMs.toFixed(2)}ms)`);
        bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id });

        this._logDiagnostics(`stop:${id}`);
        return entry;
    }

    // ─── Reports ──────────────────────────────────────────────────

    /**
     * Returns a list of all loaded strategies with their current status and basic info.
     * @returns {Array<object>} An array of strategy information objects.
     */
    listStrategies() {
        return Array.from(this.registry.values()).map(e => ({
            id: e.instance.id,
            name: e.instance.name || e.instance.id,
            status: stateManager.getStatus(e.instance.id),
            symbols: e.instance.symbols || [],
            timeframe: e.instance.timeframe || null,
            mode: e.instance.mode || null,
            uptime: e.instance.startTime ? Date.now() - e.instance.startTime : 0,
            lookback: e.instance.lookback || null,
            dataPoints: this._countDataPoints(e.instance),
            params: e.instance.params || {}, // Expose current parameters
            schema: (e.instance.schema && Object.keys(e.instance.schema).length > 0)
                ? e.instance.schema
                : this._inferSchemaFromParams(e.instance.params || {}) // Fallback for params-only strategies
        }));
    }

    _countDataPoints(instance) {
        if (!instance) return 0;
        const dm = instance.dataManager;
        if (!dm || !dm.data || typeof dm.data.forEach !== 'function') return 0;
        let total = 0;
        dm.data.forEach((store) => {
            if (store?.candles?.size != null) total += store.candles.size;
            if (store?.activeCandle) total += 1;
        });
        return total;
    }

    _inferSchemaFromParams(params) {
        const schema = {};
        for (const [key, value] of Object.entries(params || {})) {
            const t = typeof value;
            if (t === 'number') {
                schema[key] = { type: Number.isInteger(value) ? 'integer' : 'float', label: key, default: value };
            } else if (t === 'boolean') {
                schema[key] = { type: 'boolean', label: key, default: value };
            } else {
                schema[key] = { type: 'string', label: key, default: value };
            }
        }
        return schema;
    }

    /**
     * Retrieves a list of all unique symbols actively traded by currently ACTIVE strategies.
     * @returns {string[]} An array of unique trading symbols.
     */
    getActiveSymbols() {
        const symbols = new Set();
        for (const [id, entry] of this.registry) {
            if (stateManager.getStatus(id) === 'ACTIVE') {
                for (const s of entry.instance.symbols || []) {
                    symbols.add(s);
                }
            }
        }
        log.debug(`getActiveSymbols returned ${symbols.size} unique symbols.`);
        return Array.from(symbols);
    }

    /**
     * Public method to manually reload a specific strategy.
     * This is useful for API calls or manual intervention.
     * @param {string} id - The ID of the strategy to reload.
     * @returns {boolean} True if the reload was initiated, false otherwise.
     */
    async reloadStrategy(id) {
        const entry = this.registry.get(id);
        if (!entry) {
            log.warn(`reloadStrategy: Strategy [${id}] not found in registry.`);
            return false;
        }

        log.info(`Reloading strategy ${id}: stopping existing instance before re-loading.`);
        this.stopStrategy(id);

        const ok = await this._loadByName(id);
        if (!ok) {
            log.error(`Reload strategy failed [${id}]: DB record missing or invalid`);
        }
        return true;
    }

    /**
     * Shuts down the StrategyLoader, stopping all strategies.
     */
    shutdown() {
        log.info('StrategyLoader shutdown initiated.');

        // Stop all strategies gracefully
        for (const [id] of this.registry) {
            try {
                this.stopStrategy(id);
            } catch (e) {
                log.warn(`Error stopping strategy ${id} during shutdown: ${e.message}`);
            }
        }
        this.registry.clear();
        log.info('StrategyLoader shutdown complete, registry cleared.');
        this._logDiagnostics('shutdown');
    }
}

// Export a singleton instance for simplicity, or allow instantiation with options
module.exports = new StrategyLoader();

