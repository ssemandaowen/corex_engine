"use strict";
const BaseStrategy = require('@utils/BaseStrategy');

/**
 * A simple demonstration strategy that enters a long position
 * once the lookback period is warmed up, and then holds it.
 */
class Demo extends BaseStrategy {
  constructor() {
    super({
      name: "demo",
      symbols: ["BTC/USD"],
      lookback: 20,
      timeframe: "1m"
    });

    // This strategy has no configurable parameters.

    this._positionEntered = false;
  }

  next(data) {
    const symbol = data.symbol || this.symbols[0];
    if (this._positionEntered || !this.isWarmedUp(symbol)) return null;

    this._positionEntered = true;
    return this.entryLong({ symbol, label: "Demo Entry" });
  }
}

module.exports = Demo;