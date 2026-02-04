"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');
const stateManager = require('@utils/stateController');

/**
 * Manages loading, reloading, starting, and stopping trading strategies.
 * It monitors a designated directory for strategy files and handles their lifecycle.
 */
class StrategyLoader {
    /**
     * @param {object} options - Configuration options for the loader.
     * @param {string} [options.strategiesDir='../strategies'] - Relative path to the strategies directory.
     * @param {string} [options.settingsDir='../data/settings'] - Relative path to the settings directory.
     */
    constructor(options = {}) {
        this.engine = null;
        this.strategiesPath = path.resolve(__dirname, options.strategiesDir || '../strategies');
        this.settingsPath = path.resolve(__dirname, options.settingsDir || '../data/settings');

        // Main storage: id → { instance, filePath, mtime }
        this.registry = new Map();

        this.watcher = null;
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY_MS = 150; // Delay for file watcher debounce

        // Simple stats for diagnostics
        this.stats = {
            loads: 0,
            reloads: 0,
            loadTimesMs: [] // Could be used for average/max load time
        };

        // Ensure directories exist, create if not
        [this.strategiesPath, this.settingsPath].forEach(p => {
            try {
                if (!fs.existsSync(p)) {
                    fs.mkdirSync(p, { recursive: true });
                    logger.info(`Created missing directory: ${p}`);
                }
            } catch (err) {
                logger.error(`Failed to ensure directory ${p} exists: ${err.message}`);
                // Depending on criticality, might throw or exit here
            }
        });

        logger.info(`StrategyLoader initialized (strategies: ${this.strategiesPath}, settings: ${this.settingsPath})`);

        // Auto-save params when strategy requests it
        bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, e => {
            logger.debug(`EVENT: SETTINGS_UPDATED for ${e.id}`);
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
            logger.info(`Diagnostics${context ? ' - ' + context : ''}: registry=${this.registry.size}, rss=${Math.round(mem.rss/1024/1024)}MB, heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB`);
        } catch (e) {
            logger.debug(`Diagnostics logging failed: ${e.message}`);
        }
    }

    /**
     * Initializes the StrategyLoader, loads all existing strategies, and starts the file watcher.
     * @param {object} engine - The core trading engine instance.
     * @returns {string[]} An array of active symbols from currently loaded strategies.
     */
    init(engine) {
        if (!engine) {
            throw new Error('StrategyLoader requires an engine instance for initialization.');
        }
        this.engine = engine;
        logger.info('StrategyLoader init starting');
        const t0 = process.hrtime.bigint();

        this._loadAll();
        this._startWatcher();

        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        logger.info(`StrategyLoader init completed in ${ms.toFixed(2)}ms, loaded=${this.registry.size} strategies`);
        this._logDiagnostics('init');

        return this.getActiveSymbols();
    }

    // ─── Fast & safe loading ───────────────────────────────────────

    /**
     * Loads all strategy files from the strategies directory.
     * @private
     */
    _loadAll() {
        const t0 = Date.now();
        let files = [];
        try {
            files = fs.readdirSync(this.strategiesPath)
                .filter(f => f.endsWith('.js'));
        } catch (err) {
            logger.error(`Failed to read strategies directory (${this.strategiesPath}): ${err.message}`);
            return;
        }

        logger.info(`Found ${files.length} strategy files, attempting to load...`);

        for (const file of files) {
            this._loadOne(path.join(this.strategiesPath, file));
        }

        const t1 = Date.now();
        logger.info(`Loaded ${this.registry.size} strategies in ${t1 - t0}ms (total files found: ${files.length})`);
        this._logDiagnostics('_loadAll');
    }

