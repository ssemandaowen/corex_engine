const { bus, EVENTS } = require('../events/bus');
const logger = require('./logger');

class BaseStrategy {
  constructor(config = {}) {
    this.id = config.id || 'strategy_' + Date.now();
    this.name = config.name || "BaseStrategy";
    this.symbols = config.symbols || [];
    this.timeframe = config.timeframe || "1m";
    this.lookback = config.lookback || 100; // Limit candles in RAM
    this.candleBased = config.candleBased !== undefined ? config.candleBased : true;
    
    this.enabled = false;
    this.startTime = null;
    this.lastTickTime = 0; // Sequence Guard
    this.data = new Map(); // Store for each symbol

    this._initDataStores();
  }

  _initDataStores() {
    this.symbols.forEach(symbol => {
      this.data.set(symbol, {
        currentTick: null,
        candleHistory: [],
        activeCandle: null
      });
    });
  }

  /**
   * Primary entry point for market data.
   */
  onPrice(tick, isWarmup = false) {
    if (!this.enabled && !isWarmup) return;

    // 1. SEQUENCE GUARD: Drop delayed or duplicate ticks
    if (tick.time <= this.lastTickTime) return;
    this.lastTickTime = tick.time;

    const store = this.data.get(tick.symbol);
    if (!store) return;

    store.currentTick = tick;

    // 2. CANDLE AGGREGATION
    const candleClosed = this._updateCandle(store, tick.time, tick.price);

    // 3. MEMORY MANAGEMENT: Cap history to prevent RAM exhaustion
    if (candleClosed && store.candleHistory.length > this.lookback) {
      store.candleHistory = store.candleHistory.slice(-this.lookback);
    }

    // 4. EXECUTION FLOW
    try {
      if (!this.candleBased || candleClosed) {
        this.next(tick, isWarmup);
      }
    } catch (err) {
      logger.error(`[${this.name}] Execution Error: ${err.message}`);
    }
  }

  _updateCandle(store, timestamp, price) {
    let closed = false;
    const tfMs = this._getTFMs();
    const candleStart = Math.floor(timestamp / tfMs) * tfMs;

    if (!store.activeCandle || store.activeCandle.timestamp !== candleStart) {
      if (store.activeCandle) {
        store.candleHistory.push({ ...store.activeCandle });
        closed = true;
      }
      store.activeCandle = { timestamp: candleStart, open: price, high: price, low: price, close: price, volume: 0 };
    } else {
      store.activeCandle.high = Math.max(store.activeCandle.high, price);
      store.activeCandle.low = Math.min(store.activeCandle.low, price);
      store.activeCandle.close = price;
    }
    return closed;
  }

  _getTFMs() {
    const unit = this.timeframe.slice(-1);
    const val = parseInt(this.timeframe);
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    return 60 * 1000;
  }

  // To be overridden by your strategy scripts
  next(tick, isWarmup) {}

  // --- VIRTUAL ORDERS (Backtester Bridge) ---
  
  /**
   * BUY: Signals an entry. 
   * In Backtest: Trigger grademark 'enter'
   * In Live: Trigger 'ORDER.CREATE' event
   */
  buy(params = {}) {
    if (this.position) return; // Prevent double entries

    const order = {
      strategyId: this.id,
      side: 'BUY',
      symbol: params.symbol || this.symbols[0],
      price: params.price || this.data.get(this.symbols[0]).currentTick.price,
      timestamp: Date.now()
    };

    this.position = { type: 'LONG', entry: order.price };
    
    // The BacktestManager will override this.buy for testing. 
    // This line only runs during LIVE mode.
    bus.emit(EVENTS.ORDER.CREATE, order);
  }

  /**
   * SELL: Signals an exit.
   */
  sell(params = {}) {
    if (!this.position) return; // Nothing to close

    const order = {
      strategyId: this.id,
      side: 'SELL',
      symbol: params.symbol || this.symbols[0],
      price: params.price || this.data.get(this.symbols[0]).currentTick.price,
      timestamp: Date.now()
    };

    this.position = null;
    bus.emit(EVENTS.ORDER.CREATE, order);
  }
}

module.exports = BaseStrategy;