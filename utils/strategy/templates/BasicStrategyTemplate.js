"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

/**
 * Basic Strategy Template
 * 
 * Description: Template for creating simple strategies
 * Type: [Trend Following | Mean Reversion | Breakout | Momentum | etc.]
 * Timeframe: [1m | 5m | 15m | 1h | 4h | 1d]
 * Complexity: Simple
 * 
 * Instructions:
 * 1. Rename this class to match your strategy name (PascalCase)
 * 2. Update the configuration in constructor
 * 3. Define your parameters in schema
 * 4. Implement your strategy logic in next()
 * 5. Test thoroughly before deploying
 * 
 * @extends BaseStrategy
 */
class BasicStrategyTemplate extends BaseStrategy {
  constructor() {
    // 1. Configure strategy basics
    super({
      name: "basic_strategy_template",  // Change to your strategy name (snake_case)
      symbols: ["BTC/USD"],              // Trading symbols
      timeframe: "15m",                  // Candle timeframe
      lookback: 100                      // Minimum bars needed
    });
    
    // 2. Define tunable parameters
    this.schema = {
      // Example parameters - customize for your strategy
      period: {
        type: "integer",
        min: 2,
        max: 200,
        default: 20,
        label: "Indicator Period",
        description: "Period for indicator calculation"
      },
      
      threshold: {
        type: "number",
        min: 0,
        max: 100,
        default: 50,
        label: "Signal Threshold",
        description: "Threshold for signal generation"
      },
      
      quantity: {
        type: "integer",
        min: 1,
        max: 100000,
        default: 1,
        label: "Position Size",
        description: "Fixed position size (if not using risk-based sizing)"
      }
    };
    
    // Apply default parameter values
    this._applyDefaults();
    
    // 3. Initialize internal state (optional)
    this._state = {
      lastSignalTime: null,
      signalCount: 0
    };
  }
  
  /**
   * Main strategy logic - called on each new bar/tick
   * 
   * @param {Object} data - Market data packet
   * @param {string} data.symbol - Trading symbol
   * @param {number} data.time - Bar timestamp
   * @param {number} data.open - Open price
   * @param {number} data.high - High price
   * @param {number} data.low - Low price
   * @param {number} data.close - Close price
   * @param {number} data.volume - Volume
   * 
   * @returns {Object|null} Signal object or null
   */
  next(data) {
    // 1. Resolve symbol and validate warmup
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.lookback, "warmup_guard")) return null;
    
    // 2. Wrap logic in safeRule for error containment
    return this.safeRule(() => {
      // 3. Get price data
      const closes = this.safeSeries(symbol, "close");
      if (closes.length < this.lookback) return null;
      
      // 4. Calculate indicators
      // Example: Simple Moving Average
      const sma = this.indicators.SMA.calculate({
        period: this.params.period,
        values: closes
      });
      
      // Validate indicator output
      if (!sma || sma.length < 2) return null;
      
      // 5. Get current values
      const currentPrice = data.close || data.price;
      const currentSMA = sma[sma.length - 1];
      const previousSMA = sma[sma.length - 2];
      
      // 6. Define entry/exit conditions
      const bullishCross = currentPrice > currentSMA && previousSMA >= currentPrice;
      const bearishCross = currentPrice < currentSMA && previousSMA <= currentPrice;
      
      // 7. Generate signals using rule chain
      return this.rule(data)
        .whenPos("flat", symbol)
        .and(bullishCross)
        .then((buySide) => {
          buySide.enterLong({ symbol, quantity: this.params.quantity });
        })
        .else((sellSide) => {
          sellSide
            .whenPos("long", symbol)
            .and(bearishCross)
            .then((exitSide) => {
              exitSide.exitLong({ symbol });
            });
        })
        .end();
      
    }, null); // Return null on error
  }
}

module.exports = BasicStrategyTemplate;
