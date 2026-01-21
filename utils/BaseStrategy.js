"use strict";

const { bus, EVENTS } = require('../events/bus');
const logger = require('./logger');

/**
 * @class BaseStrategy
 * @description 
 * Hardened base class for automated trading strategies. 
 * Handles OHLCV synthesis, gap-filling, and cross-mode (Live/Backtest) state parity.
 */
class BaseStrategy {
    /**
     * @param {Object} config
     * @param {String} config.symbol - Primary trading pair.
     * @param {String} config.timeframe - Interval string (e.g. '1m', '1h').
     * @param {Number} config.lookback - Minimum bars required for indicators.
     */
    constructor(config = {}) {
        // --- IDENTITY ---
        this.id = config.id || `strat_${Date.now()}`;
        this.name = config.name || "BaseStrategy";
        this.symbol = Array.isArray(config.symbols) ? config.symbols[0] : (config.symbol || null);
        this.timeframe = config.timeframe || "1m";
        
        // --- ENGINE CONFIG ---
        this.lookback = config.lookback || 100;
        this.max_data_history = config.max_data_history || 5000;
        this.candleBased = config.candleBased !== undefined ? config.candleBased : true;
        
        // --- OPERATIONAL STATE ---
        this.mode = 'LIVE'; // Default context
        this.enabled = false;
        this.isWarmedUp = false;

        // --- DYNAMIC SCHEMA ---
        this.schema = {};
        this.params = {};

        // --- DATA STORES ---
        this.position = null; // Current open trade state
        this.store = { 
            candleHistory: [], // Queue of completed OHLCV objects
            activeCandle: null // Building OHLCV object
        };
        
        // --- EXECUTION CONTEXT ---
        this.currentBar = null; // Latest raw tick or bar data
        this.lastExecutedCandleTime = null; // Per-candle execution lock
        this.pendingSignal = null; // Latch for the current processing cycle result
    }

    /**
     * Initializes strategy parameters from schema defaults.
     * Must be invoked after schema definition in child constructors.
     */
    initParams() {
        if (!this.schema) return;
        for (const [key, spec] of Object.entries(this.schema)) {
            this.params[key] = spec.default !== undefined ? spec.default : null;
        }
    }

    /**
     * Sets the execution environment.
     * @param {('LIVE'|'BACKTEST')} mode 
     */
    setMode(mode) {
        if (['LIVE', 'BACKTEST'].includes(mode)) this.mode = mode;
    }

    /**
     * Primary data entry point. Resolves price, updates OHLCV, and triggers logic.
     * @param {Object} tick - Object containing {time, price/close, volume}
     * @param {Boolean} isWarmup - If true, logic is processed but orders are suppressed.
     * @returns {Object|null} The generated trade signal for the current cycle.
     */
    onPrice(tick, isWarmup = false) {
        if (!this.enabled && !isWarmup) return null;

        const price = tick.price || tick.close;
        if (price === undefined || price <= 0) return null;

        // 1. Update context immediately for internal resolvers
        this.currentBar = tick; 
        this.pendingSignal = null; 

        // 2. Synthesize candle state & fill gaps
        const closed = this._updateCandle(tick.time, price, tick.volume || 0);
        
        // 3. Sliding window maintenance
        this._enforceWindow();

        // 4. Warmup Lifecycle Tracking
        this.isWarmedUp = !isWarmup;
        if (isWarmup) return null;

        // 5. Trigger Strategy Logic
        try {
            if (!this.candleBased || closed) {
                this.next(tick, isWarmup);
                return this.pendingSignal;
            }
        } catch (err) {
            logger.error(`[EXEC_FAIL][${this.id}] ${err.message}`);
            this.bus.emit(this.EVENTS.SYSTEM.STRATEGY_ERROR, { id: this.id, error: err.message });
        }
        return null;
    }

    /**
     * Candle synthesis algorithm. 
     * Uses a While loop to handle time gaps (Ghost Candles).
     * @private
     */
    _updateCandle(ts, price, volume) {
        let closed = false;
        const tfMs = this._getTFMs();
        const candleStart = Math.floor(ts / tfMs) * tfMs;

        if (!this.store.activeCandle) {
            this.store.activeCandle = { time: candleStart, open: price, high: price, low: price, close: price, volume: 0 };
            return false;
        }

        // Logic: Close candles and fill gaps if the tick has jumped intervals
        while (ts >= this.store.activeCandle.time + tfMs) {
            this.store.candleHistory.push({ ...this.store.activeCandle });
            closed = true;
            
            const nextStartTime = this.store.activeCandle.time + tfMs;
            this.store.activeCandle = { 
                time: nextStartTime, 
                open: this.store.activeCandle.close, 
                high: this.store.activeCandle.close, 
                low: this.store.activeCandle.close, 
                close: this.store.activeCandle.close, 
                volume: 0 
            };
        }

        // Update current active candle metrics
        const active = this.store.activeCandle;
        active.high = Math.max(active.high, price);
        active.low = Math.min(active.low, price);
        active.close = price;
        active.volume = closed ? volume : (active.volume + volume);
        
        return closed;
    }

    /**
     * Strategy logic implementation. Overridden by child classes.
     */
    next(data, isWarmup) { /* Abstract */ }

    // --- EXECUTION HELPERS ---

    buy(params = {}) {
        if (this.position) return null;
        const price = this._resolvePrice();
        const time = this._resolveExecTime();

        if (this.lastExecutedCandleTime === time) return null;
        this.lastExecutedCandleTime = time;

        this.position = { type: 'LONG', entry: price, time, symbol: this.symbol };
        this.pendingSignal = { action: 'ENTER_LONG', price, ...params };
        return this.pendingSignal;
    }

    short(params = {}) {
        if (this.position) return null;
        const price = this._resolvePrice();
        const time = this._resolveExecTime();

        if (this.lastExecutedCandleTime === time) return null;
        this.lastExecutedCandleTime = time;

        this.position = { type: 'SHORT', entry: price, time, symbol: this.symbol };
        this.pendingSignal = { action: 'ENTER_SHORT', price, ...params };
        return this.pendingSignal;
    }

    exit(params = {}) {
        if (!this.position) return null;
        const price = this._resolvePrice();
        const time = this._resolveExecTime();

        if (this.lastExecutedCandleTime === time) return null;
        this.lastExecutedCandleTime = time;

        const action = this.position.type === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT';
        this.pendingSignal = { action, price, ...params };
        this.position = null;
        return this.pendingSignal;
    }

    // --- PRIVATE UTILITIES ---

    _resolvePrice() {
        const p = this.mode === 'BACKTEST' ? this.currentBar?.close : this.store.activeCandle?.close;
        if (!p || p <= 0) throw new Error(`[CRITICAL] Invalid price resolution: ${p}`);
        return p;
    }

    _resolveExecTime() {
        if (this.mode === 'BACKTEST') return this.currentBar?.time;
        const tfMs = this._getTFMs();
        return Math.floor(Date.now() / tfMs) * tfMs;
    }

    _enforceWindow() {
        if (this.store.candleHistory.length > this.max_data_history) {
            this.store.candleHistory.shift();
        }
    }

    _getTFMs() {
        const units = { 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000 };
        const match = this.timeframe.match(/^(\d+)([smhd])$/);
        return parseInt(match[1]) * units[match[2]];
    }
}

module.exports = BaseStrategy;