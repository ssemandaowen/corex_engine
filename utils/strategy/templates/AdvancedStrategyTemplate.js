"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

/**
 * Advanced Strategy Template
 * 
 * Description: Template for creating complex multi-indicator strategies
 * Type: [Trend Following | Mean Reversion | Breakout | Hybrid | etc.]
 * Timeframe: [1m | 5m | 15m | 1h | 4h | 1d]
 * Complexity: Advanced
 * 
 * Features:
 * - Multi-indicator confirmation
 * - Dynamic position sizing
 * - Trailing stop loss management
 * - Risk management integration
 * - State tracking and persistence
 * - Structured logging
 * 
 * @extends BaseStrategy
 */
class AdvancedStrategyTemplate extends BaseStrategy {
  constructor() {
    super({
      name: "advanced_strategy_template",
      symbols: ["BTC/USD"],
      timeframe: "15m",
      lookback: 200
    });
    
    // Define comprehensive parameter schema
    this.schema = {
      // === Indicator Parameters ===
      fastPeriod: {
        type: "integer",
        min: 2,
        max: 100,
        default: 12,
        label: "Fast EMA Period",
        description: "Period for fast exponential moving average"
      },
      
      slowPeriod: {
        type: "integer",
        min: 5,
        max: 200,
        default: 26,
        label: "Slow EMA Period",
        description: "Period for slow exponential moving average"
      },
      
      rsiPeriod: {
        type: "integer",
        min: 2,
        max: 100,
        default: 14,
        label: "RSI Period",
        description: "Period for RSI calculation"
      },
      
      atrPeriod: {
        type: "integer",
        min: 2,
        max: 100,
        default: 14,
        label: "ATR Period",
        description: "Period for Average True Range"
      },
      
      // === Filter Parameters ===
      rsiOverbought: {
        type: "number",
        min: 50,
        max: 100,
        default: 70,
        label: "RSI Overbought",
        description: "RSI level considered overbought"
      },
      
      rsiOversold: {
        type: "number",
        min: 0,
        max: 50,
        default: 30,
        label: "RSI Oversold",
        description: "RSI level considered oversold"
      },
      
      // === Risk Parameters ===
      riskPct: {
        type: "number",
        min: 0.1,
        max: 10,
        default: 1.0,
        label: "Risk Percentage",
        description: "Risk per trade as percentage of account"
      },
      
      stopMultiplier: {
        type: "number",
        min: 0.5,
        max: 10,
        default: 2.0,
        label: "Stop Loss Multiplier",
        description: "ATR multiplier for stop loss"
      },
      
      targetMultiplier: {
        type: "number",
        min: 0.5,
        max: 20,
        default: 3.0,
        label: "Take Profit Multiplier",
        description: "ATR multiplier for take profit"
      },
      
      trailingMultiplier: {
        type: "number",
        min: 0.5,
        max: 10,
        default: 1.5,
        label: "Trailing Stop Multiplier",
        description: "ATR multiplier for trailing stop"
      },
      
      breakevenMultiplier: {
        type: "number",
        min: 0.1,
        max: 10,
        default: 1.0,
        label: "Breakeven Trigger Multiplier",
        description: "ATR multiplier to trigger breakeven stop"
      },
      
      // === Feature Toggles ===
      enableShorts: {
        type: "boolean",
        default: true,
        label: "Enable Short Positions",
        description: "Allow short position entries"
      },
      
      enableTrailing: {
        type: "boolean",
        default: true,
        label: "Enable Trailing Stop",
        description: "Use trailing stop loss"
      },
      
      enableFilters: {
        type: "boolean",
        default: true,
        label: "Enable Filters",
        description: "Apply additional entry filters"
      }
    };
    
    this._applyDefaults();
    
    // Initialize comprehensive state management
    this._state = {
      // Position tracking
      position: {
        entry: null,
        stop: null,
        target: null,
        breakeven: false,
        trailingStop: null,
        highWaterMark: null,
        lowWaterMark: null
      },
      
      // Signal tracking
      signals: {
        lastEntry: null,
        lastExit: null,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        totalSignals: 0
      },
      
      // Risk tracking
      risk: {
        dailyLoss: 0,
        weeklyLoss: 0,
        maxDrawdown: 0,
        riskMultiplier: 1.0,
        lastResetTime: Date.now()
      },
      
      // Indicator state
      indicators: {
        lastCross: null,
        trendDirection: null,
        volatilityRegime: null
      }
    };
  }
  
