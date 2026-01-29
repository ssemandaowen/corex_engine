"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('@utils/logger');
const { bus, EVENTS } = require('@events/bus');
const { validateStrategyCode } = require('@utils/security');
const stateManager = require('@utils/stateController');

class StrategyLoader {
    constructor() {
        this.engine = null;
        this.strategiesPath = path.resolve(__dirname, '../strategies');
        this.settingsPath = path.resolve(__dirname, '../data/settings');

        // Main storage: id → { instance, filePath, mtime }
        this.registry = new Map();

        this.watcher = null;
        this.debounceTimer = null;

        // Simple stats for diagnostics
        this.stats = {
            loads: 0,
            reloads: 0,
            loadTimesMs: []
        };

        // Ensure directories
        [this.strategiesPath, this.settingsPath].forEach(p => {
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        });

        logger.info(`StrategyLoader initialized (strategies: ${this.strategiesPath}, settings: ${this.settingsPath})`);

        // Auto-save params when strategy requests it
        bus.on(EVENTS.SYSTEM.SETTINGS_UPDATED, e => {
            logger.debug && logger.debug(`EVENT: SETTINGS_UPDATED for ${e.id}`);
            this._saveParams(e.id, e.params);
        });
    }

    // Helper: log memory and registry snapshot
    _logDiagnostics(context = '') {
        try {
            const mem = process.memoryUsage();
            logger.info(`Diagnostics${context ? ' - ' + context : ''}: registry=${this.registry.size}, rss=${Math.round(mem.rss/1024/1024)}MB, heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB`);
        } catch (e) {
            logger.debug && logger.debug(`Diagnostics logging failed: ${e.message}`);
        }
    }

    init(engine) {
        this.engine = engine;
        logger.info('StrategyLoader init starting');
        const t0 = process.hrtime.bigint();

        this._loadAll();
        this._startWatcher();

        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        logger.info(`StrategyLoader init completed in ${ms.toFixed(2)}ms, loaded=${this.registry.size}`);
        this._logDiagnostics('init');

        return this.getActiveSymbols();
    }

    // ─── Fast & safe loading ───────────────────────────────────────

    _loadAll() {
        const t0 = Date.now();
        let files = [];
        try {
            files = fs.readdirSync(this.strategiesPath)
                .filter(f => f.endsWith('.js'));
        } catch (err) {
            logger.error(`Failed to read strategies dir: ${err.message}`);
            return;
        }

        logger.info(`Found ${files.length} strategy files, starting load`);

        for (const file of files) {
            this._loadOne(path.join(this.strategiesPath, file));
        }

        const t1 = Date.now();
        logger.info(`Loaded ${files.length} strategies in ${t1 - t0}ms (total registry=${this.registry.size})`);
        this._logDiagnostics('_loadAll');
    }

