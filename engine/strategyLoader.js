"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { bus, EVENTS } = require('../events/bus');

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
     * LIFECYCLE: Load/Reload with State & Parameter Preservation
     */
    loadStrategy(filePath) {
        const strategyId = path.basename(filePath, '.js');
        const existingEntry = this.registry.get(strategyId);

        // Preserve current operational state
        const previousStatus = existingEntry ? existingEntry.status : 'IDLE';
        const wasEnabled = existingEntry ? existingEntry.instance.enabled : false;

        try {
            delete require.cache[require.resolve(filePath)];
            const StrategyClass = require(filePath);
            
            const instance = (typeof StrategyClass === 'function') 
                ? new StrategyClass() 
                : StrategyClass;

            instance.id = strategyId;
            instance.enabled = wasEnabled;

            // --- PARAMETER INJECTION ---
            // 1. First, apply code defaults
            if (typeof instance._applyDefaults === 'function') instance._applyDefaults();
            
            // 2. Second, override with saved UI settings from its own JSON file
            const savedParams = this._getSavedParams(strategyId);
            if (savedParams && typeof instance.updateParams === 'function') {
                instance.updateParams(savedParams);
            }

            this.registry.set(strategyId, {
                id: strategyId,
                instance: instance,
                status: previousStatus,
                filePath: filePath
            });

            logger.info(`✅ Strategy [${strategyId}] ${existingEntry ? 'Hot-Reloaded' : 'Staged'}`);
            bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id: strategyId });

        } catch (err) {
            logger.error(`❌ Load Error [${strategyId}]: ${err.message}`);
        }
    }

    // --- FS WATCHER & BULK LOADING ---
    _watchStrategies() {
        if (this.watcher) return;
        this.watcher = fs.watch(this.strategiesPath, (event, filename) => {
            if (!filename || !filename.endsWith('.js')) return;
            const fullPath = path.join(this.strategiesPath, filename);
            fs.existsSync(fullPath) ? this.loadStrategy(fullPath) : this.registry.delete(path.basename(filename, '.js'));
        });
    }

    reloadAll() {
        if (!fs.existsSync(this.strategiesPath)) fs.mkdirSync(this.strategiesPath, { recursive: true });
        fs.readdirSync(this.strategiesPath)
          .filter(f => f.endsWith('.js'))
          .forEach(file => this.loadStrategy(path.join(this.strategiesPath, file)));
    }

    // --- CONTROL PLANE ---

    startStrategy(id) {
        const entry = this.registry.get(id);
        if (!entry || entry.status === 'RUNNING') return entry;

        entry.status = 'RUNNING';
        entry.instance.enabled = true;
        entry.instance.startTime = Date.now();

        if (this.engine) this.engine.registerStrategy(entry.instance);
        
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
        return Array.from(symbols);
    }
}

module.exports = new StrategyLoader();