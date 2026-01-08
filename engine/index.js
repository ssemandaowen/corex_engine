const broker = require("../broker/twelvedata");
const loader = require("./strategyLoader");
const { bus, EVENTS } = require("../events/bus"); // Added EVENTS import
const logger = require("../utils/logger");

class CoreXEngine {
  constructor() {
    this.status = "IDLE"; 
    this.startTime = null;
    this.activeSymbols = new Set();
  }

  async start() {
    if (this.status !== "IDLE") return;
    
    this.status = "INITIALIZING";
    this.startTime = Date.now();
    logger.info("🚀 CoreX Production Engine: CONTROL PLANE ACTIVE");

    // Initialize loader but DO NOT connect broker yet
    loader.init(this); 

    // Bind distribution listener (passive until ticks arrive)
    bus.on(EVENTS.MARKET.TICK, (data) => this.safeDistribute(data));

    this.status = "RUNNING";
    logger.info("🟢 Engine state: RUNNING (Waiting for strategy activation)");
  }

  // Register strategy symbols dynamically
  registerStrategy(strategy) {
    if (!strategy.symbols || !Array.isArray(strategy.symbols)) {
        throw new Error(`Strategy ${strategy.name} has invalid symbols.`);
    }

    // Add symbols to the global active set
    strategy.symbols.forEach(s => this.activeSymbols.add(s));

    // FIRMING: Push the full set of symbols to the broker
    broker.updateSymbols(Array.from(this.activeSymbols));

    // FIRMING: If the engine is running, tell the broker to connect/re-subscribe
    if (this.status === "RUNNING") {
        logger.info(`🔄 Re-syncing broker for ${strategy.name}...`);
        broker.connect(); 
    }

    logger.info(`📝 Strategy registered and live: ${strategy.name}`);
}

  // Server Control: Method to unregister a strategy
  unregisterStrategy(strategyId) {
    const strategy = Array.from(loader.allStrategies).find(s => s.id === strategyId);
    if (strategy) {
      logger.info(`🗑️ Unregistering strategy: ${strategy.name}`);
      // Logic to potentially remove symbols if no other strategy uses them
      // For now, we keep symbols in activeSymbols to maintain stream continuity
    }
  }

  async warmup(strategies) {
    if (!strategies || strategies.length === 0) return;
    logger.info("📉 Beginning historical seeding...");
    
    for (const strat of strategies) {
      try {
        for (const sym of strat.symbols) {
          const history = await broker.fetchHistory(sym, strat.timeframeStr, strat.lookback);
          if (history && history.length > 0) {
            history.reverse().forEach(tick => strat.onPrice(tick, true)); 
            strat.isWarmedUp = true;
            logger.info(`✅ ${strat.name} warmed up for ${sym}`);
          }
        }
      } catch (e) {
        logger.error(`⚠️ Seeding failed for ${strat.name}: ${e.message}`);
        strat.isWarmedUp = false; 
      }
    }
  }

  safeDistribute(data) {
    if (this.status !== "RUNNING") return;
    
    const strategies = loader.allStrategies;
    strategies.forEach(strat => {
      try {
        if (strat.symbols.includes(data.symbol) && strat.enabled !== false) {
          strat.onPrice(data, false);
        }
      } catch (err) {
        logger.error(`[${strat.name}] Runtime Logic Error: ${err.message}`);
      }
    });
  }

  getUptime() {
    if (!this.startTime) return "0s";
    const diff = Math.floor((Date.now() - this.startTime) / 1000);
    return `${diff}s`;
  }

  /**
   * ACTIVATE: Triggered by the API /start command
   */
  async activateStrategy(strategyId) {
    const entry = loader.activeStrategies.get(strategyId);
    if (!entry) throw new Error("Strategy not found in registry.");

    const strat = entry.instance;

    // 1. Warm-up on demand
    if (!strat.isWarmedUp) {
      await this.warmup([strat]);
    }

    // 2. Register symbols and trigger lazy connection
    strat.symbols.forEach(s => this.activeSymbols.add(s));
    strat.enabled = true;

    logger.info(`🔄 Activating feed for: ${strat.name} (${strat.symbols})`);
    
    // Sync symbols to broker and connect only now
    broker.updateSymbols(Array.from(this.activeSymbols));
    broker.connect(); 

    return strat;
  }

  stop() {
    if (this.status === "STOPPING" || this.status === "IDLE") return;
    this.status = "STOPPING";
    logger.info("🛑 Graceful shutdown initiated...");
    try {
      broker.cleanup();
      bus.removeAllListeners(EVENTS.MARKET.TICK);
      this.status = "IDLE";
      this.startTime = null;
      this.activeSymbols.clear();
      logger.info("🏁 Engine state: IDLE");
    } catch (err) {
      logger.error(`Shutdown Error: ${err.message}`);
      process.exit(1);
    }
  }
}

const engineInstance = new CoreXEngine();
module.exports = engineInstance;