    _loadOne(filePath) {
        const start = process.hrtime.bigint();
        const id = path.basename(filePath, '.js');

        logger.debug && logger.debug(`_loadOne(${id}) called for ${filePath}`);

        try {
            const stat = fs.statSync(filePath);
            const existing = this.registry.get(id);

            // Skip if file didn't change (fast path for hot-reload spam)
            if (existing && existing.mtime >= stat.mtimeMs) {
                logger.debug && logger.debug(`Skipping ${id} (not modified). mtime=${stat.mtimeMs}`);
                return;
            }

            // Security check
            const code = fs.readFileSync(filePath, 'utf8');
            const tSecurityStart = process.hrtime.bigint();
            if (!validateStrategyCode(code)) {
                const tSecurityEnd = process.hrtime.bigint();
                const msSec = Number(tSecurityEnd - tSecurityStart) / 1e6;
                logger.error(`Security validation failed → ${id} (took ${msSec.toFixed(2)}ms)`);
                stateManager.commit(id, 'ERROR', { reason: 'security check' });
                return;
            }
            const tSecurityEnd = process.hrtime.bigint();

            // Clear cache → reload module
            try {
                const resolved = require.resolve(filePath);
                if (require.cache[resolved]) {
                    delete require.cache[resolved];
                    logger.debug && logger.debug(`Cleared require cache for ${id}`);
                }
            } catch (e) {
                // require.resolve may throw for non-resolvable; ignore
            }

            const tRequireStart = process.hrtime.bigint();
            const StrategyClass = require(filePath);
            const instance = typeof StrategyClass === 'function'
                ? new StrategyClass()
                : StrategyClass;
            const tRequireEnd = process.hrtime.bigint();

            instance.id = id;

            // Restore params if exist
            const saved = this._loadParams(id);
            if (saved) {
                instance.updateParams?.(saved);
                logger.info(`Restored params for ${id}`);
            }

            // Apply defaults
            instance._applyDefaults?.();

            // Store minimal metadata
            this.registry.set(id, {
                instance,
                filePath,
                mtime: stat.mtimeMs
            });

            // Initial state
            if (!stateManager.getStatus(id)) {
                stateManager.commit(id, 'STAGED', { reason: 'loaded' });
            }

            // Update stats
            this.stats.loads += 1;
            if (existing) this.stats.reloads += 1;
            const end = process.hrtime.bigint();
            const msTotal = Number(end - start) / 1e6;
            this.stats.loadTimesMs.push(msTotal);

            logger.info(`Strategy ${existing ? 're' : ''}loaded: ${id} (size=${stat.size} bytes, mtime=${new Date(stat.mtimeMs).toISOString()}, totalLoad=${msTotal.toFixed(2)}ms, security=${Number(tSecurityEnd - tSecurityStart)/1e6 .toFixed?.(2) || 'n/a'}ms, require=${Number(tRequireEnd - tRequireStart)/1e6 .toFixed?.(2) || 'n/a'}ms)`);

            // Auto-restart previously active strategies
            if (stateManager.getStatus(id) === 'ACTIVE' && this.engine) {
                logger.info(`Auto-restarting previously ACTIVE strategy ${id}`);
                this.startStrategy(id);
            }

            bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id });