    /**
     * Loads or reloads a single strategy file.
     * This method is refactored into smaller, more focused private helpers.
     * @param {string} filePath - The full path to the strategy file.
     * @private
     */
    _loadOne(filePath) {
        const start = process.hrtime.bigint();
        const id = path.basename(filePath, '.js');
        logger.debug(`Attempting to load/reload strategy: ${id} from ${filePath}`);

        try {
            const stat = fs.statSync(filePath);
            const existing = this.registry.get(id);

            // 1. Skip if unchanged
            if (existing && existing.mtime >= stat.mtimeMs) {
                logger.debug(`Strategy ${id} unchanged, skipping reload.`);
                return;
            }

            // 2. Security Validation
            const code = fs.readFileSync(filePath, 'utf8');
            if (!validateStrategyCode(code)) {
                logger.error(`Security validation failed for strategy → ${id}. File: ${filePath}`);
                stateManager.commit(id, 'ERROR', { reason: 'security check failed' });
                return;
            }

            // 3. Prepare for reload (cleanup existing instance if any)
            this._prepareForReload(id, existing);

            // 4. Initialize Strategy Instance
            const instance = this._instantiateStrategy(filePath, id);
            if (!instance) {
                // Error already logged in _instantiateStrategy
                stateManager.commit(id, 'ERROR', { reason: 'instantiation failed' });
                return;
            }

            // 5. Apply saved parameters and defaults
            this._applyStrategySettings(instance, id);

            // 6. Update Registry
            this.registry.set(id, {
                instance,
                filePath,
                mtime: stat.mtimeMs
            });

            // 7. State Management & Post-load actions
            this._handlePostLoadActions(id, existing, stat, start);

        } catch (err) {
            logger.error(`Failed to load strategy [${id}]: ${err.message}`);
            stateManager.commit(id, 'ERROR', { reason: err.message.slice(0, 120) });
        }
    }

    /**
     * Prepares the environment for a strategy reload by unregistering from the engine
     * and clearing the require cache.
     * @param {string} id - The ID of the strategy.
     * @param {object} existing - The existing strategy entry from the registry, if any.
     * @private
     */
    _prepareForReload(id, existing) {
        if (existing && this.engine) {
            logger.info(`♻️ Purging existing engine instance for ${id} before reload`);
            this.engine.unregisterStrategy(id);
        }

        // Clear require cache to ensure fresh load
        try {
            const resolved = require.resolve(existing ? existing.filePath : path.join(this.strategiesPath, `${id}.js`));
            if (require.cache[resolved]) {
                delete require.cache[resolved];
                logger.debug(`Cleared require cache for ${id}`);
            }
        } catch (e) {
            logger.debug(`Could not clear require cache for ${id}: ${e.message}`);
        }
    }

    /**
     * Instantiates the strategy class from the given file path.
     * @param {string} filePath - The full path to the strategy file.
     * @param {string} id - The ID of the strategy.
     * @returns {object|null} The instantiated strategy object, or null if an error occurred.
     * @private
     */
    _instantiateStrategy(filePath, id) {
        try {
            const StrategyClass = require(filePath);
            
            // Pass the ID into constructor so internal name = filename
            const instance = typeof StrategyClass === 'function'
                ? new StrategyClass({ name: id, id: id })
                : StrategyClass; // Support direct module exports

            // Force override IDs to prevent "Split Identity"
            instance.id = id;
            instance.name = id;
            return instance;
        } catch (err) {
            logger.error(`Failed to instantiate strategy [${id}] from ${filePath}: ${err.message}`);
            return null;
        }
    }

    /**
     * Loads and applies saved parameters and default settings to the strategy instance.
     * @param {object} instance - The strategy instance.
     * @param {string} id - The ID of the strategy.
     * @private
     */
    _applyStrategySettings(instance, id) {
        const saved = this._loadParams(id);
        if (saved) {
            instance.updateParams?.(saved);
        }
        instance._applyDefaults?.(); // Apply internal defaults if method exists
    }