  /**
   * Main strategy logic entry point
   */
  next(data) {
    const symbol = this.resolveSymbol({ packet: data });
    if (!this.isWarmedUp(symbol)) return null;
    if (!this.requireBars(symbol, this.lookback, "warmup_guard")) return null;
    
    // Ensure once-per-bar execution
    const barTime = Number(data.time || this.currentBar?.time || 0);
    if (!this.oncePerBar(`${symbol}_bar`, barTime)) return null;
    
    return this.safeRule(() => {
      // Get all required data series
      const closes = this.safeSeries(symbol, "close");
      const highs = this.safeSeries(symbol, "high");
      const lows = this.safeSeries(symbol, "low");
      
      if (closes.length < this.lookback) return null;
      
      // Calculate all indicators
      const indicators = this._calculateIndicators({ closes, highs, lows });
      if (!indicators) return null;
      
      // Apply filters
      if (this.params.enableFilters && !this._passesFilters(indicators, data)) {
        this.logGuard("filters", false, { reason: "Filter conditions not met" });
        return null;
      }
      
      // Update risk state
      this._updateRiskState(data);
      
      // Generate signal based on position state
      const position = this.positions.get(symbol);
      
      if (!position || position.side === "flat") {
        return this._handleFlatPosition(symbol, indicators, data);
      } else if (position.side === "long") {
        return this._handleLongPosition(symbol, indicators, data);
      } else if (position.side === "short") {
        return this._handleShortPosition(symbol, indicators, data);
      }
      
      return null;
    }, null);
  }
  
