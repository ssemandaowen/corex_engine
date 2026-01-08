const BaseStrategy = require("../utils/BaseStrategy");

class FinalCheck extends BaseStrategy {
  constructor() {
    super({
      name: "FinalCheck",
      symbols: ["BTC/USD"],
      timeframe: "1m"
    });
    this.tickCount = 0;
  }

  next(tick, isBacktest) {
    if (!tick || !tick.price) return;

    // 1. If we DON'T have a position, look for an entry
    if (!this.position) {
        // Example: Simple "Rapid Fire" entry
        this.buy();
    } 
    // 2. If we DO have a position, look for an exit
    else {
        // Example: Simple "Rapid Fire" exit
        this.sell();
    }
}
}

module.exports = FinalCheck;