    /**
     * Handles state management, logging, metrics, and auto-restart after a strategy is loaded.
     * @param {string} id - The ID of the strategy.
     * @param {object|undefined} existing - The existing strategy entry from the registry, if any.
     * @param {fs.Stats} stat - File system stats for the strategy file.
     * @param {bigint} loadStartTime - The `process.hrtime.bigint()` timestamp when loading started.
     * @private
     */
    _handlePostLoadActions(id, existing, stat, loadStartTime) {
        const currentStatus = stateManager.getStatus(id);
        if (!currentStatus || currentStatus === 'OFFLINE' || currentStatus === 'ERROR') {
            stateManager.commit(id, 'STAGED', { reason: 'loaded' });
        }

        this.stats.loads += 1;
        if (existing) this.stats.reloads += 1;
        const msTotal = Number(process.hrtime.bigint() - loadStartTime) / 1e6;
        this.stats.loadTimesMs.push(msTotal); // Store for potential average/max calculation

        logger.info(`Strategy ${existing ? 're' : ''}loaded: ${id} (${msTotal.toFixed(2)}ms)`);

        // Auto-restart if it was ACTIVE before reload
        if (currentStatus === 'ACTIVE' && this.engine) {
            logger.info(`Strategy ${id} was ACTIVE, attempting auto-restart.`);
            this.startStrategy(id); // This will re-register with the engine
        }

        bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id });
    }

    // ─── File watcher with proper debounce ─────────────────────────

    /**
     * Starts watching the strategies directory for changes.
     * @private
     */
    _startWatcher() {
        if (this.watcher) {
            logger.debug('Watcher already started, skipping.');
            return;
        }

        logger.info(`Starting file watcher on ${this.strategiesPath}`);
        try {
            this.watcher = fs.watch(this.strategiesPath, (event, filename) => {
                logger.debug(`Watcher event: ${event} ${filename}`);
                if (!filename || !filename.endsWith('.js')) {
                    logger.debug(`Ignoring non-js file event: ${filename}`);
                    return;
                }

                // Debounce multiple quick edits to avoid redundant reloads
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    const fullPath = path.join(this.strategiesPath, filename);
                    const id = path.basename(filename, '.js');

                    if (fs.existsSync(fullPath)) {
                        logger.info(`Detected change/add for ${id}, reloading strategy.`);
                        this._loadOne(fullPath);
                    } else {
                        // File was removed
                        logger.info(`Detected removal of ${id}, stopping and removing from registry.`);
                        this.stopStrategy(id); // Ensure it's stopped gracefully
                        this.registry.delete(id);
                        stateManager.commit(id, 'OFFLINE', { reason: 'file removed' });
                        this._logDiagnostics('file removed');
                        bus.emit(EVENTS.SYSTEM.STRATEGY_UNLOADED, { id });
                    }
                }, this.DEBOUNCE_DELAY_MS);
            });
            logger.info('File watcher started successfully.');
        } catch (err) {
            logger.error(`Failed to start file watcher on ${this.strategiesPath}: ${err.message}`);
            // Depending on criticality, might throw or exit here
        }
    }

    // ─── Persistence (only when needed) ───────────────────────────

    /**
     * Saves strategy parameters to a JSON file.
     * @param {string} id - The ID of the strategy.
     * @param {object} params - The parameters to save.
     * @private
     */
    _saveParams(id, params) {
        if (!params || typeof params !== 'object' || Object.keys(params).length === 0) {
            logger.debug(`_saveParams called with invalid or empty params for ${id}, skipping save.`);
            return;
        }

        const file = path.join(this.settingsPath, `settings_${id}.json`);
        try {
            fs.writeFileSync(file, JSON.stringify(params, null, 2), 'utf8');
            logger.info(`Saved settings for ${id} to ${file}`);
        } catch (err) {
            logger.warn(`Cannot save settings for ${id} to ${file}: ${err.message}`);
        }
    }

    /**
     * Loads strategy parameters from a JSON file.
     * @param {string} id - The ID of the strategy.
     * @returns {object|null} The loaded parameters, or null if not found or an error occurred.
     * @private
     */
    _loadParams(id) {
        const file = path.join(this.settingsPath, `settings_${id}.json`);
        if (!fs.existsSync(file)) {
            logger.debug(`No saved settings file found for ${id} at ${file}`);
            return null;
        }
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            logger.debug(`Loaded saved settings for ${id} from ${file}`);
            return data;
        } catch (err) {
            logger.warn(`Failed to load saved settings for ${id} from ${file}: ${err.message}`);
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
        logger.info(`startStrategy requested for ${id} with options=${JSON.stringify(options)}`);
        const entry = this.registry.get(id);
        
        if (!entry) {
            logger.warn(`startStrategy: Strategy [${id}] not found in registry.`);
            return null;
        }

        const currentStatus = stateManager.getStatus(id);
        
        // Define states from which a strategy can transition to 'WARMING_UP'/'ACTIVE'
        const transitionableStates = ['STAGED', 'PAUSED', 'ERROR', 'OFFLINE'];
        
        if (!transitionableStates.includes(currentStatus)) {
            logger.warn(`startStrategy: Strategy [${id}] is currently ${currentStatus}. Ignoring start request.`);
            return entry;
        }

        // Apply Runtime Configuration
        entry.instance.mode = (options.mode || entry.instance.mode || 'PAPER').toUpperCase();
        entry.instance.timeframe = options.timeframe || entry.instance.timeframe || '1m';
        entry.instance.enabled = true;
        entry.instance.startTime = Date.now(); // Record start time for uptime calculation

        // 1. Initial State update to inform UI we are working on it
        stateManager.commit(id, 'WARMING_UP', { reason: 'Loader passing control to Engine' });

        // 2. Hand over to Engine for Market Connection
        if (this.engine) {
            // We don't await this here to keep the UI responsive; 
            // the Engine will update the state to ACTIVE/ERROR when done.
            this.engine.registerStrategy(entry.instance, options)
                .then(success => {
                    if (success) {
                        logger.info(`🚀 [${id}] Strategy successfully deployed to engine.`);
                        bus.emit(EVENTS.SYSTEM.STRATEGY_START, { id, mode: entry.instance.mode });
                    } else {
                        logger.error(`[${id}] Engine registration failed (returned false).`);
                        stateManager.commit(id, 'ERROR', { reason: 'Engine registration failed' });
                    }
                })
                .catch(err => {
                    logger.error(`[${id}] Engine handover failed: ${err.message}`);
                    stateManager.commit(id, 'ERROR', { reason: `Engine handover failed: ${err.message.slice(0, 100)}` });
                });
        } else {
            logger.error(`[${id}] Failed to start: Engine instance not found in Loader.`);
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
        logger.info(`stopStrategy requested for ${id}`);
        const entry = this.registry.get(id);
        if (!entry) {
            logger.warn(`stopStrategy: No entry found for strategy [${id}] in registry.`);
            return null;
        }

        const currentStatus = stateManager.getStatus(id);
        if (currentStatus === 'OFFLINE' || currentStatus === 'STOPPING') {
            logger.debug(`stopStrategy: Strategy [${id}] is already ${currentStatus}. Ignoring request.`);
            return entry;
        }

        stateManager.commit(id, 'STOPPING', { reason: 'User requested stop' });

        entry.instance.enabled = false; // Signal strategy to stop internal operations
        const t0 = process.hrtime.bigint();
        this.engine?.unregisterStrategy(id); // Optional chaining for robustness
        const t1 = process.hrtime.bigint();
        stateManager.commit(id, 'OFFLINE', { reason: 'Stopped by user/system' });

        const unregisterTimeMs = Number(t1 - t0) / 1e6;
        logger.info(`Unregistered strategy ${id} (engine unregister took ${unregisterTimeMs.toFixed(2)}ms)`);
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
        if (!instance || !instance.data || typeof instance.data.forEach !== 'function') return 0;
        let total = 0;
        instance.data.forEach((store) => {
            if (store?.candles?.size != null) total += store.candles.size;
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
        logger.debug(`getActiveSymbols returned ${symbols.size} unique symbols.`);
        return Array.from(symbols);
    }

    /**
     * Public method to manually reload a specific strategy.
     * This is useful for API calls or manual intervention.
     * @param {string} id - The ID of the strategy to reload.
     * @returns {boolean} True if the reload was initiated, false otherwise.
     */
    reloadStrategy(id) {
        const entry = this.registry.get(id);
        if (!entry) {
            logger.warn(`reloadStrategy: Strategy [${id}] not found in registry.`);
            return false;
        }
        
        // Stop it if it's currently running to prevent logic leaks or resource conflicts
        logger.info(`Reloading strategy ${id}: stopping existing instance before re-loading.`);
        this.stopStrategy(id);
        
        // Use the internal loader to re-process the file
        this._loadOne(entry.filePath);
        return true;
    }

    /**
     * Shuts down the StrategyLoader, stopping all strategies and closing the file watcher.
     */
    shutdown() {
        logger.info('StrategyLoader shutdown initiated.');
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            logger.info('File watcher closed.');
        }
        clearTimeout(this.debounceTimer); // Clear any pending debounce timers

        // Stop all strategies gracefully
        for (const [id] of this.registry) {
            try {
                this.stopStrategy(id);
            } catch (e) {
                logger.warn(`Error stopping strategy ${id} during shutdown: ${e.message}`);
            }
        }
        this.registry.clear();
        logger.info('StrategyLoader shutdown complete, registry cleared.');
        this._logDiagnostics('shutdown');
    }
}

// Export a singleton instance for simplicity, or allow instantiation with options
module.exports = new StrategyLoader();