            // Periodic diagnostics
            if (this.stats.loads % 10 === 0) {
                const avg = this.stats.loadTimesMs.reduce((a, b) => a + b, 0) / this.stats.loadTimesMs.length;
                logger.info(`Load stats: totalLoads=${this.stats.loads}, reloads=${this.stats.reloads}, avgLoadMs=${avg.toFixed(2)}`);
                this._logDiagnostics('periodic');
            }

        } catch (err) {
            logger.error(`Load failed [${id}]: ${err.message}`);
            stateManager.commit(id, 'ERROR', { reason: err.message.slice(0, 120) });
        }
    }

    // ─── File watcher with proper debounce ─────────────────────────

    _startWatcher() {
        if (this.watcher) {
            logger.debug && logger.debug('Watcher already started');
            return;
        }

        logger.info(`Starting file watcher on ${this.strategiesPath}`);
        this.watcher = fs.watch(this.strategiesPath, (event, filename) => {
            logger.debug && logger.debug(`Watcher event: ${event} ${filename}`);
            if (!filename?.endsWith('.js')) {
                logger.debug && logger.debug(`Ignoring non-js file event: ${filename}`);
                return;
            }

            // Debounce many quick edits
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                const fullPath = path.join(this.strategiesPath, filename);
                const id = path.basename(filename, '.js');

                if (fs.existsSync(fullPath)) {
                    logger.info(`Detected change/add for ${id}, reloading`);
                    this._loadOne(fullPath);
                } else {
                    logger.info(`Detected removal of ${id}, stopping and removing from registry`);
                    this.stopStrategy(id);
                    this.registry.delete(id);
                    stateManager.commit(id, 'OFFLINE', { reason: 'file removed' });
                    this._logDiagnostics('file removed');
                }
            }, 150);
        });

        // log watcher creation
        logger.info('File watcher started');
    }

    // ─── Persistence (only when needed) ───────────────────────────

    _saveParams(id, params) {
        if (!params || typeof params !== 'object') {
            logger.debug && logger.debug(`_saveParams called with invalid params for ${id}`);
            return;
        }

        const file = path.join(this.settingsPath, `settings_${id}.json`);
        try {
            fs.writeFileSync(file, JSON.stringify(params, null, 2));
            logger.info(`Saved settings for ${id} → ${file}`);
        } catch (err) {
            logger.warn(`Cannot save settings ${id}: ${err.message}`);
        }
    }

    _loadParams(id) {
        const file = path.join(this.settingsPath, `settings_${id}.json`);
        if (!fs.existsSync(file)) {
            logger.debug && logger.debug(`No saved settings for ${id}`);
            return null;
        }
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            logger.debug && logger.debug(`Loaded saved settings for ${id}`);
            return data;
        } catch (err) {
            logger.warn(`Failed to load saved settings ${id}: ${err.message}`);
            return null;
        }
    }

    // ─── Control methods ──────────────────────────────────────────

    startStrategy(id, options = {}) {
        logger.info(`startStrategy requested for ${id} with options=${JSON.stringify(options)}`);
        const entry = this.registry.get(id);
        if (!entry) {
            logger.warn(`startStrategy: no entry for ${id}`);
            return null;
        }

        const current = stateManager.getStatus(id);
        if (!['STAGED', 'PAUSED', 'ERROR'].includes(current)) {
            logger.debug && logger.debug(`startStrategy: invalid state ${current} for ${id}, skipping start`);
            return entry;
        }

        entry.instance.mode = (options.mode || 'PAPER').toUpperCase();
        entry.instance.timeframe = options.timeframe || entry.instance.timeframe || '1m';

        if (!stateManager.commit(id, 'WARMING_UP', { reason: 'start requested' })) {
            logger.warn(`startStrategy: stateManager refused to move to WARMING_UP for ${id}`);
            return entry;
        }

        entry.instance.enabled = true;
        entry.instance.startTime = Date.now();

        const t0 = process.hrtime.bigint();
        this.engine?.registerStrategy(entry.instance, options);
        const t1 = process.hrtime.bigint();

        logger.info(`Registered strategy ${id} with engine (register took ${Number(t1 - t0) / 1e6 .toFixed?.(2) || 'n/a'}ms)`);

        bus.emit(EVENTS.SYSTEM.STRATEGY_START, {
            id,
            name: entry.instance.name || id,
            mode: entry.instance.mode
        });

        this._logDiagnostics(`start:${id}`);
        return entry;
    }

    stopStrategy(id) {
        logger.info(`stopStrategy requested for ${id}`);
        const entry = this.registry.get(id);
        if (!entry) {
            logger.warn(`stopStrategy: no entry for ${id}`);
            return null;
        }

        const current = stateManager.getStatus(id);
        if (current === 'OFFLINE' || current === 'STOPPING') {
            logger.debug && logger.debug(`stopStrategy: already stopping/offline for ${id} (state=${current})`);
            return entry;
        }

        stateManager.commit(id, 'STOPPING');

        entry.instance.enabled = false;
        const t0 = process.hrtime.bigint();
        this.engine?.unregisterStrategy(id);
        const t1 = process.hrtime.bigint();
        stateManager.commit(id, 'OFFLINE');

        logger.info(`Unregistered strategy ${id} (unregister took ${Number(t1 - t0) / 1e6 .toFixed?.(2) || 'n/a'}ms)`);
        bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id });

        this._logDiagnostics(`stop:${id}`);
        return entry;
    }

    // ─── Reports ──────────────────────────────────────────────────

    listStrategies() {
        return Array.from(this.registry.values()).map(e => ({
            id: e.instance.id,
            name: e.instance.name || e.instance.id,
            status: stateManager.getStatus(e.instance.id),
            symbols: e.instance.symbols || [],
            mode: e.instance.mode || null,
            uptime: e.instance.startTime ? Date.now() - e.instance.startTime : 0,
            params: e.instance.params || {}
        }));
    }

    getActiveSymbols() {
        const symbols = new Set();
        for (const [id, entry] of this.registry) {
            if (stateManager.getStatus(id) === 'ACTIVE') {
                for (const s of entry.instance.symbols || []) {
                    symbols.add(s);
                }
            }
        }
        logger.debug && logger.debug(`getActiveSymbols returned ${symbols.size} symbols`);
        return Array.from(symbols);
    }

    // Optional: cleanup on shutdown
    shutdown() {
        logger.info('StrategyLoader shutdown initiated');
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            logger.info('File watcher closed');
        }
        for (const [id] of this.registry) {
            try {
                this.stopStrategy(id);
            } catch (e) {
                logger.warn(`Error stopping ${id} during shutdown: ${e.message}`);
            }
        }
        this.registry.clear();
        logger.info('StrategyLoader shutdown complete, registry cleared');
        this._logDiagnostics('shutdown');
    }
}

module.exports = new StrategyLoader();