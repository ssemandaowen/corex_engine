"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');

class StrategyLoader {
    constructor() {
        this.engine = null;
        this.strategiesPath = path.resolve(__dirname, '../strategies');
        this.settingsPath = path.resolve(__dirname, '../data/settings');
        this.registry = new Map(); // ID -> { instance, status, filePath }
        this.watcher = null;

        // Ensure settings directory exists
        if (!fs.existsSync(this.settingsPath)) {
            fs.mkdirSync(this.settingsPath, { recursive: true });
        }

        // --- 1. THE PERSISTENCE BRIDGE ---
        bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, (data) => {
            this._saveStrategySettings(data.id, data.params);
        });
    }

    init(engine) {
        logger.info('[====⚙️ Booting Strategy Loader====]');
        this.engine = engine;
        this.reloadAll();
        this._watchStrategies();
        return this.getActiveSymbols();
    }

    /**
     * @private
     * PERSISTENCE: Isolated file per strategy
     */
    _saveStrategySettings(id, params) {
        const file = path.join(this.settingsPath, `settings_${id}.json`);
        try {
            fs.writeFileSync(file, JSON.stringify(params, null, 4));
            logger.debug(`💾 Persisted isolated settings for: ${id}`);
        } catch (err) {
            logger.error(`❌ Persistence Failure [${id}]: ${err.message}`);
        }
    }

    /**
     * @private
     * RETRIEVAL: Load saved parameters if they exist
     */
    _getSavedParams(id) {
        const file = path.join(this.settingsPath, `settings_${id}.json`);
        if (fs.existsSync(file)) {
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (e) {
                logger.warn(`⚠️ Corrupt settings file for ${id}. Using defaults.`);
            }
        }
        return null;
    }

    /**
     * @private
     * CLEANUP: The "Ghost Hunter". Removes listeners and stops old logic.
     */
    _teardownInstance(strategyId) {
        const entry = this.registry.get(strategyId);
        if (entry && entry.instance) {
            entry.instance.enabled = false;
            // Clear internal data to free memory
            if (entry.instance.data) entry.instance.data.clear();
            logger.debug(`🧹 Teardown complete for: ${strategyId}`);
        }
    }

    /**
     * LIFECYCLE: Load/Reload with State & Parameter Preservation
     */
    loadStrategy(filePath) {
    const strategyId = path.basename(filePath, '.js');
    const existingEntry = this.registry.get(strategyId);

    // 1. Capture previous state
    const wasRunning = existingEntry?.status === 'RUNNING';
    const previousParams = existingEntry?.instance?.params || this._getSavedParams(strategyId);

    // 2. Perform Teardown
    if (existingEntry) this._teardownInstance(strategyId);

    try {
        // --- SECURITY VALIDATION STEP ---
        // Read the file content as a string to perform static analysis
        const codeString = fs.readFileSync(filePath, 'utf8');
        const { validateStrategyCode } = require('../utils/security');
        
        if (!validateStrategyCode(codeString)) {
            // Error is logged inside validateStrategyCode
            return; 
        }

        // 3. Clear Node Cache
        delete require.cache[require.resolve(filePath)];
        
        // 4. Load the Class
        const StrategyClass = require(filePath);

        const instance = (typeof StrategyClass === 'function')
            ? new StrategyClass()
            : StrategyClass;

        instance.id = strategyId;

        // 5. Parameter Injection & Warmup Integrity
        if (typeof instance._applyDefaults === 'function') instance._applyDefaults();

        if (previousParams && typeof instance.updateParams === 'function') {
            instance.updateParams(previousParams);
        }

        this.registry.set(strategyId, {
            id: strategyId,
            instance: instance,
            status: wasRunning ? 'RUNNING' : 'IDLE',
            filePath: filePath
        });

        logger.info(`✅ Strategy [${strategyId}] ${existingEntry ? 'Hot-Reloaded' : 'Staged'} (Security Passed)`);

        // 6. Automatic Re-Sync
        if (wasRunning && this.engine) {
            this.engine.registerStrategy(instance, previousParams);
        }

        bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id: strategyId });

    } catch (err) {
        logger.error(`❌ Load/Security Error [${strategyId}]: ${err.message}`);
    }
}

    // --- FS WATCHER & BULK LOADING ---
    _watchStrategies() {
        if (this.watcher) return;
        // Using a debounced watch to prevent multiple fires on single save
        let watchTimeout;
        this.watcher = fs.watch(this.strategiesPath, (event, filename) => {
            if (!filename || !filename.endsWith('.js')) return;

            clearTimeout(watchTimeout);
            watchTimeout = setTimeout(() => {
                const fullPath = path.join(this.strategiesPath, filename);
                if (fs.existsSync(fullPath)) {
                    this.loadStrategy(fullPath);
                } else {
                    this._teardownInstance(path.basename(filename, '.js'));
                    this.registry.delete(path.basename(filename, '.js'));
                }
            }, 100);
        });
    }

    reloadAll() {
        if (!fs.existsSync(this.strategiesPath)) fs.mkdirSync(this.strategiesPath, { recursive: true });
        fs.readdirSync(this.strategiesPath)
            .filter(f => f.endsWith('.js'))
            .forEach(file => this.loadStrategy(path.join(this.strategiesPath, file)));
    }

    // --- CONTROL PLANE ---
    startStrategy(id, params = {}) {
        const entry = this.registry.get(id);
        if (!entry) return null;

        // Force timeframe/interval into the instance before starting
        entry.instance.timeframe = params.interval || params.timeframe || entry.instance.timeframe || "1m";

        entry.status = 'RUNNING';
        entry.instance.enabled = true;
        entry.instance.startTime = Date.now();

        if (this.engine) this.engine.registerStrategy(entry.instance, params);

        bus.emit(EVENTS.SYSTEM.STRATEGY_START, { id, name: entry.instance.name });
        return entry;
    }

    stopStrategy(id) {
        const entry = this.registry.get(id);
        if (!entry || entry.status !== 'RUNNING') return entry;

        entry.status = 'STOPPED';
        entry.instance.enabled = false;

        if (this.engine) this.engine.unregisterStrategy(id);
        bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id });
        return entry;
    }

    // --- DATA VIEWS ---

    listStrategies() {
        return Array.from(this.registry.values()).map(e => ({
            id: e.id,
            name: e.instance.name,
            status: e.status,
            symbols: e.instance.symbols,
            uptime: e.instance.startTime ? Date.now() - e.instance.startTime : 0,
            params: e.instance.params,
            schema: e.instance.schema
        }));
    }

    getActiveSymbols() {
        const symbols = new Set();
        this.registry.forEach(e => {
            if (e.status === 'RUNNING') e.instance.symbols.forEach(s => symbols.add(s));
        });
        logger.info('[====Done Staging environment====]')
        return Array.from(symbols);
    }
}

module.exports = new StrategyLoader();