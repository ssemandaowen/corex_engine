const BaseStrategy = require("@utils/BaseStrategy");

class Pair extends BaseStrategy {
  constructor() {
    super({
      name: "pair",
      symbols: ["BTC/USD"],
      timeframe: "1m"
    });
    this.tickCount = 0;
  }

  next(tick, isBacktest) {
    this.tickCount++;
    
}
}

module.exports = Pair;