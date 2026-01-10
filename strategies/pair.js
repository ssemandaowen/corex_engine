const BaseStrategy = require("../utils/BaseStrategy");

class Pair extends BaseStrategy {
  constructor() {
    super({
      name: "Pair",
      symbols: ["BTC/USD"],
      timeframe: "1m"
    });
    this.tickCount = 0;
  }

  next(tick, isBacktest) {
    this.tickCount++;
    console.log(`[${this.name}] Tick #${this.tickCount} for ${tick.symbol} at ${new Date(tick.time).toISOString()} - Price: ${tick.price}`);
}
}

module.exports = Pair;