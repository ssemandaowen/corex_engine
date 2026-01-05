const Indicators = require("./indicators");
const logger = require("./logger");

class BaseStrategy {
  constructor(config = {}) {
    this.name = config.name || this.constructor.name;
    this.symbols = config.symbols || [];
    this.lookback = config.lookback || 100;
    this.timeframeStr = config.timeframe || "1m";
    this.timeframeMs = this._parseTimeframe(this.timeframeStr);
    
    // Hard Freeze: Forcing explicit behavior
    this.candleBased = config.candleBased ?? false;
    this.Ind = Indicators;

    // --- Risk Layer (Frozen) ---
    this.balance = config.initialBalance || 10000;
    this.startBalance = this.balance;
    this.riskPerTrade = config.riskPerTrade || 0.02;
    this.maxDrawdown = config.maxDrawdown || 0.20;

    // --- State ---
    this.isWarmedUp = false;
    this.position = null; 
    this.data = new Map();
    this.stats = { wins: 0, losses: 0, totalPnl: 0, trades: [] };

    this._initializeStores();
  }

  // Inside BaseStrategy class
onPrice(tick, isWarmup = false) {
  const { symbol, price, time } = tick;

  // STRICT CHECK: Finalized for today
  if (!time || isNaN(time)) {
    if (!this._badTickLogged) { // Prevent spam
        logger.error(`[${this.name}] Data Integrity Error: Missing/Invalid timestamp on ${symbol}. Check Broker mapping.`);
        this._badTickLogged = true;
    }
    return;
  }

  const store = this.data.get(symbol);
  if (!store) return;

  // 1. Logic State Update
  store.prevTick = store.currentTick;
  store.currentTick = tick;

  // 2. Candle Aggregation
  const candleClosed = this._updateCandle(store, time, price);

  // 3. Execution Protection
  if (this._checkDrawdownLimit()) return;
  
  if (!isWarmup && this.position && this.position.symbol === symbol) {
    this._checkAutoExits(price);
  }

  // 4. Strategy Pulse
  if (!this.candleBased || candleClosed) {
    try {
      this.next(tick, isWarmup);
    } catch (err) {
      logger.error(`[${this.name}] Runtime Error: ${err.message}`);
    }
  }

  if (!isWarmup) this.isWarmedUp = true;
}

  // --- INTERNAL: NO MAGIC ---

  _updateCandle(store, time, price) {
    let closed = false;

    if (!store.currentCandle) {
      store.currentCandle = this._createNewCandle(time, price);
    } else {
      const nextStart = store.currentCandle.timeStart + this.timeframeMs;
      if (time >= nextStart) {
        store.candleHistory.push({ ...store.currentCandle });
        if (store.candleHistory.length > this.lookback) store.candleHistory.shift();
        store.currentCandle = this._createNewCandle(time, price);
        closed = true;
      } else {
        store.currentCandle.high = Math.max(store.currentCandle.high, price);
        store.currentCandle.low = Math.min(store.currentCandle.low, price);
        store.currentCandle.close = price;
      }
    }
    return closed;
  }

  _createNewCandle(time, price) {
    return {
      timeStart: Math.floor(time / this.timeframeMs) * this.timeframeMs,
      open: price, high: price, low: price, close: price
    };
  }

  _initializeStores() {
    this.symbols.forEach(s => {
      this.data.set(s, { currentTick: null, prevTick: null, currentCandle: null, candleHistory: [] });
    });
  }

  _parseTimeframe(tf) {
    const val = parseInt(tf);
    const unit = tf.slice(-1);
    const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    if (!map[unit]) throw new Error(`Unsupported timeframe: ${tf}`);
    return val * map[unit];
  }

  // Broker Helpers
  enter(side, { price, sl = null, tp = null, symbol = this.symbols[0] }) {
    if (this.position) return false;
    const qty = this._calculatePositionSize(price, sl);
    if (qty <= 0) return false;

    this.position = { symbol, side: side.toUpperCase(), entryPrice: price, qty, sl, tp, entryTime: Date.now() };
    logger.info(`[${this.name}] 🟢 ENTER ${side} @ ${price}`);
    return true;
  }

  close(price, reason = "SIGNAL") {
    if (!this.position) return false;
    const { side, entryPrice, qty } = this.position;
    const pnl = side === "LONG" ? (price - entryPrice) * qty : (entryPrice - price) * qty;
    this.balance += pnl;
    this.stats.totalPnl += pnl;
    pnl >= 0 ? this.stats.wins++ : this.stats.losses++;
    logger.info(`[${this.name}] 🔴 CLOSE @ ${price} | PnL: ${pnl.toFixed(2)} | Reason: ${reason}`);
    this.position = null;
    return true;
  }

  _calculatePositionSize(price, sl) {
    if (!sl) return (this.balance * 0.1) / price;
    const riskAmount = this.balance * this.riskPerTrade;
    const riskPerUnit = Math.abs(price - sl);
    return Math.min(riskAmount / riskPerUnit, (this.balance * 0.95) / price);
  }

  _checkAutoExits(price) {
    const { side, sl, tp } = this.position;
    if (side === "LONG") {
      if (sl && price <= sl) this.close(price, "STOP_LOSS");
      else if (tp && price >= tp) this.close(price, "TAKE_PROFIT");
    } else {
      if (sl && price >= sl) this.close(price, "STOP_LOSS");
      else if (tp && price <= tp) this.close(price, "TAKE_PROFIT");
    }
  }

  _checkDrawdownLimit() {
    const dd = (this.startBalance - this.balance) / this.startBalance;
    return dd >= this.maxDrawdown;
  }

  // Add/Ensure these methods exist inside your BaseStrategy class
getCurrentCandle(symbol = this.symbols[0]) {
  const store = this.data.get(symbol);
  return store ? store.currentCandle : null;
}

getCandles(symbol = this.symbols[0]) {
  const store = this.data.get(symbol);
  return store ? store.candleHistory : [];
}
}

module.exports = BaseStrategy;