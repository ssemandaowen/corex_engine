const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { bus, EVENTS } = require('../events/bus');

class StrategyLoader {
  constructor() {
    this.engine = null;
    this.strategiesPath = path.join(__dirname, '../strategies');
    this.registry = new Map(); // Store by ID: { instance, metadata }
  }

  init(engine) {
    this.engine = engine;
    this.reloadAll();
    return this.getActiveSymbols();
  }

  // --- API CONTROL METHODS ---

  listStrategies() {
    return Array.from(this.registry.values()).map(entry => ({
      id: entry.id,
      name: entry.instance.name,
      status: entry.status,
      symbols: entry.instance.symbols,
      uptime: entry.instance.startTime ? Date.now() - entry.instance.startTime : 0
    }));
  }

  startStrategy(id) {
    const entry = this.registry.get(id);
    if (!entry) throw new Error("Strategy not found in registry.");
    if (entry.status === 'RUNNING') return entry;

    entry.status = 'RUNNING';
    entry.instance.enabled = true;
    entry.instance.startTime = Date.now();

    // Register symbols with engine/broker dynamically
    if (this.engine) this.engine.registerStrategy(entry.instance);
    
    bus.emit(EVENTS.SYSTEM.STRATEGY_START, { id, name: entry.instance.name });
    logger.info(`⚡ API Command: Strategy ${id} started.`);
    return entry;
  }

  stopStrategy(id) {
    const entry = this.registry.get(id);
    if (!entry) throw new Error("Strategy not found.");

    entry.status = 'STOPPED';
    entry.instance.enabled = false;
    
    if (this.engine) this.engine.unregisterStrategy(id);

    bus.emit(EVENTS.SYSTEM.STRATEGY_STOP, { id });
    logger.warn(`🛑 API Command: Strategy ${id} stopped.`);
    return entry;
  }

  // --- CORE LOGIC ---

  reloadAll() {
    if (!fs.existsSync(this.strategiesPath)) return;

    const files = fs.readdirSync(this.strategiesPath).filter(f => f.endsWith('.js'));
    
    files.forEach(file => {
        const filePath = path.resolve(this.strategiesPath, file);
        const strategyId = path.basename(file, '.js');

        try {
            delete require.cache[filePath];
            const ExportedValue = require(filePath);
            
            let instance;

            // FIX: Smart Instance Detection
            if (typeof ExportedValue === 'function') {
                // It's a Class/Constructor
                instance = new ExportedValue();
            } else if (typeof ExportedValue === 'object' && ExportedValue !== null) {
                // It's already an instance
                instance = ExportedValue;
            } else {
                throw new Error("Export is neither a Class nor an Object.");
            }

            // Validation
            if (!instance.symbols || !Array.isArray(instance.symbols)) {
                throw new Error("Strategy missing symbols array.");
            }

            // Assign ID to instance if it doesn't have one
            instance.id = strategyId;

            // Load into registry
            this.registry.set(strategyId, {
                id: strategyId,
                instance: instance,
                status: 'IDLE',
                filePath: filePath
            });

            logger.info(`📁 Strategy found and staged: ${strategyId} (Status: IDLE)`);
            bus.emit(EVENTS.SYSTEM.STRATEGY_LOADED, { id: strategyId });

        } catch (err) {
            logger.error(`❌ Load Error [${file}]: ${err.message}`);
        }
    });
}

  getActiveSymbols() {
    const symbols = new Set();
    this.registry.forEach(entry => {
      if (entry.status === 'RUNNING') {
        entry.instance.symbols.forEach(s => symbols.add(s));
      }
    });
    return Array.from(symbols);
  }

  get allStrategies() {
    return Array.from(this.registry.values()).map(e => e.instance);
  }
}

module.exports = new StrategyLoader();