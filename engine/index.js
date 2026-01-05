const broker = require("../broker/twelvedata");
const loader = require("./strategyLoader");
const bus = require("../events/bus");
const logger = require("../utils/logger");

class CoreXEngine {
  constructor() {
    this.status = "IDLE"; 
    this.startTime = null;
    this.activeSymbols = new Set();
  }

  async start() {
    if (this.status !== "IDLE") return logger.warn(`Engine is ${this.status}, ignore start.`);
    
    try {
      this.status = "STARTING";
      this.startTime = Date.now();
      logger.info("🚀 CoreX Production Engine initializing...");

      // 1. Initialize Loader and get initial symbols
      // We pass 'this' so the loader can register strategies back to this engine
      const symbols = loader.init(this); 
      
      if (symbols.length === 0) {
        logger.warn("⚠️ No valid strategies found at startup. Waiting for hot-reloads...");
      }

      // 2. Warm-up existing strategies
      await this.warmup(loader.allStrategies);

      // 3. Connect Data Feed
      broker.symbols = symbols;
      broker.connect();

      // 4. Bind Distribution with safety
      bus.on("price:live", (data) => this.safeDistribute(data));

      this.status = "RUNNING";
      logger.info("🟢 Engine state: RUNNING");

    } catch (err) {
      logger.error(`❌ Critical Startup Failure: ${err.message}`);
      // Only stop on absolute core failures, not strategy errors
      this.stop();
    }
  }

  // Allow the loader to inject strategies dynamically
  registerStrategy(strategy) {
    if (!strategy.symbols || !Array.isArray(strategy.symbols)) {
      throw new Error(`Strategy ${strategy.name} has invalid symbols array.`);
    }
    
    // Add new symbols to the broker if they don't exist
    strategy.symbols.forEach(s => {
      if (!this.activeSymbols.has(s)) {
        this.activeSymbols.add(s);
        if (this.status === "RUNNING") broker.subscribe(s);
      }
    });
  }

 async warmup(strategies) {
  if (!strategies || strategies.length === 0) return;
  logger.info("📉 Beginning historical seeding...");
  
  for (const strat of strategies) {
    try {
      // Check network/broker before fetching
      for (const sym of strat.symbols) {
        const history = await broker.fetchHistory(sym, strat.timeframeStr, strat.lookback);
        
        if (history && history.length > 0) {
          history.reverse().forEach(tick => strat.onPrice(tick, true)); 
          strat.isWarmedUp = true; // Mark as successfully seeded
          logger.info(`✅ ${strat.name} warmed up for ${sym}`);
        }
      }
    } catch (e) {
      // Keep it clean: Log the network error but don't crash
      logger.error(`⚠️ Seeding failed for ${strat.name}: ${e.message}. Strategy will run without history.`);
      strat.isWarmedUp = false; 
    }
  }
}

  safeDistribute(data) {
    if (this.status !== "RUNNING") return;
    
    // Safety Wrapper: One strategy crash won't stop the engine
    const strategies = loader.allStrategies;
    strategies.forEach(strat => {
      try {
        if (strat.symbols.includes(data.symbol)) {
          strat.onPrice(data, false);
        }
      } catch (err) {
        logger.error(`[${strat.name}] Runtime Logic Error: ${err.message}`);
        // Optionally: strat.enabled = false;
      }
    });
  }

  stop() {
    if (this.status === "STOPPING" || this.status === "IDLE") return;
    this.status = "STOPPING";
    logger.info("🛑 Graceful shutdown initiated...");
    try {
      broker.cleanup();
      bus.removeAllListeners("price:live");
      this.status = "IDLE";
      this.startTime = null;
      logger.info("🏁 Engine state: IDLE");
    } catch (err) {
      logger.error(`Shutdown Error: ${err.message}`);
      process.exit(1);
    }
  }
}

module.exports = new CoreXEngine();