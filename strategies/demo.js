const BaseStrategy = require("../utils/BaseStrategy");

class FinalCheck extends BaseStrategy {
  constructor() {
    super({
      name: "FinalCheck",
      symbols: ["BTC/USD"],
      timeframe: "1m",
      candleBased: false // Set to false to see every tick in the log
    });
  }

  next(tick, isWarmup) {
    if (isWarmup) return;

    const candle = this.getCurrentCandle(tick.symbol);
    
    // Safety check: The first few ticks might not have a full candle object yet
    if (!candle) {
      console.log(`[WAITING] ${tick.symbol} @ ${tick.price} (Aggregating first candle...)`);
      return;
    }

    console.log(`[LIVE] ${tick.symbol}: ${tick.price} | Candle Start: ${new Date(candle.timeStart).toLocaleTimeString()}`);
  }
}

module.exports = new FinalCheck();