  /**
   * Calculate all required indicators
   * @private
   */
  _calculateIndicators({ closes, highs, lows }) {
    try {
      // Moving averages
      const fastEMA = this.indicators.EMA.calculate({
        period: this.params.fastPeriod,
        values: closes
      });
      
      const slowEMA = this.indicators.EMA.calculate({
        period: this.params.slowPeriod,
        values: closes
      });
      
      // RSI
      const rsi = this.indicators.RSI.calculate({
        period: this.params.rsiPeriod,
        values: closes
      });
      
      // ATR for volatility and stops
      const atr = this.indicators.ATR.calculate({
        period: this.params.atrPeriod,
        high: highs,
        low: lows,
        close: closes
      });
      
      // Validate all indicators
      if (!fastEMA || fastEMA.length < 2) return null;
      if (!slowEMA || slowEMA.length < 2) return null;
      if (!rsi || rsi.length < 1) return null;
      if (!atr || atr.length < 1) return null;
      
      return {
        fastEMA,
        slowEMA,
        rsi,
        atr,
        // Current values
        fast: fastEMA[fastEMA.length - 1],
        slow: slowEMA[slowEMA.length - 1],
        rsiValue: rsi[rsi.length - 1],
        atrValue: atr[atr.length - 1]
      };
    } catch (error) {
      this.log.error(`[${this.id}] Indicator calculation failed: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Apply entry filters
   * @private
   */
  _passesFilters(indicators, data) {
    const { rsiValue } = indicators;
    
    // RSI filter for longs
    if (rsiValue > this.params.rsiOverbought) {
      return false;
    }
    
    // RSI filter for shorts
    if (rsiValue < this.params.rsiOversold) {
      return false;
    }
    
    // Add more filters as needed
    // - Volume filter
    // - Volatility filter
    // - Time-of-day filter
    // - Trend filter
    
    return true;
  }
  
  /**
   * Handle flat position (look for entries)
   * @private
   */
  _handleFlatPosition(symbol, indicators, data) {
    const { fastEMA, slowEMA, atrValue } = indicators;
    const currentPrice = data.close || data.price;
    
    // Check for bullish crossover
    const bullishCross = this.crossover(fastEMA, slowEMA, {
      key: `${symbol}_entry_long`,
      barTime: data.time
    });
    
    // Check for bearish crossover
    const bearishCross = this.crossunder(fastEMA, slowEMA, {
      key: `${symbol}_entry_short`,
      barTime: data.time
    });
    
    // Calculate position size
    const quantity = this._calculateQuantity(symbol, currentPrice, atrValue);
    
    // Long entry
    if (bullishCross) {
      this._initializePositionState("long", currentPrice, atrValue);
      this.logDecision("ENTRY_LONG", {
        price: currentPrice,
        quantity,
        stop: this._state.position.stop,
        target: this._state.position.target
      });
      
      return this.entryLong({
        symbol,
        quantity,
        meta: {
          reason: "EMA_CROSSOVER_LONG",
          indicators: { fast: indicators.fast, slow: indicators.slow }
        }
      });
    }
    
    // Short entry
    if (bearishCross && this.params.enableShorts) {
      this._initializePositionState("short", currentPrice, atrValue);
      this.logDecision("ENTRY_SHORT", {
        price: currentPrice,
        quantity,
        stop: this._state.position.stop,
        target: this._state.position.target
      });
      
      return this.entryShort({
        symbol,
        quantity,
        meta: {
          reason: "EMA_CROSSOVER_SHORT",
          indicators: { fast: indicators.fast, slow: indicators.slow }
        }
      });
    }
    
    return null;
  }
  
  /**
   * Handle long position (manage exits)
   * @private
   */
  _handleLongPosition(symbol, indicators, data) {
    const { fastEMA, slowEMA, atrValue } = indicators;
    const currentPrice = data.close || data.price;
    
    // Update trailing stop if enabled
    if (this.params.enableTrailing) {
      this._updateTrailingStop("long", currentPrice, atrValue);
    }
    
    // Check exit conditions
    const stopHit = this._checkStopHit("long", currentPrice);
    const targetHit = this._checkTargetHit("long", currentPrice);
    const signalExit = this.crossunder(fastEMA, slowEMA, {
      key: `${symbol}_exit_long`,
      barTime: data.time
    });
    
    if (stopHit || targetHit || signalExit) {
      const reason = stopHit ? "STOP_LOSS" : targetHit ? "TAKE_PROFIT" : "SIGNAL_EXIT";
      this.logDecision("EXIT_LONG", {
        price: currentPrice,
        reason,
        pnl: this._calculatePnL("long", currentPrice)
      });
      
      this._resetPositionState();
      return this.exitLong({ symbol, meta: { reason } });
    }
    
    return null;
  }
  
  /**
   * Handle short position (manage exits)
   * @private
   */
  _handleShortPosition(symbol, indicators, data) {
    const { fastEMA, slowEMA, atrValue } = indicators;
    const currentPrice = data.close || data.price;
    
    // Update trailing stop if enabled
    if (this.params.enableTrailing) {
      this._updateTrailingStop("short", currentPrice, atrValue);
    }
    
    // Check exit conditions
    const stopHit = this._checkStopHit("short", currentPrice);
    const targetHit = this._checkTargetHit("short", currentPrice);
    const signalExit = this.crossover(fastEMA, slowEMA, {
      key: `${symbol}_exit_short`,
      barTime: data.time
    });
    
    if (stopHit || targetHit || signalExit) {
      const reason = stopHit ? "STOP_LOSS" : targetHit ? "TAKE_PROFIT" : "SIGNAL_EXIT";
      this.logDecision("EXIT_SHORT", {
        price: currentPrice,
        reason,
        pnl: this._calculatePnL("short", currentPrice)
      });
      
      this._resetPositionState();
      return this.exitShort({ symbol, meta: { reason } });
    }
    
    return null;
  }
  
  /**
   * Calculate position size based on risk
   * @private
   */
  _calculateQuantity(symbol, price, atr) {
    const stopDistance = atr * this.params.stopMultiplier;
    
    return this.sizePosition({
      symbol,
      price,
      riskPct: this.params.riskPct,
      stopDistance,
      fallbackQty: 1
    });
  }
  
  /**
   * Initialize position state on entry
   * @private
   */
  _initializePositionState(side, entry, atr) {
    const stopDistance = atr * this.params.stopMultiplier;
    const targetDistance = atr * this.params.targetMultiplier;
    
    this._state.position = {
      entry,
      stop: side === "long" ? entry - stopDistance : entry + stopDistance,
      target: side === "long" ? entry + targetDistance : entry - targetDistance,
      breakeven: false,
      trailingStop: null,
      highWaterMark: side === "long" ? entry : null,
      lowWaterMark: side === "short" ? entry : null
    };
  }
  
  /**
   * Update trailing stop
   * @private
   */
  _updateTrailingStop(side, currentPrice, atr) {
    const trailingDistance = atr * this.params.trailingMultiplier;
    const breakevenDistance = atr * this.params.breakevenMultiplier;
    
    if (side === "long") {
      // Update high water mark
      if (!this._state.position.highWaterMark || currentPrice > this._state.position.highWaterMark) {
        this._state.position.highWaterMark = currentPrice;
      }
      
      // Move to breakeven
      if (!this._state.position.breakeven &&
          currentPrice >= this._state.position.entry + breakevenDistance) {
        this._state.position.stop = this._state.position.entry;
        this._state.position.breakeven = true;
      }
      
      // Trail stop
      if (this._state.position.breakeven) {
        const newStop = this._state.position.highWaterMark - trailingDistance;
        if (newStop > this._state.position.stop) {
          this._state.position.stop = newStop;
        }
      }
    } else {
      // Update low water mark
      if (!this._state.position.lowWaterMark || currentPrice < this._state.position.lowWaterMark) {
        this._state.position.lowWaterMark = currentPrice;
      }
      
      // Move to breakeven
      if (!this._state.position.breakeven &&
          currentPrice <= this._state.position.entry - breakevenDistance) {
        this._state.position.stop = this._state.position.entry;
        this._state.position.breakeven = true;
      }
      
      // Trail stop
      if (this._state.position.breakeven) {
        const newStop = this._state.position.lowWaterMark + trailingDistance;
        if (newStop < this._state.position.stop) {
          this._state.position.stop = newStop;
        }
      }
    }
  }
  
  /**
   * Check if stop loss hit
   * @private
   */
  _checkStopHit(side, currentPrice) {
    if (!this._state.position.stop) return false;
    
    if (side === "long") {
      return currentPrice <= this._state.position.stop;
    } else {
      return currentPrice >= this._state.position.stop;
    }
  }
  
  /**
   * Check if take profit hit
   * @private
   */
  _checkTargetHit(side, currentPrice) {
    if (!this._state.position.target) return false;
    
    if (side === "long") {
      return currentPrice >= this._state.position.target;
    } else {
      return currentPrice <= this._state.position.target;
    }
  }
  
  /**
   * Calculate P&L for current position
   * @private
   */
  _calculatePnL(side, currentPrice) {
    if (!this._state.position.entry) return 0;
    
    if (side === "long") {
      return currentPrice - this._state.position.entry;
    } else {
      return this._state.position.entry - currentPrice;
    }
  }
  
  /**
   * Reset position state
   * @private
   */
  _resetPositionState() {
    this._state.position = {
      entry: null,
      stop: null,
      target: null,
      breakeven: false,
      trailingStop: null,
      highWaterMark: null,
      lowWaterMark: null
    };
  }
  
  /**
   * Update risk management state
   * @private
   */
  _updateRiskState(data) {
    // Reset daily/weekly counters if needed
    const now = data.time || Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    if (now - this._state.risk.lastResetTime > dayMs) {
      this._state.risk.dailyLoss = 0;
      this._state.risk.lastResetTime = now;
    }
  }
}

module.exports = AdvancedStrategyTemplate;
