const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class StrategyLoader {
  constructor() {
    this.engine = null;
    this.strategiesPath = path.join(__dirname, '../strategies');
    this.allStrategies = [];
  }

  init(engine) {
    this.engine = engine;
    return this.reloadAll();
  }

  reloadAll() {
    this.allStrategies = [];
    if (!fs.existsSync(this.strategiesPath)) return [];

    const files = fs.readdirSync(this.strategiesPath).filter(f => f.endsWith('.js'));
    files.forEach(file => {
      const filePath = path.resolve(this.strategiesPath, file);
      try {
        delete require.cache[filePath];
        const strategy = require(filePath);
        
        // Critical Validation
        if (!strategy.symbols || !Array.isArray(strategy.symbols)) {
          throw new Error("Missing symbols array.");
        }

        this.allStrategies.push(strategy);
        if (this.engine) this.engine.registerStrategy(strategy);
      } catch (err) {
        logger.error(`❌ Failed to load ${file}: ${err.message}`);
      }
    });

    return [...new Set(this.allStrategies.flatMap(s => s.symbols))];
  }

  // Watcher is kept but scope-locked: only reloads, doesn't add new logic
  _watchFolder() {
    fs.watch(this.strategiesPath, (event, filename) => {
      if (filename?.endsWith('.js') && event === 'change') {
        this.reloadAll();
      }
    });
  }
}

module.exports = new StrategyLoader();